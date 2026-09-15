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
let acceptPainting = true;
const dialogs = [];
socket.addEventListener('message',({data})=>{
  const event=JSON.parse(data);
  if(event.method==='Page.javascriptDialogOpening'){
    dialogs.push(event.params.message);
    void send('Page.handleJavaScriptDialog',{accept:acceptPainting});
  }
});
try {
  await send('Runtime.enable');await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1050,deviceScaleFactor:1,mobile:false});
  await send('Browser.setDownloadBehavior',{behavior:'deny'});
  await send('Page.navigate',{url:'http://127.0.0.1:5173/'});
  await waitFor('Boolean(document.querySelector("h1"))');
  const bytes=await readFile('node_modules/.tmp/native-paint.3mf');
  console.log(await evaluate(`(async()=>{
    const JSZip=(await import('/node_modules/.vite/deps/jszip.js')).default;
    const {importModel}=await import('/src/lib/geometry/importModel.ts');
    const {decodePaint,mirrorPaintTree}=await import('/src/lib/geometry/readPrusaPaint.ts');
    const {projectModel}=await import('/src/lib/geometry/projectModel.ts');
    const {packPrusaPaint}=await import('/src/lib/geometry/prusaPaint.ts');
    const {defaultCustomSettings}=await import('/src/lib/geometry/customModel.ts');
    const {Triangle,Vector3,Plane}=await import('/node_modules/three/build/three.module.js');
    const {export3mf}=await import('/src/lib/export/export3mf.ts');
    const check=(ok,msg)=>{if(!ok)throw new Error(msg)};
    const raw=Uint8Array.from(atob(${JSON.stringify(bytes.toString('base64'))}),c=>c.charCodeAt(0));
    const zip=await JSZip.loadAsync(raw);
    const original=await importModel(new File([raw],'native.3mf'),{detectPainting:true});
    check(original.extruderSetup && original.materials.length===46,'App ColorMix 3MF preserves every physical and virtual entry, including unused entries');
    const doc=new DOMParser().parseFromString(await zip.file('3D/3dmodel.model').async('string'),'application/xml');
    const faces=Array.from(doc.querySelectorAll('triangle'));
    faces.forEach(f=>f.setAttributeNS('http://schemas.slic3r.org/3mf/2017/06','slic3rpe:mmu_segmentation','0'));
    faces[0].setAttributeNS('http://schemas.slic3r.org/3mf/2017/06','slic3rpe:mmu_segmentation','4800EC1CEC3');
    doc.querySelector('item').setAttribute('transform','1 0 0 0 1 0 0 0 1 0 0 0');
    const spectrum={version:1,physical_extruders:[{id:1,color:'#FF0000'},{id:2,color:'#FFFFFF'}],virtual_extruders:[{id:17,color:'#FF8080',kind:'fullspectrum',components:[{extruder:1,ratio:0.5},{extruder:2,ratio:0.5}]},{id:45,color:'#FFBFBF',kind:'fullspectrum',components:[{extruder:1,ratio:0.25},{extruder:2,ratio:0.75}]}]};
    zip.file('3D/3dmodel.model',new XMLSerializer().serializeToString(doc));
    zip.file('Metadata/Prusa_Slicer_full_spectrum.json',JSON.stringify(spectrum));
    zip.file('Metadata/Slic3r_PE_model.config','<config><object id="1"><metadata type="object" key="extruder" value="1"/><volume firstid="0" lastid="11"><metadata type="volume" key="extruder" value="2"/></volume></object></config>');
    const fixture=await zip.generateAsync({type:'blob'});
    window.paintFixture=fixture;
    const painted=await importModel(new File([fixture],'sparse-paint.3mf'),{detectPainting:true});
    check(painted.extruderSetup && painted.triangles.length===12,'Paint detection and original faces');
    check(painted.materials.map(m=>m.extruderId).join(',')==='1,2,17,45','Sparse extruder IDs retained');
    check(painted.triangles[1].prusaPaint==='8' && painted.triangles[1].materialIndex===1,'State zero resolves volume extruder');
    const decoded=decodePaint(painted);
    check(decoded.mesh.triangles.length===15,'Sub-triangle painting decoded without geometric subdivision');
    check(new Set(decoded.mesh.triangles.map(t=>t.materialIndex)).size===4,'All four physical/virtual colors visible');
    const plain=await importModel(new File([fixture],'blank.3mf'));
    check(!plain.extruderSetup && plain.materials.length===0 && plain.triangles.every(f=>!f.prusaPaint),'Geometry-only import remains default');
    const request={source:painted,settings:defaultCustomSettings,mapping:{fitMode:'stretch',scale:0.2,offsetU:0,offsetV:0,mirrorX:false,flipY:false,repeatX:false,repeatY:false},pixels:null,palette:painted.materials,baseIndex:0,paintEncoding:'subtriangle'};
    const preview=projectModel(request);
    check(preview.mesh.paintPreview.triangles.length===15 && preview.mesh.triangles[0].prusaPaint===painted.triangles[0].prusaPaint,'Unedited preview retains exact paint');
    const overlay=projectModel({...request,settings:{...request.settings,direction:[1,0,0]},pixels:{width:1,height:1,data:new Uint8ClampedArray([255,0,0,255])},refinement:{multiplier:1,budget:5000}});
    const packed=packPrusaPaint(overlay.paintForest,overlay.mesh);
    check(packed.triangles.length===12,'Overlay keeps native geometry');
    check(packed.triangles[0].prusaPaint!==painted.triangles[0].prusaPaint,'Overlay refines and edits an already painted source face');
    check(packed.triangles.some(t=>t.prusaPaint.includes('EC')),'New projection preserves imported virtual paint outside its footprint');
    const at=(m,p)=>{for(const f of m.triangles){const t=new Triangle(...[f.a,f.b,f.c].map(i=>new Vector3().fromArray(m.vertices,i*3)));if(Math.abs(t.getPlane(new Plane()).distanceToPoint(p))<1e-7 && t.containsPoint(p))return f.materialIndex;}return -1;};
    for(const text of ['481','485','489','4800EC2','4800EC6','4800ECA','4800EC1CEC3','48181']){
      const face={...painted.triangles[0],prusaPaint:text};
      const a=decodePaint({...painted,triangles:[face]}).mesh;
      const mirrored={...painted,triangles:[{...face,b:face.c,c:face.b,prusaPaint:mirrorPaintTree(text)}]};
      const b=decodePaint(mirrored).mesh;
      for(const f of a.triangles){const p=new Triangle(...[f.a,f.b,f.c].map(i=>new Vector3().fromArray(a.vertices,i*3))).getMidpoint(new Vector3());check(at(b,p)===f.materialIndex,'Mirrored subtree placement '+text);}
    }
    const mirrorZip=await JSZip.loadAsync(fixture);
    const mirrorDoc=new DOMParser().parseFromString(await mirrorZip.file('3D/3dmodel.model').async('string'),'application/xml');
    mirrorDoc.querySelector('item').setAttribute('transform','-1 0 0 0 1 0 0 0 1 0 0 0');
    mirrorZip.file('3D/3dmodel.model',new XMLSerializer().serializeToString(mirrorDoc));
    const mirrorModel=await importModel(new File([await mirrorZip.generateAsync({type:'blob'})],'mirrored.3mf'),{detectPainting:true});
    const mirrorSurface=decodePaint(mirrorModel).mesh;
    for(const f of decoded.mesh.triangles){const point=new Triangle(...[f.a,f.b,f.c].map(i=>new Vector3().fromArray(decoded.mesh.vertices,i*3))).getMidpoint(new Vector3());point.x=-point.x;check(at(mirrorSurface,point)===f.materialIndex,'Mirrored 3MF instance preserves paint positions');}
    const broken=await JSZip.loadAsync(fixture);broken.file('Metadata/Prusa_Slicer_full_spectrum.json','{}');
    const fallback=await importModel(new File([await broken.generateAsync({type:'blob'})],'broken.3mf'),{detectPainting:true});
    check(!fallback.extruderSetup && fallback.paintingWarning && fallback.triangles.length===12,'Incompatible setup falls back to blank geometry with explanation');
    // Ordinary PrusaSlicer MMU without ColorMix JSON, including extruder color precedence.
    const ordinary=await JSZip.loadAsync(fixture);ordinary.remove('Metadata/Prusa_Slicer_full_spectrum.json');
    ordinary.file('Metadata/Slic3r_PE.config','; extruder_colour = #123456;#ABCDEF\\n; filament_colour = #FF0000;#FF0000\\n');
    const ordinaryDoc=new DOMParser().parseFromString(await ordinary.file('3D/3dmodel.model').async('string'),'application/xml');
    ordinaryDoc.querySelector('triangle').setAttributeNS('http://schemas.slic3r.org/3mf/2017/06','slic3rpe:mmu_segmentation','481');
    ordinary.file('3D/3dmodel.model',new XMLSerializer().serializeToString(ordinaryDoc));
    const mmu=await importModel(new File([await ordinary.generateAsync({type:'blob'})],'ordinary.3mf'),{detectPainting:true});
    check(mmu.materials.map(m=>m.hex).join(',')==='#123456,#abcdef','Ordinary PrusaSlicer extruder colors loaded');
    const create=URL.createObjectURL.bind(URL);let output;URL.createObjectURL=b=>{if(b.type==='model/3mf')output=b;return create(b)};
    try{await export3mf(preview.mesh,'imported-paint-roundtrip.3mf')}finally{URL.createObjectURL=create}
    window.importedExport=output;
    const exported=await JSZip.loadAsync(output);
    check(JSON.stringify(JSON.parse(await exported.file('Metadata/Prusa_Slicer_full_spectrum.json').async('string')))===JSON.stringify(spectrum),'Exact imported extruder setup exported');
    const restored=await importModel(new File([output],'again.3mf'),{detectPainting:true});
    check(restored.triangles.map(f=>f.prusaPaint).join('|')===painted.triangles.map(f=>f.prusaPaint).join('|'),'Paint trees survive export/reimport');
    window.paintFixtureCount=decoded.mesh.triangles.length;
    return 'PASS: native and ordinary MMU paint, sparse virtual IDs/recipes, inherited volume extruder, sub-triangle decoding, mirrored subtrees, overlays, blank fallback, export/reimport';
  })()`));
  const gecko=await readFile('Gecko-A.3mf').catch(()=>null);
  if(gecko) console.log(await evaluate(`(async()=>{const {importModel}=await import('/src/lib/geometry/importModel.ts');const {decodePaint}=await import('/src/lib/geometry/readPrusaPaint.ts');const data=Uint8Array.from(atob(${JSON.stringify(gecko.toString('base64'))}),c=>c.charCodeAt(0));const model=await importModel(new File([data],'Gecko-A.3mf'),{detectPainting:true});if(!model.extruderSetup)throw new Error(model.paintingWarning||'Gecko painting not detected');const decoded=decodePaint(model);return {fixture:'Gecko-A',faces:model.triangles.length,paintRegions:decoded.mesh.triangles.length,physicalExtruders:model.extruderSetup.physicalExtruders.length};})()`));
  const b64=await evaluate(`new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.readAsDataURL(window.importedExport)})`);
  await writeFile('node_modules/.tmp/imported-paint-roundtrip.3mf',Buffer.from(b64,'base64'));
  await evaluate(`(()=>{const s=Array.from(document.querySelectorAll('select')).find(s=>Array.from(s.options).some(o=>o.value==='custom'));s.value='custom';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await waitFor(`Boolean(document.querySelector('input[accept=".stl,.3mf,.obj"]'))`);
  await evaluate(`window.loadPaintFixture=()=>{const dt=new DataTransfer();dt.items.add(new File([window.paintFixture],'painted.3mf'));const i=document.querySelector('input[accept=".stl,.3mf,.obj"]');i.files=dt.files;i.dispatchEvent(new Event('change',{bubbles:true}))};window.loadPaintFixture()`);
  await waitFor(`document.body.innerText.includes('Imported MMU painting ready.') && !document.querySelector('.preview-progress')`);
  assert.deepEqual(dialogs,['The 3MF file includes multimaterial painting. Do you want to import it?']);
  assert(await evaluate(`document.body.innerText.includes('2 physical extruders, 2 virtual extruders imported')`));
  assert(await evaluate(`document.querySelector('.palette-lock').disabled && document.body.innerText.includes('15 paint regions')`));
  assert(await evaluate(`!document.querySelector('[aria-label="Export content"] option[value="baked"]').disabled`));
  acceptPainting=false;
  await evaluate('window.loadPaintFixture()');
  await waitFor(`document.body.innerText.includes('Model ready. Add an image') && !document.querySelector('.preview-progress')`);
  assert.equal(dialogs.length,2);
  assert(await evaluate(`!document.body.innerText.includes('Imported MMU painting') && !document.querySelector('.palette-lock').disabled`),'Decline loads blank model');
  acceptPainting=true;
  await evaluate('window.loadPaintFixture()');
  await waitFor(`document.body.innerText.includes('Imported MMU painting ready.') && !document.querySelector('.preview-progress')`);
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Clear all painting').click()`);
  await waitFor(`!document.body.innerText.includes('Imported MMU painting') && !document.querySelector('.palette-lock').disabled && !document.querySelector('.preview-progress')`);
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true}))`);
  await waitFor(`document.body.innerText.includes('Imported MMU painting ready.') && !document.querySelector('.preview-progress')`);
  assert(await evaluate(`document.querySelector('.palette-lock').disabled`),'Undo restores painting and imported extruders');
  await evaluate(`document.querySelector('aside').scrollTop=10000`);
  const screen=await send('Page.captureScreenshot',{format:'png'});
  await writeFile('node_modules/.tmp/imported-paint-preview.png',Buffer.from(screen.data,'base64'));
  assert.deepEqual(errors,[]);
  console.log('PASS: actual accept/decline prompt, preview, original extruder UI, clear and undo');
} finally {socket.close();}
