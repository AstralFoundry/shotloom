import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

const fixture=JSON.parse(await readFile(process.env.SHOTLOOM_QA_FIXTURE,'utf8'));
const origin=fixture.origin;
assert.notEqual(origin,'https://shotloom.0xfiang.com','Use an isolated candidate');
assert.equal(new URL(origin).protocol,'https:');
const evidence=[];
async function request(path,{method='GET',value,status=200,other=false}={}){
 const started=performance.now();
 const response=await fetch(`${origin}/api${path}`,{method,headers:{Cookie:other?fixture.cookie.replace(fixture.session,fixture.otherSession):fixture.cookie,Origin:origin,...(value===undefined?{}:{'Content-Type':'application/json'})},...(value===undefined?{}:{body:JSON.stringify(value)}),signal:AbortSignal.timeout(20000)});
 const text=await response.text();
 evidence.push({method,path:path.split('?')[0],status:response.status,bytes:Buffer.byteLength(text),durationMs:performance.now()-started,serverTiming:response.headers.get('server-timing'),requestId:response.headers.get('x-request-id')});
 assert.equal(response.status,status,`${method} ${path} returned ${response.status}`);
 const body=JSON.parse(text);
 if(status<400)assert.equal(body.success,true);
 return body.data;
}

assert.equal((await request('/auth/me')).id,fixture.userId);
const all=await request('/projects');
const ids=[];let total;
for(let offset=0;;offset+=20){
 const page=await request(`/projects/page?offset=${offset}&limit=20&sort=name`);
 total=page.total;ids.push(...page.items.map(item=>item.id));
 assert.ok(page.items.every(item=>!('nodes' in item)&&!('materials' in item)));
 if(ids.length>=total)break;
}
assert.equal(ids.length,all.length);assert.equal(new Set(ids).size,total);
const summary=await request('/catalog/skills/page?offset=0&limit=20');
assert.equal(summary.items.length,20);assert.equal(summary.total,65);assert.ok(summary.items.every(item=>!('instructions' in item)));
const detail=await request('/catalog/skills/item/qa-skill-00');
assert.ok(detail.instructions.length>1000);
const patched=await request('/catalog/skills',{method:'PATCH',value:{expectedRevision:summary.revision,changes:{skills:{upsert:[{...detail,description:'Updated QA fixture'}],remove:[]}},metadata:{}}});
await request('/catalog/skills',{method:'PATCH',status:409,value:{expectedRevision:summary.revision,changes:{skills:{upsert:[],remove:['qa-skill-01']}},metadata:{}}});
const full=await request('/catalog/skills');assert.equal(full.customMetadata,'preserve');assert.equal(full.storageVersion,1);assert.equal(full.skills.length,65);
await request('/catalog/skills',{method:'PATCH',value:{expectedRevision:patched.revision,changes:{skills:{upsert:[detail],remove:[]}},metadata:{}}});
const assets=await request('/catalog/assets/page?category=character&offset=0&limit=20');
assert.equal(assets.items.length,20);assert.ok(assets.items.every(item=>item.path&&item.materialId));
await request(`/project/${fixture.projectId}/summary`,{other:true,status:404});
const project=await request(`/project/${fixture.projectId}`);
const renamed=await request(`/project/${fixture.projectId}`,{method:'PATCH',value:{name:'QA rename',expectedRevision:project.storageRevision}});
await request(`/project/${fixture.projectId}`,{method:'PATCH',status:409,value:{name:'Stale rename',expectedRevision:project.storageRevision}});
await request(`/project/${fixture.projectId}`,{method:'PATCH',value:{name:project.name,expectedRevision:renamed.storageRevision}});
const roundtrip=await request(`/project/${fixture.projectId}`);assert.deepEqual(roundtrip.nodes,project.nodes);assert.deepEqual(roundtrip.materials,project.materials);
const startup=await request(`/project/${fixture.mediaProjectId}/startup?parts=project,settings`);assert.equal(startup.project.materials.length,48);assert.equal(startup.assets,undefined);
const objects=[{bucket:'media',key:'qa/image-0.png'},{bucket:'media',key:'qa/missing.png'}];
const checked=await request('/files/check',{method:'POST',value:{objects}});assert.deepEqual(checked.map(item=>item.status),['exists','missing']);
const signed=await request('/files/sign-batch',{method:'POST',value:{objects}});assert.deepEqual(signed.map(item=>item.status),['exists','missing']);
assert.equal((await fetch(signed[0].url,{method:'HEAD'})).status,200);
assert.equal((await request('/files/check',{method:'POST',value:{objects:[objects[0]]},other:true}))[0].status,'missing');
await request('/files/check',{method:'POST',status:400,value:{objects:[{bucket:'media',key:'../other'}]}});
assert.equal((await request('/settings/preferences',{method:'PATCH',value:{agentAutoEval:false}})).agentAutoEval,false);
await request('/settings/preferences',{method:'PATCH',status:400,value:{balance:1000000}});
for(const path of ['/auth/account','/auth/usage?page=1&page_size=10','/models','/auth/topup/options','/notifications/unread','/notifications?offset=0&limit=20','/settings/mobile'])await request(path);
const feedbackId=randomUUID();await request('/feedback',{method:'POST',status:201,value:{id:feedbackId,kind:'feedback',description:'Latency_test_record',reference:''}});
await request(`/feedback/${feedbackId}`);await request(`/feedback/${feedbackId}`,{other:true,status:404});
await writeFile(process.env.SHOTLOOM_QA_EVIDENCE||'candidate-integration.json',JSON.stringify({checks:evidence.length,requests:evidence},null,2));
await writeFile(process.env.SHOTLOOM_QA_FIXTURE,JSON.stringify({...fixture,feedbackId}),{mode:0o600});
console.log(`Isolated HTTP integration passed: ${evidence.length} requests; pagination, CAS, ownership, media, settings and feedback`);
