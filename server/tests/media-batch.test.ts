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

test('batch media metadata and signatures retain missing/error distinctions and scope every object', async () => {
  const db = new PGlite(), original = globalThis.fetch, user = randomUUID(), session = randomUUID();
  let signingRequests = 0, metadataFailure = false;
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema shotloom; create schema storage;
      create table shotloom.users(id uuid,client_id text);
      create table shotloom.settings(user_id uuid,key text,payload jsonb,primary key(user_id,key));
      create table shotloom.inbox_notifications(user_id uuid,client_id text,read_at timestamptz);
      create table storage.objects(bucket_id text,name text,primary key(bucket_id,name));`);
    await db.exec(await readFile(new URL('../../supabase/migrations/20261120055657_page_performance_reads.sql', import.meta.url), 'utf8'));
    await db.query('insert into shotloom.users values($1,$2)', [user, 'nac_test']);
    for (const key of ['good.png', 'denied.png']) await db.query('insert into storage.objects values($1,$2)', ['shotloom-media', `nac_test/${user}/${key}`]);
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input)), table = url.pathname.split('/').at(-1);
      if (table === 'sessions') return Response.json({ id: session, user_id: user, owner: { id: user, sub: '1' }, access_token_cipher: encrypt('token'), refresh_token_cipher: null, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 3600000).toISOString() });
      if (table === 'check_media_objects') {
        if (metadataFailure) return Response.json({ message: 'unavailable', code: 'XX000' }, { status: 503 });
        const args = JSON.parse(String(init?.body));
        for (const object of args.p_objects) assert.ok(object.key.startsWith(`nac_test/${user}/`));
        return Response.json((await db.query<{ value: unknown }>('select shotloom.check_media_objects($1,$2,$3) as value', [args.p_user_id,args.p_client_id,args.p_objects])).rows[0]!.value);
      }
      assert.equal(url.pathname, '/storage/v1/object/sign/shotloom-media');
      signingRequests++;
      const { paths } = JSON.parse(String(init?.body));
      return Response.json(paths.map((path: string) => ({ path, signedURL: path.endsWith('/denied.png') ? null : `/object/sign/shotloom-media/${path}?token=private`, error: path.endsWith('/denied.png') ? 'Forbidden' : null })));
    };
    const request = (operation: string, keys: string[]) => app.request(`/api/files/${operation}`, { method: 'POST', headers: { cookie: `shotloom_session=${session}`, origin: 'http://localhost:5173', 'content-type': 'application/json' }, body: JSON.stringify({ objects: keys.map(key => ({ bucket: 'media', key })) }) });
    const response = await request('sign-batch', ['good.png','missing.png','denied.png']);
    assert.equal(response.status, 200);
    const { data } = await response.json();
    assert.deepEqual(data.map((item: { status: string }) => item.status), ['exists','missing','error']);
    assert.equal(data[0].key, 'good.png'); assert.ok(data[0].url); assert.equal(data[1].url, undefined);
    assert.equal(signingRequests, 1);
    const checked = await request('check', ['good.png','nac_test/other/good.png']);
    assert.deepEqual((await checked.json()).data.map((item: { status: string }) => item.status), ['exists','missing']);
    assert.equal(signingRequests, 1, 'checks must not request signatures');
    assert.equal((await request('check', ['../other/good.png'])).status, 400);
    metadataFailure = true;
    assert.equal((await request('check', ['good.png'])).status, 500, 'storage failures never become missing files');
    assert.equal((await app.request('/api/files/check', { method: 'POST', headers: { origin: 'http://localhost:5173' }, body: '{"objects":[]}' })).status, 401);
  } finally { globalThis.fetch = original; await db.close(); }
});
