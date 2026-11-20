import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createRendererEnv} from '../../tests/helpers/rendererSsr.mjs';

// Only file picker/download DOM edges are substituted; project and storage operations use the candidate.
const fixture=JSON.parse(await readFile(process.env.SHOTLOOM_QA_FIXTURE,'utf8'));
assert.equal(new URL(fixture.origin).port,'14433');
const env=await createRendererEnv({storageMode:'cloud',withWindow:true});
const realFetch=globalThis.fetch;
let exported;
const created=[];
globalThis.fetch=async (value,init={})=>{
 const url=new URL(value,fixture.origin);
 assert.equal(url.origin,fixture.origin,'Only the isolated candidate may receive fixture requests');
 const headers=new Headers(init.headers);
 if(url.pathname.startsWith('/api/')){headers.set('Cookie',fixture.cookie);headers.set('Origin',fixture.origin);}
 return realFetch(url,{...init,headers,signal:init.signal||AbortSignal.timeout(30000)});
};
globalThis.document={createElement(tag){
 if(tag==='a')return {async click(){exported=await (await realFetch(this.href)).blob();}};
 assert.equal(tag,'input');
 const listeners={};
 return {files:[],addEventListener(type,fn){listeners[type]=fn;},click(){this.files=[exported];listeners.change();}};
}};
const dir=`cloud/projects/${fixture.directorProjectId}`;
function model(project){return project.nodes.find(node=>node.type==='threeDDirector').directorData.project.resources[0].package;}
try{
 const {createCloudApi}=await env.load('services/cloudApi');
 const api=createCloudApi({});
 const source=(await api.project.openFolder(dir)).project;
 const reference=model(source);
 assert.equal(reference.storage,'shotloom-director-model');
 const copy=await api.project.cloneFolder(dir,'QA Director roundtrip');created.push(copy.projectDir);
 assert.deepEqual(model(copy.project),reference);
 const saved=await api.project.save(copy.projectDir,copy.project);
 assert.deepEqual(model(saved.project),reference);
 await api.project.exportPackage(copy.projectDir,'QA Director roundtrip');
 while(!exported)await new Promise(resolve=>setTimeout(resolve,10));
 assert.ok(exported.size>0);
 const imported=await api.project.openFolderDialog();created.push(imported.projectDir);
 const importedReference=model(imported.project);
 assert.equal(importedReference.storage,'shotloom-director-model');
 assert.equal(importedReference.sha256,reference.sha256);
 const hydrated=await api.project.readBundle(imported.projectDir);
 const originalHydrated=await api.project.readBundle(dir);
 assert.deepEqual(model(hydrated.project),model(originalHydrated.project));
 await writeFile(process.env.SHOTLOOM_QA_EVIDENCE,JSON.stringify({checks:['copy preserves cloud model reference','save preserves model reference','portable ZIP export/import preserves model SHA256','imported and source model bytes hydrate identically'],passed:true,exportBytes:exported.size},null,2));
 console.log('Director copy/save/export/import roundtrip passed against isolated BFF and storage');
}finally{
 for(const directory of created){
  const response=await globalThis.fetch(`/api/project/${directory.split('/').at(-1)}`,{method:'DELETE'});
  assert.equal(response.status,200);
 }
 globalThis.fetch=realFetch;delete globalThis.document;await env.dispose();
}
