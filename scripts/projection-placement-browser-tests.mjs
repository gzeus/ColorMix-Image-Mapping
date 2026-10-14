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
let instrumentation;
const consoleErrors=[];
socket.addEventListener('message',({data})=>{const event=JSON.parse(data);if(event.method==='Runtime.consoleAPICalled' && event.params.type==='error')consoleErrors.push(event.params.args.map(a=>a.value||a.description).join(' '))});
const button = text => `Array.from(document.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(text)})`;
async function click(text){await evaluate(`${button(text)}.click()`)}
async function settled(){await waitFor(`!document.querySelector('.preview-progress') && !document.body.innerText.includes('Preparing model and image detail')`,180000)}
async function screenshot(name){const r=await send('Page.captureScreenshot',{format:'png'});await mkdir('node_modules/.tmp',{recursive:true});await writeFile('node_modules/.tmp/'+name,Buffer.from(r.data,'base64'));return r.data;}
try {
  await send('Runtime.enable');await send('Page.enable');
  await send('Browser.setDownloadBehavior',{behavior:'deny'});
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1050,deviceScaleFactor:1,mobile:false});
  instrumentation=await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.projectionPosts=0;const NativeWorker=Worker;window.Worker=class extends NativeWorker{postMessage(data,...args){if(data.source)window.projectionPosts++;return super.postMessage(data,...args)}};`});
  await send('Page.navigate',{url:'http://127.0.0.1:5173/'});
  await waitFor('Boolean(document.querySelector("h1"))');
  await evaluate(`(async()=>{
    const THREE=await import('/node_modules/.vite/deps/three.js');
    window.positionUploads=0;const setAttribute=THREE.BufferGeometry.prototype.setAttribute;
    THREE.BufferGeometry.prototype.setAttribute=function(name,value){if(name==='position' && value.count>10)window.positionUploads++;return setAttribute.call(this,name,value)};
    const box=new THREE.BoxGeometry(20,20,20),p=box.getAttribute('position');let obj='';
    for(let i=0;i<p.count;i++)obj+='v '+[p.getX(i),p.getY(i),p.getZ(i)].join(' ')+'\\n';
    for(let i=0;i<box.index.count;i+=3)obj+='f '+[0,1,2].map(j=>box.index.getX(i+j)+1).join(' ')+'\\n';
    window.modelFile=new File([obj],'placement-cube.obj');
    window.uploadImage=async multicolor=>{const c=document.createElement('canvas');c.width=64;c.height=64;const ctx=c.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,64,64);if(multicolor)['#ff0000','#00ff00','#0000ff','#ffff00'].forEach((color,i)=>{ctx.fillStyle=color;ctx.fillRect(i%2*32,Math.floor(i/2)*32,32,32)});const blob=await new Promise(r=>c.toBlob(r));const dt=new DataTransfer();dt.items.add(new File([blob],multicolor?'quadrants.png':'white.png',{type:'image/png'}));const input=document.querySelector('input[accept="image/png,image/jpeg,image/webp"]');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}))};
    window.changeCamera=mode=>{const s=document.querySelector('[aria-label="Camera projection"]');s.value=mode;s.dispatchEvent(new Event('change',{bubbles:true}))};
    window.setInput=(i,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,value);i.dispatchEvent(new Event('input',{bubbles:true}))};
    const source=Array.from(document.querySelectorAll('select')).find(s=>Array.from(s.options).some(o=>o.value==='custom'));source.value='custom';source.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await waitFor(`Boolean(document.querySelector('input[accept=".stl,.3mf,.obj"]'))`);
  await evaluate(`(()=>{const d=new DataTransfer();d.items.add(window.modelFile);const i=document.querySelector('input[accept=".stl,.3mf,.obj"]');i.files=d.files;i.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await waitFor(`document.body.innerText.includes('Model ready. Add an image')`);
  await evaluate('window.uploadImage(false)');
  await waitFor(`Boolean(document.querySelector('img[alt="Mapped preview"]')) && !document.querySelector('.preview-progress') && (document.body.innerText.includes('Preview ready.') || document.body.innerText.includes('No image colors visible.'))`);
  await click('Front');
  const before=await evaluate('window.projectionPosts');
  await evaluate(`window.changeCamera('perspective')`);await evaluate(`window.changeCamera('orthographic')`);
  assert.equal(await evaluate('window.projectionPosts'),before,'Changing camera mode is preview-only');
  await click('Project from view');
  await waitFor(`Boolean(${button('Apply')})`);
  const uploads=await evaluate('window.positionUploads');
  assert(await evaluate(`document.querySelector('header .primary-button').disabled && ${button('Bake current texture')}.disabled`),'Export/bake disabled until Apply');
  await evaluate('window.uploadImage(true)');
  await waitFor(`document.querySelector('img[alt="Mapped preview"]').src && document.body.innerText.includes('Projection calculations are paused.')`);
  await new Promise(r=>setTimeout(r,250));
  const overlay=await screenshot('placement-overlay.png');
  const samples=await evaluate(`(async()=>{const img=new Image();img.src='data:image/png;base64,${overlay}';await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);const bounds=document.querySelector('.viewport canvas').getBoundingClientRect();return [[-50,-50],[50,-50],[-50,50],[50,50]].map(([x,y])=>Array.from(ctx.getImageData(bounds.x+bounds.width/2+x,bounds.y+bounds.height/2+y,1,1).data).slice(0,3))})()`);
  assert(samples[0][0]>samples[0][1]+50 && samples[0][0]>samples[0][2]+50,'Top-left red image quadrant visible');
  assert(samples[1][1]>samples[1][0]+50,'Top-right green image quadrant visible');
  assert(samples[2][2]>samples[2][0]+50,'Bottom-left blue quadrant validates texture orientation');
  assert(samples[0][1]>135 && samples[0][1]<170,'Overlay is 30% transparent over the white model');
  await evaluate(`window.setInput(document.querySelector('[aria-label="Preview image size"]'),'0.7')`);
  await evaluate(`window.setInput(Array.from(document.querySelectorAll('.custom-model-controls .slider-row')).find(r=>r.textContent.includes('Image angle')).querySelector('input'),'25')`);
  await click('Move image');
  const bounds=await evaluate(`(()=>{const b=document.querySelector('.viewport canvas').getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2}})()`);
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:bounds.x,y:bounds.y,button:'left',clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:bounds.x+35,y:bounds.y+20,button:'left',buttons:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:bounds.x+35,y:bounds.y+20,button:'left',clickCount:1});
  await click('Done moving');
  await click('Side');
  await evaluate(`window.changeCamera('perspective')`);
  await new Promise(r=>setTimeout(r,500));
  assert.equal(await evaluate('window.projectionPosts'),before,'Image replacement, scale, rotation, drag, orbit and camera changes send no projection worker requests');
  assert.equal(await evaluate('window.positionUploads'),uploads,'Placement never rebuilds the model geometry');
  assert(await evaluate(`document.querySelector('.export-bar strong').textContent.startsWith('12 triangles')`),'Native source topology frozen');
  await click('Apply');
  await waitFor(`!${button('Apply')} && !document.querySelector('.preview-progress') && window.projectionPosts>${before}`);
  assert.equal(await evaluate('window.projectionPosts'),before+1,'Apply triggers exactly one projection calculation');
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true}))`);
  await settled();
  await waitFor(`document.querySelector('[aria-label="Preview image size"]').value==='1' && Array.from(document.querySelectorAll('.custom-model-controls .slider-row')).find(r=>r.textContent.includes('Image angle')).querySelector('input').value==='0'`);
  const beforeCancel=await evaluate('window.projectionPosts');
  await click('Project from view');await waitFor(`Boolean(${button('Apply')})`);
  await evaluate(`window.setInput(document.querySelector('[aria-label="Preview image size"]'),'0.5')`);
  await click('Cancel placement');
  await new Promise(r=>setTimeout(r,400));
  assert.equal(await evaluate('window.projectionPosts'),beforeCancel,'Cancel restores prior mesh without recalculating');
  assert.equal(await evaluate(`document.querySelector('[aria-label="Preview image size"]').value`),'1','Cancel restores prior mapping');
  // Perspective pointer dragging and resizing use the selected camera too.
  await click('Front');
  await click('Project from view');await waitFor(`Boolean(${button('Apply')})`);
  await click('Move image');
  const perspectiveBounds=await evaluate(`(()=>{const b=document.querySelector('.viewport canvas').getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2}})()`);
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:perspectiveBounds.x,y:perspectiveBounds.y,button:'left',clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:perspectiveBounds.x+25,y:perspectiveBounds.y,button:'left',buttons:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:perspectiveBounds.x+25,y:perspectiveBounds.y,button:'left',clickCount:1});
  assert(await evaluate(`Array.from(document.querySelectorAll('.slider-row')).find(r=>r.textContent.includes('Offset X')).querySelector('output').textContent!=='0.00'`),'Perspective ray casting moves image');
  await send('Emulation.setDeviceMetricsOverride',{width:1200,height:900,deviceScaleFactor:1,mobile:false});
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  await waitFor(`!${button('Apply')} && !${button('Done moving')}`);
  assert.equal(await evaluate('window.projectionPosts'),beforeCancel,'Escape and resize do not regenerate paint');
  // Cancelling while an image is decoding must discard its eventual result.
  const priorImage=await evaluate(`document.querySelector('img[alt="Mapped preview"]').src`);
  await click('Project from view');await waitFor(`Boolean(${button('Apply')})`);
  await evaluate(`window.originalDecode=HTMLImageElement.prototype.decode;HTMLImageElement.prototype.decode=function(){return window.originalDecode.call(this).then(()=>new Promise(resolve=>window.releaseImageDecode=resolve))};window.uploadImage(true)`);
  await waitFor(`typeof window.releaseImageDecode==='function' && ${button('Apply')}.disabled`);
  await click('Cancel placement');
  await evaluate(`HTMLImageElement.prototype.decode=window.originalDecode;window.releaseImageDecode()`);
  await new Promise(r=>setTimeout(r,300));
  assert.equal(await evaluate(`document.querySelector('img[alt="Mapped preview"]').src`),priorImage,'Cancelled image decoding cannot overwrite restored placement');
  assert.equal(await evaluate('window.projectionPosts'),beforeCancel,'Late decoding cannot start an extra worker');
  assert.deepEqual(errors,[],'No browser exceptions');
  assert.deepEqual(consoleErrors,[],'No shader/rendering errors');
  console.log('PASS: orthographic/perspective cameras, rendered overlay orientation and transparency, zero geometry/worker updates in placement mode, one Apply calculation, atomic undo, cancel');
} finally {if(instrumentation) await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:instrumentation.identifier});socket.close();}
