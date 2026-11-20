import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('catalog projections and incremental CAS preserve unrelated records and detect legacy writes', async () => {
  const db = new PGlite(), user = randomUUID(), other = randomUUID();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role; create schema shotloom;
      create table shotloom.users(id uuid primary key);
      create table shotloom.catalog_metadatas(user_id uuid,scope text,payload jsonb,primary key(user_id,scope));`);
    for (const table of ['skills','recipes','catalog_assets','catalog_materials']) await db.exec(`create table shotloom.${table}(user_id uuid,id text,position integer,payload jsonb,primary key(user_id,id));`);
    await db.query('insert into shotloom.users values($1),($2)',[user,other]);
    const legacy = await readFile(new URL('../../supabase/migrations/20261115022109_shotloom_storage_integrity.sql',import.meta.url),'utf8');
    await db.exec(legacy.slice(legacy.indexOf('create function shotloom.save_catalog')));
    await db.exec(await readFile(new URL('../../supabase/migrations/20261120062422_catalog_incremental_reads.sql',import.meta.url),'utf8'));
    const call = async (sql:string,args:unknown[]) => (await db.query<{value:any}>(`select shotloom.${sql} as value`,args)).rows[0]!.value;
    const skills = Array.from({length:25},(_,i)=>({id:`skill-${String(i).padStart(2,'0')}`,name:'Same',instructions:'x'.repeat(10000)}));
    await call('save_catalog($1,$2,$3)',[user,'skills',{storageVersion:1,skills}]);
    const version = await call('read_catalog_versioned($1,$2)',[user,'skills']);
    assert.equal(version.revision,1); assert.equal(version.catalog.skills.length,25);
    const first = await call('list_catalog_page($1,$2,$3,$4,$5,$6)',[user,'skills','','name',0,20]);
    const second = await call('list_catalog_page($1,$2,$3,$4,$5,$6)',[user,'skills','','name',20,20]);
    assert.deepEqual([...first.items,...second.items].map((item:any)=>item.id),skills.map(item=>item.id));
    assert.ok(JSON.stringify(first).length<5000); assert.equal(first.items[0].instructions,undefined);
    assert.equal((await call('catalog_detail($1,$2,$3)',[user,'skills','skill-00'])).instructions.length,10000);
    assert.equal(await call('catalog_detail($1,$2,$3)',[other,'skills','skill-00']),null);
    const changes = {skills:{upsert:[{...skills[0],name:'Edited'}],remove:['skill-01']}};
    const saved = await call('patch_catalog($1,$2,$3,$4,$5)',[user,'skills',1,changes,{storageVersion:1}]);
    assert.equal(saved.revision,2);
    await assert.rejects(call('patch_catalog($1,$2,$3,$4,$5)',[user,'skills',1,changes,{}]),(e:any)=>e.code==='PT409');
    const rows = await call('load_catalog($1,$2)',[user,'skills']);
    assert.equal(rows.skills.length,24); assert.deepEqual(rows.skills[1],skills[2]);
    await call('save_catalog($1,$2,$3)',[user,'skills',rows]);
    await assert.rejects(call('patch_catalog($1,$2,$3,$4,$5)',[user,'skills',2,changes,{}]),(e:any)=>e.code==='PT409');
    await assert.rejects(call('patch_catalog($1,$2,$3,$4,$5)',[user,'skills',3,{materials:{upsert:[],remove:[]}},{}]));
    assert.equal((await call('read_catalog_versioned($1,$2)',[user,'skills'])).revision,3,'failed patches are atomic');
    await call('patch_catalog($1,$2,$3,$4,$5)',[user,'skills',3,{skills:{upsert:[],remove:[]} },{}]);
    assert.equal((await call('load_catalog($1,$2)',[user,'skills'])).storageVersion,1,'summary edits retain catalog metadata');
    await call('save_catalog($1,$2,$3)',[user,'assets',{assets:[{id:'a',materialId:'m',category:'character',name:'Hero'},{id:'b',materialId:'m',category:'scene',name:'Background'}],materials:[{id:'m',path:'cloud://media/image.png',content:'large body'}],references:[{assetId:'a'},{assetId:'a'},{assetId:'b'}]}]);
    const assetPage=await call('list_catalog_page($1,$2,$3,$4,$5,$6,$7)',[user,'assets','','name',0,20,['character']]);
    assert.equal(assetPage.total,1);assert.equal(assetPage.items[0].id,'a');assert.equal(assetPage.items[0].usageCount,2);
    assert.equal(assetPage.items[0].path,'cloud://media/image.png');assert.equal(assetPage.items[0].content,undefined);
  } finally { await db.close(); }
});
