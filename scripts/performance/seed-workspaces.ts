// Run from the isolated container's /app/server after copying this file there.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {env} from './src/env.ts';
import {admin} from './src/lib/supabase.ts';
import {listProjects,loadProject,saveProject,saveSnapshot,loadSnapshot} from './src/lib/store.ts';

assert.equal(env.GATEWAY_CLIENT_ID,'shotloom-performance-qa');
assert.equal(new URL(env.FRONTEND_URL).port,'14433');
const fixture=JSON.parse(readFileSync('/qa/private.json','utf8'));
const projects=await listProjects(fixture.userId) as any[];
const editorEntry=projects.find(p=>p.name==='QA 03'||p.name==='QA Editor');
const taskEntry=projects.find(p=>p.name==='QA 04'||p.name==='QA Tasks');
assert.ok(editorEntry&&taskEntry);
const editor=await loadProject(fixture.userId,editorEntry.id) as any;
const media=await loadProject(fixture.userId,fixture.mediaProjectId) as any;
assert.equal(media.materials.length,48);
const settings={width:1920,height:1080,frameRate:30,sampleRate:48000,channels:2};
const assets=media.materials.map((m:any,i:number)=>({id:`qa-editor-asset-${i}`,type:'image',name:`QA editor image ${i}`,sourceFile:m.filePath,duration:5,width:1920,height:1080}));
const items=assets.map((a:any,i:number)=>({id:`qa-editor-media-${i}`,name:a.name,type:'image',blob:null,fileHandle:null,metadata:{duration:5,width:1920,height:1080,frameRate:0,codec:'png',sampleRate:0,channels:0,fileSize:1612729},thumbnailUrl:null,waveformData:null,shotloomAssetId:a.id}));
const clip={id:'qa-editor-clip',mediaId:items[0].id,trackId:'qa-editor-track',startTime:0,duration:5,inPoint:0,outPoint:5,effects:[],audioEffects:[],transform:{position:{x:0,y:0},scale:{x:1,y:1},rotation:0,anchor:{x:0.5,y:0.5},opacity:1,fitMode:'contain'},volume:1,keyframes:[],speed:1};
const now=Date.now();
const native={id:'qa-editor-native',name:'QA Editor',createdAt:now,modifiedAt:now,settings,mediaLibrary:{items},timeline:{tracks:[{id:clip.trackId,type:'video',name:'QA Track',clips:[clip],transitions:[],locked:false,hidden:false,muted:false,solo:false}],subtitles:[],duration:5,markers:[]},motionCompositions:[],motionInstances:[]};
editor.name='QA Editor';
editor.videoEditorSession={title:'QA Editor',project:{schema:'shotloom.video-edit',version:2,settings:{width:1920,height:1080,fps:30,backgroundColor:'#050608'},assets,tracks:[{id:clip.trackId,type:'video',name:'QA Track',clips:[{id:clip.id,type:'image',assetId:assets[0].id,timelineStart:0,trimStart:0,trimEnd:5,speed:1,muted:false,transform:{x:0,y:0,width:1920,height:1080,opacity:1,angle:0,fit:'fit'},effects:[]}],locked:false,hidden:false,muted:false}],openReelSnapshot:'project.sqlite#editor/workspace-video-editor',updatedAt:new Date(now).toISOString()}};
await saveProject(fixture.userId,editor.id,editor);
await saveSnapshot(editor.id,'workspace-video-editor',native);
const persisted=await loadSnapshot(editor.id,'workspace-video-editor') as any;
assert.equal(persisted.mediaLibrary.items.length,48);
assert.equal(persisted.timeline.tracks[0].clips[0].mediaId,items[0].id);
const tasks=await loadProject(fixture.userId,taskEntry.id) as any;
tasks.name='QA Tasks';
tasks.nodes=[];tasks.tasks=[];
for(const status of ['completed','failed','cancelled']){
 const nodeId=randomUUID();
 tasks.nodes.push({id:nodeId,type:'videoGeneration',title:`QA ${status}`,x:0,y:0,status,model:'qa-display-only'});
 tasks.tasks.push({id:randomUUID(),nodeId,status,runner:'remote',model:'qa-display-only',remoteTaskId:`qa-${status}`,progress:status==='completed'?100:0,createdAt:new Date(now).toISOString(),completedAt:new Date(now).toISOString(),error:status==='failed'?'QA fixture error':undefined});
}
await saveProject(fixture.userId,tasks.id,JSON.parse(JSON.stringify(tasks)));
const granted=await admin.from('app_admins').upsert({client_id:env.GATEWAY_CLIENT_ID,user_id:fixture.userId});
assert.equal(granted.error,null);
writeFileSync('/qa/private.json',JSON.stringify({...fixture,editorProjectId:editor.id,taskProjectId:tasks.id}),{mode:0o600});
console.log('Prepared 48-media editor snapshot, terminal task history and isolated admin membership; no generation submitted');
