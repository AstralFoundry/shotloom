import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {writeFileSync,readFileSync} from 'node:fs';
import {admin,upsertUser,createSession,scopedKey} from './src/lib/supabase.ts';
import {saveProject,saveCatalog,saveSettings} from './src/lib/store.ts';
import {issueNativeToken} from './src/lib/nativeAuth.ts';
import {env} from './src/env.ts';

assert.equal(env.GATEWAY_CLIENT_ID,'shotloom-performance-qa');
assert.equal(new URL(env.FRONTEND_URL).port,'14433');
const user=await upsertUser(`qa-${randomUUID()}`,{username:'Performance fixture'});
const other=await upsertUser(`qa-other-${randomUUID()}`,{username:'Other fixture'});
const session=await createSession(user.id,{accessToken:'isolated-display-fixture',tokenType:'Bearer',expiresAt:Date.now()+24*3600000});
const otherSession=await createSession(other.id,{accessToken:'isolated-other-fixture',tokenType:'Bearer',expiresAt:Date.now()+24*3600000});
const now=new Date().toISOString();
const empty=(id:string,name:string)=>({id,schema:'shotloom-project',schemaVersion:2,name,nodes:[],edges:[],assets:[],materials:[],tasks:[],settings:{autoSave:true},createdAt:now,updatedAt:now,canvasViewport:{x:0,y:0,zoom:1}});
const projects=[];
for(let i=0;i<45;i++){
 const id=randomUUID(), project=empty(id,`QA ${String(i).padStart(2,'0')}`);
 projects.push(project);
}
const png=readFileSync('/qa/fixture-1080p.png');
for(const name of ['shotloom-media','shotloom-assets']){
 const {error}=await admin.storage.createBucket(name,{public:false});
 if(error&&!/already exists/i.test(error.message))throw error;
}
const media=projects[1] as any;
media.name='QA Media';
for(let i=0;i<48;i++){
 const key=`qa/image-${i}.png`,id=randomUUID();
 const {error}=await admin.storage.from('shotloom-media').upload(scopedKey(user.id,key),png,{contentType:'image/png',upsert:true});if(error)throw error;
 media.materials.push({id,name:`Image ${i}`,path:`cloud://media/${key}`,filePath:`cloud://media/${key}`,ext:'png',mimeType:'image/png',resourceType:'image',size:png.length,importedAt:now});
 media.nodes.push({id:randomUUID(),type:'imageGeneration',sourceType:'upload',title:`Image ${i}`,x:(i%6)*350,y:Math.floor(i/6)*300,canvasWidth:300,canvasHeight:250,status:'idle',uploadedFile:{...media.materials.at(-1),kind:'image',source:'upload',materialId:id}});
}
const director=projects[2] as any;
director.name='QA Director';
const model={version:1,format:'obj',entry:'triangle.obj',files:[{path:'triangle.obj',data:Buffer.from('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n').toString('base64')}]};
const bytes=Buffer.from(JSON.stringify(model)),hash=createHash('sha256').update(bytes).digest('hex'),key='qa/director-model.json';
const uploaded=await admin.storage.from('shotloom-media').upload(scopedKey(user.id,key),bytes,{contentType:'application/json',upsert:true});if(uploaded.error)throw uploaded.error;
const scene=JSON.parse(readFileSync('/qa/director-scene.json','utf8'));
scene.version=2;scene.resources=[{id:`model-${hash}`,name:'QA triangle',copyright:'QA fixture',license:'CC0',source:'Synthetic',package:{storage:'shotloom-director-model',version:1,path:`cloud://media/${key}`,sha256:hash}}];
director.nodes.push({id:randomUUID(),type:'threeDDirector',title:'QA director',x:0,y:0,directorData:{project:scene}});
projects[0].name='Android Canvas Acceptance';
for(const project of projects)await saveProject(user.id,project.id,project);
const skills=Array.from({length:65},(_,i)=>({id:`qa-skill-${String(i).padStart(2,'0')}`,name:`QA Skill ${String(i).padStart(2,'0')}`,description:'Isolated performance fixture',instructions:'Use the current project context. '.repeat(300),category:'general',version:1,enabled:true,agentIds:['canvas-primary'],updatedAt:now}));
skills[0].name='Native Acceptance Skill';
await saveCatalog(user.id,'skills',{storageVersion:1,customMetadata:'preserve',skills});
await saveCatalog(user.id,'assets',{storageVersion:1,materials:media.materials,assets:media.materials.map((m:any,i:number)=>({id:`qa-asset-${i}`,materialId:m.id,name:m.name,category:'character'})),references:[]});
await saveSettings(user.id,{locale:'en-US',agentCanRunNodes:false,agentAutoEval:false,agentAutoLayout:true});
const fixture={origin:env.FRONTEND_URL,userId:user.id,otherUserId:other.id,projectId:projects[0]!.id,mediaProjectId:media.id,directorProjectId:director.id,session,otherSession,cookie:`${env.COOKIE_NAME}=${session}`,native:{token:issueNativeToken(session),userId:user.id}};
writeFileSync('/qa/private.json',JSON.stringify(fixture),{mode:0o600});
const response=await fetch(`${env.FRONTEND_URL}/api/auth/me`,{headers:{Cookie:fixture.cookie}});
assert.equal(response.status,200);assert.equal((await response.json()).data.id,user.id);
console.log('Created isolated users, 45 projects, 48 media and 65 skills; HTTP session verified');
