import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {readSceneDocument} from '../../vendor/shotloom-director-desk/src/core/scenes/sequence-project.ts';
import {connectPage} from './browser-cdp.mjs';

const fixture=JSON.parse(await readFile(process.env.SHOTLOOM_QA_FIXTURE,'utf8'));
assert.equal(new URL(fixture.origin).port,'14433');
const records=[];
async function request(path,method='GET',value){
 const response=await fetch(`${fixture.origin}/api${path}`,{method,headers:{Cookie:fixture.cookie,Origin:fixture.origin,...(value?{'Content-Type':'application/json'}:{})},...(value?{body:JSON.stringify(value)}:{}),signal:AbortSignal.timeout(20000)});
 const body=await response.json();
 assert.equal(response.status,200,`${method} ${path}: ${body.code} ${body.message}`);
 return body.data;
}
const snapshotPath=`/project/${fixture.editorProjectId}/snapshot/workspace-video-editor`;
const before=await request(snapshotPath);
assert.equal(before.mediaLibrary.items.length,48);
assert.equal(before.timeline.tracks[0].clips.length,1);
const directorPath=`/project/${fixture.directorProjectId}`;
const director=await request(directorPath);
const node=director.nodes.find(node=>node.type==='threeDDirector');
const reference=node.directorData.project.resources[0].package;
const signed=await request('/files/sign-batch','POST',{objects:[{bucket:'media',key:reference.path.replace('cloud://media/','')}]});
const bytes=Buffer.from(await (await fetch(signed[0].url)).arrayBuffer());
assert.equal(createHash('sha256').update(bytes).digest('hex'),reference.sha256);
const hydrated=structuredClone(node.directorData.project);
hydrated.resources[0].package=JSON.parse(bytes);
const document=readSceneDocument(hydrated);
document.resources[0].package=reference;
if(node.directorData.project.version!==3){
 node.directorData.project=document;
 await request(directorPath,'PUT',director);
}
records.push({check:'director fixture schema and model SHA256',passed:true});
const page=await connectPage(process.env.SHOTLOOM_QA_CDP);
const requests=[];
const workerLoads=[];
const modelReads=[];
page.on('Network.requestWillBeSent',event=>{const path=new URL(event.request.url).pathname;if(path.includes('director-model.json'))modelReads.push(path);});
page.on('Network.responseReceived',event=>{const url=new URL(event.response.url);if(url.pathname==='/harness/worker/worker.mjs')workerLoads.push(event.response.status);if(url.pathname.startsWith('/api/'))requests.push({path:url.pathname,status:event.response.status});});
try{
 await page.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
 await page.send('Page.navigate',{url:`${fixture.origin}/?route=creation&project=${fixture.editorProjectId}`});
 await page.wait(`!!document.querySelector('.react-flow__viewport')`);
 await page.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Video editing').click()`);
 const root=`document.querySelector('.clip-studio-runtime-host')?.shadowRoot`;
 await page.wait(`!!${root}?.querySelector('[aria-label="Select clip QA editor image 0"]')`,60000);
 await page.evaluate(`[...${root}.querySelectorAll('nav[aria-label="Editor workspace"] button')].find(b=>b.textContent==='Media').click()`);
 await page.wait(`${root}?.querySelector('input[placeholder="Search media"]')!==null`);
 records.push({check:'editor opens with persisted timeline and media browser',passed:true});
 await page.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Back to canvas').click()`);
 await page.wait(`![...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Back to canvas')`);
 const after=await request(snapshotPath);
 assert.equal(after.mediaLibrary.items.length,48);
 assert.deepEqual(after.mediaLibrary.items.map(item=>item.id).sort(),before.mediaLibrary.items.map(item=>item.id).sort());
 assert.equal(after.timeline.tracks[0].clips[0].mediaId,before.timeline.tracks[0].clips[0].mediaId);
 records.push({check:'editor close/save preserves all 48 stable media IDs and clip reference',passed:true});
 requests.length=0;workerLoads.length=0;
 await page.send('Page.navigate',{url:`${fixture.origin}/?route=creation&project=${fixture.directorProjectId}`});
 await page.wait(`!!document.querySelector('.director-node-open-button')`);
 assert.equal(modelReads.length,0);
 records.push({check:'director canvas defers model package download',passed:true});
 await page.evaluate(`document.querySelector('.director-node-open-button').click()`);
 await page.wait(`!!document.querySelector('.director-detail-frame')`,60000);
 await page.wait(`!!document.querySelector('.director-detail-frame')?.contentDocument?.querySelector('canvas')`,60000);
 await page.wait(`performance.getEntriesByType('resource').some(entry=>entry.name.includes('director-model.json'))`);
 assert.ok(modelReads.length>0,'Opening the director must hydrate its cloud model');
 records.push({check:'director detail mounts renderer',passed:true});
 await new Promise(resolve=>setTimeout(resolve,22000));
 await request(snapshotPath);
 assert.deepEqual(workerLoads,[200],'The local Worker starts once for the mounted project');
 assert.equal(requests.filter(request=>request.path==='/api/agent/connect').length,0,'The browser must not start a server Agent loop');
 records.push({check:'Agent stays in one local Worker and authenticated snapshot reads succeed after the original HTTP budget expires',passed:true});
 await writeFile(process.env.SHOTLOOM_QA_EVIDENCE,JSON.stringify({checks:records,requests},null,2));
 console.log(JSON.stringify(records));
}finally{page.close();}
