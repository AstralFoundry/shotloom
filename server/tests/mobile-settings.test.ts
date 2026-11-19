import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
Object.assign(process.env, {
  NODE_ENV: 'test', GATEWAY_BASE_URL: 'https://gateway.example.com', GATEWAY_CLIENT_ID: 'nac_test',
  GATEWAY_CLIENT_SECRET: 'test-secret', GATEWAY_REDIRECT_URI: 'http://localhost:5173/api/auth/callback',
  FRONTEND_URL: 'http://localhost:5173', SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role', SUPABASE_PUBLISHABLE_KEY: 'test-publishable', SESSION_ENCRYPTION_KEY: '11'.repeat(32),
});
const { app } = await import('../src/index');
const { encrypt } = await import('../src/lib/crypto');

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
