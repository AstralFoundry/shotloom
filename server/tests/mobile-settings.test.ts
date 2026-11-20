import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
Object.assign(process.env, {
  NODE_ENV: 'test', GATEWAY_BASE_URL: 'https://gateway.example.com', GATEWAY_CLIENT_ID: 'nac_test',
  GATEWAY_CLIENT_SECRET: 'test-secret', GATEWAY_REDIRECT_URI: 'http://localhost:5173/api/auth/callback',
  FRONTEND_URL: 'http://localhost:5173', SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role', SUPABASE_PUBLISHABLE_KEY: 'test-publishable', SESSION_ENCRYPTION_KEY: '11'.repeat(32),
});
const { app } = await import('../src/index');
const { encrypt } = await import('../src/lib/crypto');

test('preference PATCH merges atomically, validates values and never calls upstream account or models', async () => {
  const db = new PGlite(), original = globalThis.fetch;
  const user = randomUUID(), session = randomUUID();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema shotloom; create table shotloom.settings(user_id uuid, key text, payload jsonb, primary key(user_id,key));
      create table shotloom.inbox_notifications(user_id uuid, client_id text, read_at timestamptz);`);
    await db.exec(await readFile(new URL('../../supabase/migrations/20261120055657_page_performance_reads.sql', import.meta.url), 'utf8'));
    await db.query('insert into shotloom.settings values($1,$2,$3),($1,$4,$5)', [user, 'customSetting', 42, 'providerConfigs', { secret: 'private' }]);
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input)), table = url.pathname.split('/').at(-1);
      if (table === 'sessions') return Response.json({ id: session, user_id: user, owner: { id: user, sub: '1', username: null, email: null }, access_token_cipher: encrypt('token'), refresh_token_cipher: null, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 3600000).toISOString() });
      assert.equal(table, 'patch_settings');
      const args = JSON.parse(String(init?.body)); assert.equal(args.p_user_id, user);
      return Response.json((await db.query<{ value: unknown }>('select shotloom.patch_settings($1,$2) as value', [args.p_user_id, args.p_value])).rows[0]!.value);
    };
    const patch = (value: unknown) => app.request('/api/settings/preferences', { method: 'PATCH', headers: { cookie: `shotloom_session=${session}`, origin: 'http://localhost:5173', 'content-type': 'application/json' }, body: JSON.stringify(value) });
    const response = await patch({ locale: 'en-US', agentPreferredTextModel: '  chosen-model  ' });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).data, { customSetting: 42, locale: 'en-US', agentPreferredTextModel: 'chosen-model' });
    for (const value of [{ providerConfigs: {} }, { rawQuota: 99 }, { locale: 'invalid' }, { agentCanRunNodes: 'true' }]) assert.equal((await patch(value)).status, 400);
    assert.equal((await app.request('/api/settings/preferences', { method: 'PATCH', headers: { origin: 'http://localhost:5173' }, body: '{}' })).status, 401);
    assert.deepEqual((await db.query<{ payload: unknown }>("select payload from shotloom.settings where key='providerConfigs'")).rows[0]!.payload, { secret: 'private' });
  } finally { globalThis.fetch = original; await db.close(); }
});

test('mobile settings validate single-field updates, preserve other settings and never expose provider credentials', async () => {
  const original = globalThis.fetch;
  const user = randomUUID(), other = randomUUID(), session = randomUUID();
  const settings = new Map<string, unknown>([['agentCanRunNodes', false], ['locale', 'zh-CN'], ['agentAutoEval', 'legacy-invalid'], ['agentPreferredTextModel', { legacy: true }], ['providerConfigs', { private: 'secret' }], ['customSetting', 42]]);
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)); const table = url.pathname.split('/').at(-1);
    if (table === 'sessions') return Response.json({ id: session, user_id: user, owner: { id: user, sub: '1', username: null, email: null }, access_token_cipher: encrypt('token'), refresh_token_cipher: null, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 3600000).toISOString() });
    if (table === 'users') return Response.json({ id: user });
    assert.equal(table, 'settings');
    if (init?.method === 'POST') {
      const row = JSON.parse(String(init.body));
      assert.equal(row.user_id, user); assert.equal(row.key, 'agentCanRunNodes');
      settings.set(row.key, row.payload); return new Response(null, { status: 201 });
    }
    assert.equal(url.searchParams.get('user_id'), `eq.${user}`);
    return Response.json([...settings].map(([key, payload]) => ({ user_id: user, key, payload })));
  };
  const request = (method = 'GET', value?: unknown, headers: Record<string, string> = {}) => app.request('/api/settings/mobile', {
    method, headers: { cookie: `shotloom_session=${session}`, origin: 'http://localhost:5173', 'content-type': 'application/json', ...headers },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
  try {
    assert.equal((await app.request('/api/settings/mobile')).status, 401);
    const response = await request(); assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).data, { agentCanRunNodes: false, locale: 'zh-CN' });
    assert.equal((await request('PATCH', { agentCanRunNodes: true })).status, 200);
    assert.equal(settings.get('agentCanRunNodes'), true);
    assert.deepEqual(settings.get('providerConfigs'), { private: 'secret' }); assert.equal(settings.get('customSetting'), 42);
    for (const value of [{ providerConfigs: {} }, { agentCanRunNodes: 'yes' }, { locale: 'xx' }, {}, { agentCanRunNodes: false, locale: 'en-US' }]) assert.equal((await request('PATCH', value)).status, 400);
    assert.equal((await request('PATCH', { agentCanRunNodes: false }, { origin: 'https://attacker.example' })).status, 403);
    assert.equal((await request('GET', undefined, { 'x-shotloom-user': other })).status, 409);
  } finally { globalThis.fetch = original; }
});
