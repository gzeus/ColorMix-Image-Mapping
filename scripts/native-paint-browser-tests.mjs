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
  await send('Browser.setDownloadBehavior',{behavior:'deny'});
  await send('Page.navigate',{url:'http://127.0.0.1:5173/'});
  await waitFor('Boolean(document.querySelector("h1"))');
  const result = await evaluate(`(async()=>{
    const {BoxGeometry,Vector3,Triangle}=await import('/node_modules/three/build/three.module.js');
    const {importModel}=await import('/src/lib/geometry/importModel.ts');
    const {projectModel}=await import('/src/lib/geometry/projectModel.ts');
    const {packPrusaPaint,encodePrusaTriangleState}=await import('/src/lib/geometry/prusaPaint.ts');
    const {defaultCustomSettings}=await import('/src/lib/geometry/customModel.ts');
    const {defaultColorMixFilaments,buildColorMixPalette}=await import('/src/lib/colorMix.ts');
    const {export3mf}=await import('/src/lib/export/export3mf.ts');
    const check=(condition,message)=>{if(!condition)throw new Error(message)};
    for(const [state,code] of [[0,'0'],[1,'4'],[2,'8'],[3,'0C'],[16,'DC'],[17,'00EC'],[255,'EEEC']])check(encodePrusaTriangleState(state)===code,'State encoding '+state);
    const box=new BoxGeometry(20,20,20),p=box.getAttribute('position');
    let obj='';for(let i=0;i<p.count;i++)obj+='v '+[p.getX(i),p.getY(i),p.getZ(i)].join(' ')+'\\n';
    for(let i=0;i<box.index.count;i+=3)obj+='f '+[0,1,2].map(j=>box.index.getX(i+j)+1).join(' ')+'\\n';
    const source=await importModel(new File([obj],'native-paint.obj'));
    const palette=buildColorMixPalette(defaultColorMixFilaments());
    const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;const ctx=canvas.getContext('2d');
    [0,1,24,44].forEach((index,i)=>{ctx.fillStyle=palette[index].hex;ctx.fillRect(i%2*32,Math.floor(i/2)*32,32,32)});
    const pixels=ctx.getImageData(0,0,64,64);
    const request={source,settings:defaultCustomSettings,mapping:{fitMode:'contain',scale:0.83,offsetU:0.07,offsetV:0.03,mirrorX:false,flipY:false,repeatX:false,repeatY:false},pixels:{data:pixels.data,width:64,height:64},palette,baseIndex:3,paintEncoding:'subtriangle'};
    const projected=projectModel(request);
    const mesh=packPrusaPaint(projected.paintForest,projected.mesh);
    check(mesh.triangles.length===12 && mesh.vertices.length===source.vertices.length,'Original mesh must remain unchanged');
    check(mesh.paintLeafCount>12 && mesh.paintLeafCount<mesh.paintPreview.triangles.length,'Uniform paint branches must collapse');
    const areas=new Map(),decodedAreas=new Map(), decoded=[];
    const area=(a,b,c)=>new Triangle(a,b,c).getArea();
    const add=(map,state,size)=>map.set(state,(map.get(state)||0)+size);
    for(const t of mesh.paintPreview.triangles)add(areas,t.materialIndex+1,area(...[t.a,t.b,t.c].map(i=>new Vector3().fromArray(mesh.paintPreview.vertices,i*3))));
    const splitModes=new Set();
    const decode=(text,corners)=>{
      let offset=text.length-1;
      const read=()=>{if(offset<0)throw new Error('Truncated paint tree');return parseInt(text[offset--],16)};
      const visit=(points)=>{
        const code=read(),count=code&3,side=code>>2;
        if(!count){let state=side;if(state===3){const ext=read();state=ext===14?17+read()+16*read():3+ext;}add(decodedAreas,state,area(...points));decoded.push({state,triangle:new Triangle(...points)});return;}
        splitModes.add(count);
        const [a,b,c]=[points[side],points[(side+1)%3],points[(side+2)%3]];
        const ab=a.clone().add(b).multiplyScalar(.5),bc=b.clone().add(c).multiplyScalar(.5),ca=c.clone().add(a).multiplyScalar(.5);
        const children=count===1?[[a,b,bc],[bc,c,a]]:count===2?[[a,ab,ca],[ab,b,ca],[b,c,ca]]:[[a,ab,ca],[ab,b,bc],[bc,c,ca],[ab,bc,ca]];
        for(let i=count;i>=0;i--)visit(children[i]);
      };
      visit(corners);check(offset===-1,'Trailing paint tree data');
    };
    for(const t of mesh.triangles)decode(t.prusaPaint,[t.a,t.b,t.c].map(i=>new Vector3().fromArray(mesh.vertices,i*3)));
    for(const [state,size] of areas)check(Math.abs(size-decodedAreas.get(state))<1e-6,'Paint placement/color area mismatch for state '+state);
    for(let i=0;i<mesh.paintPreview.triangles.length;i+=Math.max(1,Math.floor(mesh.paintPreview.triangles.length/120))){
      const face=mesh.paintPreview.triangles[i];
      const point=new Triangle(...[face.a,face.b,face.c].map(index=>new Vector3().fromArray(mesh.paintPreview.vertices,index*3))).getMidpoint(new Vector3());
      check(decoded.some(d=>d.state===face.materialIndex+1 && Math.abs(d.triangle.getNormal(new Vector3()).dot(point.clone().sub(d.triangle.a)))<1e-6 && d.triangle.containsPoint(point)),'Decoded paint must match preview position');
    }
    for(const [split,text] of [[1,'481'],[2,'4800EC2'],[3,'4800EC1CEC3']]){
      const fixture={...source,triangles:[source.triangles[0]]};
      const nodes=[{split,side:0,children:Array.from({length:split+1},(_,i)=>i+1),materialIndex:0},...[0,1,16,44].slice(0,split+1).map(materialIndex=>({split:0,side:0,children:[],materialIndex}))];
      const packed=packPrusaPaint({original:fixture,nodes},{...fixture,triangles:[],materials:palette});
      check(packed.triangles[0].prusaPaint===text,'Canonical split '+split);
    }
    const create=URL.createObjectURL.bind(URL);let blob;
    URL.createObjectURL=b=>{if(b.type==='model/3mf')blob=b;return create(b)};
    try{await export3mf(mesh,'native-paint.3mf')}finally{URL.createObjectURL=create}
    const base64=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(blob)});
    return {base64,geometryTriangles:mesh.triangles.length,samplingTriangles:mesh.paintPreview.triangles.length,paintRegions:mesh.paintLeafCount,states:[...areas.keys()],splitModes:[...splitModes]};
  })()`);
  await mkdir('node_modules/.tmp',{recursive:true});
  await writeFile('node_modules/.tmp/native-paint.3mf',Buffer.from(result.base64,'base64'));
  delete result.base64;
  console.log('PASS: native paint encoder, extended ColorMix states, all split modes, area/placement preservation',result);
} finally { socket.close(); }
