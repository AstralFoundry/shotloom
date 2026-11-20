import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
Object.assign(process.env, {
  NODE_ENV: 'test', GATEWAY_BASE_URL: 'https://gateway.example.com', GATEWAY_CLIENT_ID: 'nac_test',
  GATEWAY_CLIENT_SECRET: 'test-secret', GATEWAY_REDIRECT_URI: 'http://localhost:5173/api/auth/callback', FRONTEND_URL: 'http://localhost:5173',
  SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-service-role', SUPABASE_PUBLISHABLE_KEY: 'test-publishable', SESSION_ENCRYPTION_KEY: '11'.repeat(32),
});
const { app } = await import('../src/index');
const { encrypt } = await import('../src/lib/crypto');

test('project pages are stable projections and renaming preserves all graph data with revision conflicts', async () => {
  const db = new PGlite(), original = globalThis.fetch, user = randomUUID(), other = randomUUID(), session = randomUUID();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema shotloom;
      create table shotloom.settings(user_id uuid,key text,payload jsonb,primary key(user_id,key));
      create table shotloom.inbox_notifications(user_id uuid,client_id text,read_at timestamptz);
      create table shotloom.projects(id uuid primary key,user_id uuid,name text,revision bigint,folder_id uuid,created_at timestamptz default now(),updated_at timestamptz default now(),payload jsonb);`);
    await db.exec(await readFile(new URL('../../supabase/migrations/20261120055657_page_performance_reads.sql', import.meta.url), 'utf8'));
    const ids = Array.from({ length: 25 }, () => randomUUID());
    for (const id of ids) await db.query('insert into shotloom.projects(id,user_id,name,revision,payload) values($1,$2,$3,1,$4)', [id,user,'Same name',{ name:'Same name',directorWorkspaceProject:{ large:'x'.repeat(10000) },nodes:[{id:'keep'}] }]);
    const foreign = randomUUID();
    await db.query("insert into shotloom.projects(id,user_id,name,revision,payload) values($1,$2,'Foreign',1,'{}')",[foreign,other]);
    globalThis.fetch = async (input, init) => {
      const table = new URL(String(input)).pathname.split('/').at(-1);
      if (table === 'sessions') return Response.json({ id:session,user_id:user,owner:{id:user,sub:'1'},access_token_cipher:encrypt('token'),refresh_token_cipher:null,created_at:new Date().toISOString(),expires_at:new Date(Date.now()+3600000).toISOString() });
      const args = JSON.parse(String(init?.body));
      try {
        let result;
        if (table === 'list_project_page') result = await db.query<{value:unknown}>('select shotloom.list_project_page($1,$2,$3,$4,$5,$6) as value',[args.p_user_id,args.p_folder_id,args.p_search,args.p_sort,args.p_offset,args.p_limit]);
        else { assert.equal(table,'rename_project'); result = await db.query<{value:unknown}>('select shotloom.rename_project($1,$2,$3,$4) as value',[args.p_user_id,args.p_id,args.p_name,args.p_expected]); }
        return Response.json(result.rows[0]!.value);
      } catch(error) { return Response.json({ code:(error as {code:string}).code,message:'rejected' },{status:400}); }
    };
    const request = (path: string,method='GET',value?:unknown) => app.request(`/api${path}`,{method,headers:{cookie:`shotloom_session=${session}`,origin:'http://localhost:5173','content-type':'application/json'},...(value===undefined?{}:{body:JSON.stringify(value)})});
    const firstResponse = await request('/projects/page?limit=20&sort=name'); assert.equal(firstResponse.status,200);
    const first = (await firstResponse.json()).data, second = (await (await request('/projects/page?limit=20&offset=20&sort=name')).json()).data;
    assert.equal(first.total,25); assert.equal(first.items.length,20); assert.equal(second.items.length,5);
    assert.deepEqual([...first.items,...second.items].map(item=>item.id), [...ids].sort());
    assert.ok(JSON.stringify(first).length<10000,'large model/project payloads must not appear in list projections');
    assert.equal((await (await request('/projects/page?search=missing')).json()).data.total,0);
    assert.equal((await request('/projects/page?limit=101')).status,400);
    const renamed = await request(`/project/${ids[0]}`,'PATCH',{name:'Renamed',expectedRevision:1});
    assert.equal(renamed.status,200); assert.equal((await renamed.json()).data.storageRevision,2);
    assert.equal((await request(`/project/${ids[0]}`,'PATCH',{name:'Stale',expectedRevision:1})).status,409);
    assert.equal((await request(`/project/${foreign}`,'PATCH',{name:'Forbidden',expectedRevision:1})).status,404);
    const saved = (await db.query<{payload:{nodes:unknown[]}}>('select payload from shotloom.projects where id=$1',[ids[0]])).rows[0]!;
    assert.deepEqual(saved.payload.nodes,[{id:'keep'}]);
  } finally { globalThis.fetch=original; await db.close(); }
});
