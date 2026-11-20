import test from 'node:test';
import assert from 'node:assert/strict';
import {createRendererEnv} from './helpers/rendererSsr.mjs';

test('summary/detail writes use the captured revision and never turn 403, 409 or outages into a full save', async()=>{
 const env=await createRendererEnv(), before=globalThis.fetch, calls=[];
 let status=200;
 globalThis.fetch=async(url,init)=>{
  calls.push({url,method:init.method,body:init.body&&JSON.parse(init.body)});
  if(status!==200)return Response.json({success:false,code:'CONFLICT',message:'failed'},{status});
  return Response.json({success:true,data:url.includes('/page?')?{items:[{id:'one'}],revision:7,total:1,offset:0,limit:20,projection:true}:url.includes('/item/')?{id:'one',instructions:'full'}:{revision:8}});
 };
 try{
  const api=await env.load('services/cloudCatalogPages');
  const page=await api.readCatalogPage('skills','offset=0&limit=20');
  assert.equal(page.items[0].instructions,undefined);
  const detail=await api.readCatalogItem('skills','one');
  await api.patchCatalogItems('skills',page.revision,[{...detail,instructions:'edited'}],[]);
  assert.deepEqual(calls.at(-1).body,{expectedRevision:7,changes:{skills:{upsert:[{id:'one',instructions:'edited'}],remove:[]}},metadata:{}});
  for(status of [403,409,503]){
   const count=calls.length;
   await assert.rejects(api.patchCatalogItems('skills',7,[detail],[]),error=>error.status===status);
   assert.equal(calls.length,count+1);
   await assert.rejects(api.readCatalogPage('skills','offset=0&limit=20'),error=>error.status===status);
  }
 }finally{globalThis.fetch=before;await env.dispose();}
});

test('legacy summary fallback joins material paths, aggregates usage and keeps complete unrelated records on explicit writes',async()=>{
 const env=await createRendererEnv(),before=globalThis.fetch,calls=[];
 const catalog={storageVersion:1,custom:'keep',assets:[{id:'one',materialId:'m',name:'Hero',category:'character'},{id:'two',name:'Scene',category:'scene'}],materials:[{id:'m',path:'cloud://media/image.png'}],references:[{assetId:'one'},{assetId:'one'}]};
 globalThis.fetch=async(url,init)=>{
  calls.push({url,method:init.method,body:init.body&&JSON.parse(init.body)});
  if(url.includes('/page?')||init.method==='PATCH')return Response.json({success:false},{status:404});
  return Response.json({success:true,data:catalog});
 };
 try{
  const api=await env.load('services/cloudCatalogPages');
  const page=await api.readCatalogPage('assets','offset=0&limit=20&category=character');
  assert.equal(page.total,1);assert.equal(page.items[0].path,'cloud://media/image.png');assert.equal(page.items[0].usageCount,2);
  await api.patchCatalogItems('assets',undefined,[{...catalog.assets[0],name:'Edited'}],[]);
  const saved=calls.at(-1);assert.equal(saved.method,'PUT');assert.equal(saved.body.custom,'keep');
  assert.deepEqual(saved.body.assets.find(item=>item.id==='two'),catalog.assets[1]);assert.deepEqual(saved.body.materials,catalog.materials);
 }finally{globalThis.fetch=before;await env.dispose();}
});
