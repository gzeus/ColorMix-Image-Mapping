// Run with Vite on port 5173 and a Chromium browser exposing CDP on port 9223.
// No additional test dependencies are required.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const tabs = await fetch('http://127.0.0.1:9223/json').then(r => r.json());
const socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
let id = 0;
const pending = new Map();
const errors = [];
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data);
  if (message.id) {
    const callback = pending.get(message.id); pending.delete(message.id);
    if (message.error) callback.reject(new Error(JSON.stringify(message.error))); else callback.resolve(message.result);
  }
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
});
function send(method, params = {}) {
  return new Promise((resolve, reject) => { const next = ++id; pending.set(next, { resolve, reject }); socket.send(JSON.stringify({ id: next, method, params })); });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}
async function waitFor(expression, timeout = 60_000) {
  const start = Date.now();
  while (true) {
    try { if (await evaluate(expression)) return; } catch (error) { if (!/context|navigated/i.test(error.message)) throw error; }
    if (Date.now() - start > timeout) throw new Error(`Timed out: ${expression}`);
    await new Promise(resolve => setTimeout(resolve, 200));
  }
}
try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Browser.setDownloadBehavior', { behavior: 'deny' });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1050, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://127.0.0.1:5173/' });
  await waitFor('Boolean(document.querySelector("h1"))');
  console.log(await evaluate(`(async () => {
    const { importModel } = await import('/src/lib/geometry/importModel.ts');
    const { refineMesh, projectModel } = await import('/src/lib/geometry/projectModel.ts');
    const { defaultCustomSettings, transformModel, meshBounds } = await import('/src/lib/geometry/customModel.ts');
    const { validateMeshManifold } = await import('/src/lib/geometry/validateMesh.ts');
    const { makePaletteColor } = await import('/src/lib/colorUtils.ts');
    const { makePixelSampler } = await import('/src/lib/imageSampling.ts');
    const { BoxGeometry, Vector3 } = await import('/node_modules/three/build/three.module.js');
    const JSZip = (await import('/node_modules/.vite/deps/jszip.js')).default;
    const check = (condition, label) => { if (!condition) throw new Error(label); };
    const box = new BoxGeometry(20, 20, 20);
    let obj = '';
    const positions = box.getAttribute('position');
    for (let i = 0; i < positions.count; i++) obj += 'v ' + positions.getX(i) + ' ' + positions.getY(i) + ' ' + positions.getZ(i) + '\\n';
    for (let i = 0; i < box.index.count; i += 3) obj += 'f ' + [0,1,2].map(j => box.index.getX(i+j)+1).join(' ') + '\\n';
    window.fixtureOBJ = obj;
    const source = await importModel(new File([obj], 'cube.obj'));
    check(source.triangles.length === 12 && source.vertices.length === 24, 'OBJ welding');
    const refined = refineMesh(source, 3);
    const validation = validateMeshManifold(refined.mesh);
    check(validation.boundaryEdges === 0 && validation.nonManifoldEdges === 0, 'Subdivision must remain watertight');
    check(refined.mesh.triangles.length > 12, 'Subdivision adds image detail');
    check(meshBounds(source).equals(meshBounds(refined.mesh)), 'Subdivision preserves bounds');
    check(refineMesh(source, 0.01, 20).limited, 'Budget is reported');
    const scaled = transformModel(source, { ...defaultCustomSettings, scale: 2, rotation: [90, 0, 0] });
    check(Math.abs(meshBounds(scaled).getSize(new Vector3()).y - 40) < 1e-6 && meshBounds(scaled).min.y === 0, 'Scale and bed placement');
    const ascii = 'solid triangle\\nfacet normal 0 0 1\\nouter loop\\nvertex 0 0 0\\nvertex 10 0 0\\nvertex 0 10 0\\nendloop\\nendfacet\\nendsolid triangle';
    check((await importModel(new File([ascii], 'triangle.stl'))).triangles.length === 1, 'ASCII STL');
    const binary = new ArrayBuffer(134), view = new DataView(binary);
    view.setUint32(80, 1, true);
    [0,0,0, 10,0,0, 0,10,0].forEach((n,i) => view.setFloat32(96+i*4,n,true));
    check((await importModel(new File([binary], 'binary.stl'))).triangles.length === 1, 'Binary STL');
    const zip = new JSZip();
    zip.file('_rels/.rels', '<Relationships><Relationship Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Target="/3D/main.model"/></Relationships>');
    zip.file('3D/main.model', '<model unit="inch" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06"><resources><object id="1"><components><component objectid="2" p:path="/3D/part.model" transform="1 0 0 0 1 0 0 0 1 2 0 0"/></components></object></resources><build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 1 0 0"/></build></model>');
    zip.file('3D/part.model', '<model unit="millimeter"><resources><object id="2"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="0" y="10" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources></model>');
    const imported3mf = await importModel(new File([await zip.generateAsync({type:'uint8array'})], 'assembly.3mf'));
    check(Math.abs(meshBounds(imported3mf).min.x - 76.2) < 1e-6, '3MF units, component and build transforms');
    check(Math.abs(meshBounds(imported3mf).getSize(new Vector3()).x - 10) < 1e-6, 'External component units');
    let rejected = false;
    try { await importModel(new File(['not a mesh'], 'invalid.obj')); } catch { rejected = true; }
    check(rejected, 'Invalid model rejected');
    const palette = [makePaletteColor('#ffffff',0), makePaletteColor('#ff0000',1)];
    const mapping = { fitMode:'contain', offsetU:0, offsetV:0, scale:1, mirrorX:false, flipY:false, repeatX:false, repeatY:false };
    const pixels = { width:2, height:1, data: new Uint8ClampedArray([255,0,0,255,255,0,0,255]) };
    const sampler = makePixelSampler(pixels, mapping, palette[0], 1);
    check(sampler(0.5,0.9).g === 255 && sampler(0.5,0.5).g === 0, 'Contain respects physical aspect ratio');
    const projected = projectModel({ source, settings:defaultCustomSettings, mapping, pixels, palette, baseIndex:0 });
    check(projected.painted > 0, 'Projection assigns image colors');
    for (const face of projected.mesh.triangles) if (face.materialIndex === 1) {
      const z = [face.a,face.b,face.c].reduce((sum,i)=>sum+projected.mesh.vertices[i*3+2],0)/3;
      check(z > 9.99, 'Visible-only must not paint back or occluded faces');
    }
    // An independent front sheet occludes the central part of the cube front.
    const occluder = { ...source, vertices:[...source.vertices,-4,-4,15,4,-4,15,4,4,15,-4,4,15], triangles:[...source.triangles,{a:8,b:9,c:10,materialIndex:0},{a:8,b:10,c:11,materialIndex:0}] };
    const hidden = projectModel({ source:occluder, settings:defaultCustomSettings, mapping:{...mapping,fitMode:'stretch'}, pixels, palette, baseIndex:0 });
    let hiddenCount = 0;
    for (const face of hidden.mesh.triangles) {
      const center = [0,1,2].map(k=>[face.a,face.b,face.c].reduce((sum,i)=>sum+hidden.mesh.vertices[i*3+k],0)/3);
      if (Math.abs(center[0])<3 && Math.abs(center[1]-10)<3 && Math.abs(center[2]-7.5)<0.01) { check(face.materialIndex===0, 'Occluder blocks projection'); hiddenCount++; }
    }
    check(hiddenCount > 0, 'Occlusion fixture exercised');
    const wrapped = projectModel({ source, settings:{...defaultCustomSettings,projection:'cylindrical'},mapping:{...mapping,fitMode:'stretch',repeatX:true},pixels,palette,baseIndex:0 });
    check(wrapped.painted > projected.painted, 'Wrap covers multiple sides');
    return 'PASS: STL ASCII/binary, OBJ, 3MF assembly/units, invalid input, conforming subdivision, scale, aspect, occlusion, wrapping';
  })()`));
  // Exercise the actual React workflow and worker.
  await evaluate(`(() => {
    const select = Array.from(document.querySelectorAll('select')).find(s => Array.from(s.options).some(o => o.value === 'custom'));
    select.value='custom'; select.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await waitFor('Boolean(document.querySelector("input[accept=\\".stl,.3mf,.obj\\"]"))');
  await evaluate(`(() => {
    const dt = new DataTransfer(); dt.items.add(new File([window.fixtureOBJ], 'test-cube.obj'));
    const input=document.querySelector('input[accept=".stl,.3mf,.obj"]'); input.files=dt.files; input.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await waitFor('document.body.innerText.includes("Model ready. Add an image")');
  await evaluate(`(async () => {
    const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;
    const ctx=canvas.getContext('2d'); ctx.fillStyle='#009bc3';ctx.fillRect(0,0,64,64);ctx.fillStyle='#c9378c';ctx.fillRect(0,0,32,64);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve));
    const dt=new DataTransfer();dt.items.add(new File([blob],'test-image.png',{type:'image/png'}));
    const input=document.querySelector('input[accept="image/png,image/jpeg,image/webp"]');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await waitFor('document.body.innerText.includes("Preview ready.") && !document.querySelector(".preview-progress")');
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Side').click()`);
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Project from view').click()`);
  await waitFor('!document.querySelector(".preview-progress")');
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Move image').click()`);
  const bounds = await evaluate(`(() => {const r=document.querySelector('.viewport canvas').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await send('Input.dispatchMouseEvent', { type:'mousePressed', x:bounds.x, y:bounds.y, button:'left', clickCount:1 });
  await send('Input.dispatchMouseEvent', { type:'mouseMoved', x:bounds.x+50, y:bounds.y+20, button:'left', buttons:1 });
  await send('Input.dispatchMouseEvent', { type:'mouseReleased', x:bounds.x+50, y:bounds.y+20, button:'left', clickCount:1 });
  await waitFor('!document.querySelector(".preview-progress")');
  assert(await evaluate(`Array.from(document.querySelectorAll('.slider-row')).find(r=>r.innerText.includes('Offset X')).querySelector('output').textContent !== '0.00'`), 'Direct dragging updates image offset');
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Done moving').click()`);
  await mkdir('node_modules/.tmp', {recursive:true});
  const screenshot = await send('Page.captureScreenshot', {format:'png'});
  await writeFile('node_modules/.tmp/custom-model-preview.png', Buffer.from(screenshot.data,'base64'));
  console.log('PASS: React model-first import, image upload, worker, project from side, direct dragging');
  await evaluate(`(() => {
    const input=Array.from(document.querySelectorAll('.custom-model-controls .number-row')).find(r=>r.innerText.includes('Scale %')).querySelector('input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'150');
    input.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  await waitFor(`Array.from(document.querySelectorAll('.custom-model-controls .number-row')).find(r=>r.innerText.includes('Width mm')).querySelector('input').value === '30' && !document.querySelector('.preview-progress')`);
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true}))`);
  await waitFor(`Array.from(document.querySelectorAll('.custom-model-controls .number-row')).find(r=>r.innerText.includes('Width mm')).querySelector('input').value === '20' && !document.querySelector('.preview-progress')`);
  await evaluate(`(() => {
    const select=Array.from(document.querySelectorAll('select')).find(s=>Array.from(s.options).some(o=>o.value==='cylindrical'));
    select.value='cylindrical';select.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await waitFor(`document.body.innerText.includes('Wrap around Y:') && !document.querySelector('.preview-progress')`);
  console.log('PASS: uniform model scaling, undo, cylindrical UI mode');
  await evaluate(`(() => {
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = blob => { if (blob.type === 'model/3mf') window.exportedModel = blob; return create(blob); };
    window.previewTriangleCount = Number(document.querySelector('.export-bar strong').textContent.replace(/[^0-9]/g,''));
    document.querySelector('header .primary-button').click();
  })()`);
  await waitFor('Boolean(window.exportedModel)');
  console.log(await evaluate(`(async () => {
    const JSZip = (await import('/node_modules/.vite/deps/jszip.js')).default;
    const zip = await JSZip.loadAsync(await window.exportedModel.arrayBuffer());
    const xml = await zip.file('3D/3dmodel.model').async('string');
    const doc = new DOMParser().parseFromString(xml,'application/xml');
    if (doc.querySelectorAll('triangle').length !== window.previewTriangleCount) throw new Error('Export changed triangle count');
    const states = new Set(Array.from(doc.querySelectorAll('triangle')).map(t=>t.getAttribute('slic3rpe:mmu_segmentation')));
    if (states.size < 2 || states.has(null)) throw new Error('Export lost image segmentation');
    const recipes = await zip.file('Metadata/Prusa_Slicer_full_spectrum.json').async('string');
    if (!recipes.includes('components')) throw new Error('Export lost ColorMix recipes');
    const { importModel } = await import('/src/lib/geometry/importModel.ts');
    const restored = await importModel(new File([window.exportedModel],'roundtrip.3mf'));
    if (restored.triangles.length !== window.previewTriangleCount) throw new Error('3MF roundtrip lost triangles');
    return 'PASS: 3MF export triangle count, paint segmentation, ColorMix recipes, geometry roundtrip';
  })()`));
  await evaluate(`(() => {
    const select=Array.from(document.querySelectorAll('select')).find(s=>Array.from(s.options).some(o=>o.value==='simple'));
    select.value='simple';select.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await waitFor(`document.body.innerText.includes('Tested target: PrusaSlicer.')`);
  assert(await evaluate(`Boolean(Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Cylinder'))`));
  assert(await evaluate(`!document.querySelector('.projection-toolbar')`));
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Cylinder').click()`);
  await waitFor(`document.body.innerText.includes('Tested target: PrusaSlicer.')`);
  console.log('PASS: switching back to procedural shapes and cylinder generation');
  for (const file of ['Benchbin_XL.3mf', 'Gecko-A.3mf']) {
    const bytes = await readFile(file).catch(() => null);
    if (!bytes) continue;
    const result = await evaluate(`(async()=>{ const {importModel}=await import('/src/lib/geometry/importModel.ts'); const bytes=Uint8Array.from(atob(${JSON.stringify(bytes.toString('base64'))}), c=>c.charCodeAt(0)); const m=await importModel(new File([bytes],${JSON.stringify(file)}));return m.triangles.length;})()`);
    assert(result > 0); console.log('PASS: repository 3MF', file, result, 'triangles');
  }
  assert.deepEqual(errors, [], 'No uncaught browser exceptions');
} finally { socket.close(); }
