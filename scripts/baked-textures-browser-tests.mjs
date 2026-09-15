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
  await send('Browser.setDownloadBehavior', {behavior:'deny'});
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1050,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:'http://127.0.0.1:5173/'});
  await waitFor('Boolean(document.querySelector("h1"))');
  console.log(await evaluate(`(async()=>{
    const {BoxGeometry,Triangle,Vector3,Plane}=await import('/node_modules/three/build/three.module.js');
    const {importModel}=await import('/src/lib/geometry/importModel.ts');
    const {projectModel}=await import('/src/lib/geometry/projectModel.ts');
    const {packPrusaPaint}=await import('/src/lib/geometry/prusaPaint.ts');
    const {defaultCustomSettings}=await import('/src/lib/geometry/customModel.ts');
    const {makePaletteColor}=await import('/src/lib/colorUtils.ts');
    const check=(ok,message)=>{if(!ok)throw new Error(message)};
    const box=new BoxGeometry(20,20,20),p=box.getAttribute('position');
    let obj='';for(let i=0;i<p.count;i++)obj+='v '+[p.getX(i),p.getY(i),p.getZ(i)].join(' ')+'\\n';
    for(let i=0;i<box.index.count;i+=3)obj+='f '+[0,1,2].map(j=>box.index.getX(i+j)+1).join(' ')+'\\n';
    window.fixtureOBJ=obj;
    const source=await importModel(new File([obj],'layer-cube.obj'));
    const palette=['#ffffff','#ff0000','#00ff00','#0000ff','#80007f'].map(makePaletteColor);
    const solid=(rgb,a=255)=>({width:4,height:4,data:new Uint8ClampedArray(Array.from({length:16},()=>[...rgb,a]).flat())});
    const settings=defaultCustomSettings;
    const mapping={fitMode:'stretch',scale:0.8,offsetU:0,offsetV:0,mirrorX:false,flipY:false,repeatX:false,repeatY:false};
    const layers=[{settings,mapping,pixels:solid([255,0,0])},{settings:{...settings,direction:[0,0,-1]},mapping,pixels:solid([0,255,0])}];
    const blue=solid([0,0,255]);for(let y=0;y<4;y++)for(let x=0;x<2;x++)blue.data[(y*4+x)*4+3]=0;
    const request={source,settings,mapping:{...mapping,scale:0.3},pixels:blue,palette,baseIndex:0,layers,paintEncoding:'subtriangle',refinement:{multiplier:1,budget:60000}};
    const result=projectModel(request), packed=packPrusaPaint(result.paintForest,result.mesh);
    check(packed.triangles.length===12,'Layered native paint must retain original topology');
    const at=(mesh,xyz)=>{const point=new Vector3(...xyz);for(const f of mesh.triangles){const t=new Triangle(...[f.a,f.b,f.c].map(i=>new Vector3().fromArray(mesh.vertices,i*3)));if(Math.abs(t.getPlane(new Plane()).distanceToPoint(point))<0.001 && t.containsPoint(point))return f.materialIndex;}throw new Error('No face at '+xyz)};
    const probes=[[[1.13,10.37,10],3],[[-1.17,10.37,10],1],[[-5.13,10.37,10],1],[[1.13,10.37,-10],2],[[10,10.37,1.13],0]];
    for(const [point,color] of probes)check(at(result.mesh,point)===color,'Overlap/transparency/occlusion at '+point);
    const rotated=projectModel({...request,pixels:null,settings:{...settings,rotation:[0,90,0],scale:2}});
    check(at(rotated.mesh,[20,20.74,-2.26])===1,'Baked front stays attached after rotation/scale');
    check(at(rotated.mesh,[-20,20.74,-2.26])===2,'Baked back stays attached after rotation/scale');
    const alpha=projectModel({...request,layers:layers.slice(0,1),pixels:solid([0,0,255],127)});
    check(at(alpha.mesh,[1.13,10.37,10])===4,'Partial alpha blends with underlying paint');
    const legacy=projectModel({...request,paintEncoding:'geometry'});
    check(legacy.mesh.triangles.every((f,i)=>f.materialIndex===result.mesh.triangles[i].materialIndex),'Native and legacy layers agree');
    const many=projectModel({...request,pixels:null,layers:Array.from({length:24},(_,i)=>layers[i%2]),refinement:{multiplier:1,budget:1000}});
    check(many.mesh.triangles.length<=1000 && at(many.mesh,[1.13,10.37,10])===1 && at(many.mesh,[1.13,10.37,-10])===2,'No fixed layer count limit');
    check(source.triangles.length===12 && layers[0].pixels.data[3]===255,'Inputs remain immutable');
    return 'PASS: multi-view layers, overlap, full/partial transparency, occlusion, transform attachment, native/legacy parity, 24 layers';
  })()`));
  await evaluate(`(()=>{const s=Array.from(document.querySelectorAll('select')).find(s=>Array.from(s.options).some(o=>o.value==='custom'));s.value='custom';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await waitFor(`Boolean(document.querySelector('input[accept=".stl,.3mf,.obj"]'))`);
  await evaluate(`(()=>{const dt=new DataTransfer();dt.items.add(new File([window.fixtureOBJ],'layer-cube.obj'));const i=document.querySelector('input[accept=".stl,.3mf,.obj"]');i.files=dt.files;i.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await waitFor(`document.body.innerText.includes('Model ready. Add an image')`);
  // Helpers only use public DOM actions and real image imports/workers.
  await evaluate(`window.clickButton=text=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent===text).click();
    window.uploadColor=async color=>{const c=document.createElement('canvas');c.width=32;c.height=32;const ctx=c.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,32,32);const blob=await new Promise(r=>c.toBlob(r));const dt=new DataTransfer();dt.items.add(new File([blob],color+'.png',{type:'image/png'}));const i=document.querySelector('input[accept="image/png,image/jpeg,image/webp"]');i.files=dt.files;i.dispatchEvent(new Event('change',{bubbles:true}))};
    window.selectExport=value=>{const s=document.querySelector('[aria-label="Export content"]');s.value=value;s.dispatchEvent(new Event('change',{bubbles:true}))};
    window.exported=[];const create=URL.createObjectURL.bind(URL);URL.createObjectURL=blob=>{if(blob.type==='model/3mf')window.exported.push(blob);return create(blob)};
    window.paintHash=async blob=>{const JSZip=(await import('/node_modules/.vite/deps/jszip.js')).default;const z=await JSZip.loadAsync(await blob.arrayBuffer());const xml=await z.file('3D/3dmodel.model').async('string');const doc=new DOMParser().parseFromString(xml,'application/xml');const ts=Array.from(doc.querySelectorAll('triangle'));if(ts.length!==12)throw new Error('Geometry grew');const paint=Array.from(doc.querySelectorAll('vertex')).map(v=>[v.getAttribute('x'),v.getAttribute('y'),v.getAttribute('z')].join(',')).join('|')+'|'+ts.map(t=>t.getAttribute('slic3rpe:mmu_segmentation')).join('|');return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(paint)))).join(',')};
  `);
  await evaluate(`window.uploadColor('#009bc3')`);
  await waitFor(`document.body.innerText.includes('Preview ready.') && !document.querySelector('.preview-progress')`);
  // Use normal detail for a fast UI test; the native suite separately covers fine export.
  await evaluate(`Array.from(document.querySelectorAll('.check-row')).find(r=>r.textContent.includes('Extra paint detail on export')).querySelector('input').click()`);
  await waitFor(`!document.querySelector('.preview-progress')`);
  await evaluate(`window.clickButton('Bake current texture')`);
  await waitFor(`document.querySelector('.projection-toolbar').textContent.includes('1 baked texture') && !document.querySelector('.preview-progress')`,180000);
  assert(await evaluate(`document.querySelector('.palette-lock').disabled`),'Palette locks after baking');
  assert(await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Bake current texture').disabled`),'No accidental duplicate bake');
  await evaluate(`window.selectExport('baked')`);
  await waitFor(`!document.querySelector('.preview-progress')`);
  await evaluate(`document.querySelector('header .primary-button').click()`);
  await waitFor(`window.exported.length===1 && !document.querySelector('aside').inert`);
  const first=await evaluate(`window.paintHash(window.exported[0])`);
  await evaluate(`window.uploadColor('#c9378c')`);
  await waitFor(`document.body.innerText.includes('Preview ready.') && !document.querySelector('.preview-progress')`);
  await evaluate(`window.clickButton('Side');window.clickButton('Project from view')`);
  await waitFor(`!document.querySelector('.preview-progress')`);
  await evaluate(`document.querySelector('header .primary-button').click()`);
  await waitFor(`window.exported.length===2 && !document.querySelector('aside').inert`);
  assert.equal(await evaluate(`window.paintHash(window.exported[1])`),first,'Cached bake excludes new image and placement');
  await evaluate(`window.selectExport('current')`);
  await waitFor(`!document.querySelector('.preview-progress')`);
  await evaluate(`document.querySelector('header .primary-button').click()`);
  await waitFor(`window.exported.length===3 && !document.querySelector('aside').inert`,180000);
  const composed=await evaluate(`window.paintHash(window.exported[2])`);
  assert.notEqual(composed,first,'Current preview includes second image');
  await evaluate(`window.clickButton('Bake current texture')`);
  await waitFor(`document.querySelector('.projection-toolbar').textContent.includes('2 baked textures') && !document.querySelector('.preview-progress')`,180000);
  await evaluate(`window.selectExport('baked')`);
  await waitFor(`!document.querySelector('.preview-progress')`);
  await evaluate(`document.querySelector('header .primary-button').click()`);
  await waitFor(`window.exported.length===4 && !document.querySelector('aside').inert`);
  assert.equal(await evaluate(`window.paintHash(window.exported[3])`),composed,'Second bake caches the cumulative project');
  await evaluate(`window.clickButton('Clear baked textures')`);
  await waitFor(`!document.querySelector('.palette-lock').disabled && !document.querySelector('.preview-progress')`);
  assert(await evaluate(`document.querySelector('[aria-label="Export content"]').value==='current'`),'Clear resets export target');
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true}))`);
  await waitFor(`document.querySelector('.projection-toolbar').textContent.includes('2 baked textures') && !document.querySelector('.preview-progress')`);
  assert(await evaluate(`document.querySelector('.palette-lock').disabled`),'Undo restores layers and lock');
  // Undo the second bake too: one bake and the second image should become editable again.
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true}))`);
  await waitFor(`document.querySelector('.projection-toolbar').textContent.includes('1 baked texture') && !document.querySelector('.preview-progress')`);
  assert(await evaluate(`!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Bake current texture').disabled`),'Undo bake restores active texture');
  // The cache was discarded by Clear. Undo must reconstruct the first bake exactly,
  // even after geometry and export detail are changed for the current composition.
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.startsWith('Rotate Y')).click()`);
  await waitFor(`!document.querySelector('.preview-progress')`);
  await evaluate(`Array.from(document.querySelectorAll('.check-row')).find(r=>r.textContent.includes('Extra paint detail on export')).querySelector('input').click()`);
  await waitFor(`!document.querySelector('.preview-progress')`);
  await evaluate(`window.selectExport('baked')`);
  await waitFor(`!document.querySelector('.preview-progress')`);
  await evaluate(`document.querySelector('header .primary-button').click()`);
  await waitFor(`window.exported.length===5 && !document.querySelector('aside').inert`,180000);
  assert.equal(await evaluate(`window.paintHash(window.exported[4])`),first,'Undo cache rebuild uses original bake settings');
  await mkdir('node_modules/.tmp',{recursive:true});
  const screenshot=await send('Page.captureScreenshot',{format:'png'});
  await writeFile('node_modules/.tmp/baked-textures-preview.png',Buffer.from(screenshot.data,'base64'));
  // Automatic quantization must stop too, not just disable the ColorMix UI.
  await evaluate(`window.clickButton('Clear baked textures')`);
  await waitFor(`!document.querySelector('.palette-lock').disabled && !document.querySelector('.preview-progress')`);
  await evaluate(`Array.from(document.querySelectorAll('.check-row')).find(r=>r.textContent.includes('Enable ColorMix')).querySelector('input').click()`);
  await waitFor(`document.body.innerText.includes('Lock manual filament palette') && !document.querySelector('.preview-progress')`);
  await evaluate(`window.uploadColor('#ff0000')`);
  await waitFor(`Array.from(document.querySelectorAll('.palette-lock input[type="color"]')).some(i=>i.value==='#ff0000') && !document.querySelector('.preview-progress')`);
  await evaluate(`window.clickButton('Bake current texture')`);
  await waitFor(`document.querySelector('.projection-toolbar').textContent.includes('1 baked texture') && !document.querySelector('.preview-progress')`,180000);
  const lockedPalette=await evaluate(`Array.from(document.querySelectorAll('.palette-lock input[type="color"]')).map(i=>i.value)`);
  await evaluate(`window.previousImage=document.querySelector('img[alt="Mapped preview"]').src;window.uploadColor('#0000ff')`);
  await waitFor(`document.querySelector('img[alt="Mapped preview"]').src!==window.previousImage && !document.querySelector('.preview-progress')`);
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('.palette-lock input[type="color"]')).map(i=>i.value)`),lockedPalette,'New images cannot auto-quantize a baked palette');
  assert(await evaluate(`Array.from(document.querySelectorAll('.check-row')).find(r=>r.textContent.includes('Enable ColorMix')).querySelector('input').matches(':disabled')`),'Filament scheme cannot change');
  assert.deepEqual(errors,[]);
  console.log('PASS: real UI bake/reuse, palette lock, exact cached vs current 3MF exports, cumulative bake, clear and undo');
} finally {socket.close();}
