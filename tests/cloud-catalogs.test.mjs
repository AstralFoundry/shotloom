import test from 'node:test';
import assert from 'node:assert/strict';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

test('versioned catalogs send only changed records, retain metadata and never replay conflicts or outages', async () => {
  const env = await createRendererEnv(), original = globalThis.fetch, calls = [];
  const initial = {storageVersion:1,custom:'keep',skills:[{id:'one',instructions:'first'},{id:'two',instructions:'second'}]};
  let status = 200;
  globalThis.fetch = async (url,init) => {
    calls.push({url,method:init.method,body:init.body && JSON.parse(init.body)});
    if(url.endsWith('/versioned')) return Response.json({success:true,data:{catalog:initial,revision:4}});
    return Response.json({success:status===200,data:{revision:5},message:'Conflict'},{status});
  };
  try {
    const {createCloudCatalogs} = await env.load('services/cloudCatalogs');
    const catalogs = createCloudCatalogs();
    const loaded = await catalogs.read('skills');
    const saved = await catalogs.save('skills',{...loaded,skills:[{...loaded.skills[0],instructions:'edited'},loaded.skills[1]]});
    assert.deepEqual(calls[1].body,{expectedRevision:4,changes:{skills:{upsert:[{id:'one',instructions:'edited'}],remove:[]}},metadata:{storageVersion:1,custom:'keep'}});
    status=409;
    await assert.rejects(catalogs.save('skills',saved),error=>error.status===409);
    assert.equal(calls.length,3); assert.equal(calls[2].body.expectedRevision,5);
    await assert.rejects(catalogs.save('skills',{projection:true,skills:[]}),/projections/);
    status=503;
    await assert.rejects(catalogs.save('skills',saved),error=>error.status===503);
    assert.equal(calls.length,4,'a write failure must not become a full-directory replacement');
  } finally {globalThis.fetch=original;await env.dispose();}
});


test('a later full read cannot lend its revision to an older cloned editor catalog', async () => {
  const env = await createRendererEnv(), original = globalThis.fetch, writes = [];
  let revision = 4;
  globalThis.fetch = async (url, init) => {
    if (init.method === 'GET') return Response.json({success:true,data:{catalog:{skills:[{id:'one'}, ...(revision > 4 ? [{id:'other-device'}] : [])]},revision}});
    writes.push(init);
    return Response.json({success:true,data:{revision:6}});
  };
  try {
    const {createCloudCatalogs} = await env.load('services/cloudCatalogs');
    const catalogs = createCloudCatalogs();
    const stale = JSON.parse(JSON.stringify(await catalogs.read('skills')));
    revision = 5;
    await catalogs.read('skills');
    await assert.rejects(catalogs.save('skills',stale), error => error.status === 409);
    await assert.rejects(catalogs.save('skills',{skills:[]}), error => error.status === 409);
    assert.equal(writes.length,0);
  } finally {globalThis.fetch=original;await env.dispose();}
});


test('full catalog stores retain the read revision and extension metadata across saves', async () => {
  const env = await createRendererEnv({storage:new Map(),withWindow:true});
  try {
    const {desktopApi} = await env.load('services/desktopApi');
    for (const kind of ['skills','recipes']) {
      const storage = {storageVersion:1,__catalogRevision:7,custom:'preserved',[kind]:[]};
      desktopApi[kind].getGlobal = async () => structuredClone(storage);
      desktopApi[kind].setGlobal = async value => {
        assert.equal(value.__catalogRevision,7);
        assert.equal(value.custom,'preserved');
        return {...value,__catalogRevision:8};
      };
      const module = await env.load(`store/${kind}Store`);
      const suffix = kind[0].toUpperCase()+kind.slice(1);
      await module[`loadGlobal${suffix}`]();
      await module[`saveGlobal${suffix}`]();
    }
  } finally {await env.dispose();}
});
