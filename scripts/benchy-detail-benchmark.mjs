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
  await send('Browser.setDownloadBehavior', { behavior: 'deny' });
  await send('Page.navigate',{url:'http://127.0.0.1:5173/'});
  await waitFor('Boolean(document.querySelector("h1"))');
  const bytes = await readFile('3D BENCHY - 2026-06-17_13_20_21.3mf');
  const result=await evaluate(`(async()=>{
    const {importModel}=await import('/src/lib/geometry/importModel.ts');
    const {defaultCustomSettings,transformModel,projectionFrame}=await import('/src/lib/geometry/customModel.ts');
    const {makeImageCoordinateMapper}=await import('/src/lib/imageSampling.ts');
    const {makePaletteColor}=await import('/src/lib/colorUtils.ts');
    const {Vector3}=await import('/node_modules/three/build/three.module.js');
    const model=await importModel(new File([Uint8Array.from(atob(${JSON.stringify(bytes.toString('base64'))}), c=>c.charCodeAt(0))],'benchy.3mf'));
    const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#000000';ctx.fillRect(0,0,256,256);ctx.fillStyle='#ffffff';ctx.font='bold 44px sans-serif';ctx.fillText('SHARK',12,140);
    const data=ctx.getImageData(0,0,256,256);
    const settings={...defaultCustomSettings};
    const mapping={fitMode:'contain',scale:0.4,offsetU:0,offsetV:0,mirrorX:false,flipY:false,repeatX:false,repeatY:false};
    const frame=projectionFrame(transformModel(model,settings),settings);
    const coords=makeImageCoordinateMapper(1,mapping,frame.width/frame.height);
    const request={paintEncoding:${JSON.stringify(process.argv.includes('--paint')?'subtriangle':'geometry')},source:model,settings,mapping,pixels:{width:256,height:256,data:data.data},palette:[makePaletteColor('#009bc3',0),makePaletteColor('#000000',1),makePaletteColor('#ffffff',2)],baseIndex:0};
    const run=async refinement=>{
      const t=performance.now();
      const worker=new Worker('/src/lib/geometry/projection.worker.ts',{type:'module'});
      const result=await new Promise((resolve,reject)=>{worker.onmessage=({data})=>data.error?reject(new Error(data.error)):resolve(data);worker.onerror=reject;worker.postMessage({...request,refinement,cleanupAreaMm2:0.05});}).finally(()=>worker.terminate());
      const surface=result.mesh.paintPreview??result.mesh;
      let overshoot=0,painted=0;
      const p=new Vector3();
      for(const face of surface.triangles) if(face.materialIndex!==0){painted++;
        for(const i of [face.a,face.b,face.c]){
          p.fromArray(surface.vertices,i*3).sub(frame.center);
          const uv=coords(p.dot(frame.right)/frame.width+0.5,p.dot(frame.up)/frame.height+0.5);
          overshoot=Math.max(overshoot,-uv.u,uv.u-1,-uv.v,uv.v-1);
        }
      }
      const seconds=(performance.now()-t)/1000;
      let packagingSeconds=0,packedBytes=0,packedBase64;
      if(refinement && ${process.argv.includes('--package')}) {
        const {export3mf}=await import('/src/lib/export/export3mf.ts');
        const create=URL.createObjectURL.bind(URL);let packedBlob;
        URL.createObjectURL=blob=>{if(blob.type==='model/3mf'){packedBytes=blob.size;packedBlob=blob}return create(blob)};
        const packStart=performance.now();
        try{await export3mf(result.mesh,'benchy-detail-test.3mf')}finally{URL.createObjectURL=create}
        packagingSeconds=(performance.now()-packStart)/1000;
        if(!packedBytes)throw new Error('3MF packaging produced no output');
        if(${process.argv.includes('--paint')})packedBase64=await new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.readAsDataURL(packedBlob)});
      }
      return {triangles:result.mesh.triangles.length,samplingTriangles:surface.triangles.length,paintRegions:result.mesh.paintLeafCount,packedBase64,limited:result.limited,seconds,maxImageBoundaryOvershoot:overshoot,painted,boundaryEdges:result.validation.boundaryEdges,packagingSeconds,packedBytes};
    };
    const preview=await run(undefined);
    const exported=await run(${JSON.stringify(process.argv.includes('--high') ? {multiplier:4,budget:2000000} : {multiplier:2,budget:1000000})});
    if(exported.samplingTriangles<=preview.samplingTriangles)throw new Error('Export detail did not increase Benchy sampling');
    if(${process.argv.includes('--paint')} && exported.triangles!==model.triangles.length)throw new Error('Native paint changed source geometry');
    if(exported.maxImageBoundaryOvershoot>preview.maxImageBoundaryOvershoot+0.00001)throw new Error('Export made boundary overshoot worse');
    if(exported.boundaryEdges!==preview.boundaryEdges)throw new Error('Export changed open-edge topology');
    return {sourceTriangles:model.triangles.length,preview,exported};
  })()`);
  if(result.exported.packedBase64){await writeFile('node_modules/.tmp/benchy-native-paint.3mf',Buffer.from(result.exported.packedBase64,'base64'));delete result.exported.packedBase64;}
  console.log(result);
} finally { socket.close(); }
