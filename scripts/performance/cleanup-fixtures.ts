// Copy into the isolated container's /app/server and run only after acceptance.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {env} from './src/env.ts';
import {admin} from './src/lib/supabase.ts';

assert.equal(env.GATEWAY_CLIENT_ID,'shotloom-performance-qa');
assert.equal(new URL(env.FRONTEND_URL).port,'14433');
const fixture=JSON.parse(readFileSync('/qa/private.json','utf8'));
// Include the first failed seed's synthetic pair in this task's exclusive QA client.
const users=await admin.from('users').select('id,sub').eq('client_id',env.GATEWAY_CLIENT_ID);
assert.equal(users.error,null);
assert.ok(users.data&&users.data.length>=2&&users.data.length<=4);
assert.ok(users.data.every(user=>user.sub.startsWith('qa-')),'Only this task’s synthetic users may be removed');
const ids=users.data.map(user=>user.id);
assert.ok(ids.includes(fixture.userId)&&ids.includes(fixture.otherUserId));
let removedObjects=0;
for(const bucket of ['shotloom-media','shotloom-assets'])for(const id of ids){
 const prefix=`${env.GATEWAY_CLIENT_ID}/${id}`;
 const folders=[prefix],files=[] as string[];
 for(let index=0;index<folders.length;index++){
  assert.ok(folders.length<1000,'Unexpected fixture folder count');
  const listed=await admin.storage.from(bucket).list(folders[index],{limit:1000});
  assert.equal(listed.error,null);
  assert.ok(listed.data&&listed.data.length<1000);
  for(const item of listed.data){
   assert.ok(item.name&&!/[\\/]/.test(item.name)&&item.name!=='.'&&item.name!=='..');
   const path=`${folders[index]}/${item.name}`;
   assert.ok(path.startsWith(`${prefix}/`));
   if(item.id)files.push(path);else folders.push(path);
  }
 }
 if(files.length){
  const removed=await admin.storage.from(bucket).remove(files);
  assert.equal(removed.error,null);
  removedObjects+=files.length;
 }
 const remaining=await admin.storage.from(bucket).list(prefix,{limit:1});
 assert.equal(remaining.error,null);assert.equal(remaining.data?.length,0);
}
const removed=await admin.from('users').delete().in('id',ids).eq('client_id',env.GATEWAY_CLIENT_ID).select('id');
assert.equal(removed.error,null);assert.equal(removed.data?.length,ids.length);
for(const table of ['users','sessions','projects'] as const){
 const column=table==='users'?'id':'user_id';
 const remaining=await admin.from(table).select('id').in(column,ids);
 assert.equal(remaining.error,null);assert.equal(remaining.data?.length,0);
}
const statuses=[];
for(const port of [14433,14434])for(const kind of ['cookie','native']){
 const origin=fixture.origin.replace(':14433',`:${port}`);
 const response=await fetch(`${origin}/api/auth/me`,{headers:kind==='cookie'?{Cookie:fixture.cookie}:{Authorization:`Bearer ${fixture.native.token}`},signal:AbortSignal.timeout(20000)});
 statuses.push({port,kind,status:response.status});
 assert.equal(response.status,401,'The old QA session must no longer authorize any client');
}
writeFileSync('/qa/cleanup-evidence.json',JSON.stringify({removedUsers:ids.length,removedObjects,sessionChecks:statuses},null,2));
console.log('Removed isolated fixture users and objects; old Cookie and Native sessions rejected on both builds');
