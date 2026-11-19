import assert from 'node:assert/strict';
import test from 'node:test';

Object.assign(process.env, {
  NODE_ENV: 'test', GATEWAY_BASE_URL: 'https://gateway.example.com', GATEWAY_CLIENT_ID: 'nac_test',
  GATEWAY_CLIENT_SECRET: 'test-secret', GATEWAY_REDIRECT_URI: 'http://localhost:5173/api/auth/callback',
  FRONTEND_URL: 'http://localhost:5173', SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role', SUPABASE_PUBLISHABLE_KEY: 'test-publishable',
  SESSION_ENCRYPTION_KEY: '11'.repeat(32),
});
const { app } = await import('../src/index');
const { encrypt } = await import('../src/lib/crypto');
const { compilePublication, executionTemplates } = await import('../../shared/modelPublications');

test('model publication APIs enforce administrator membership, app scope, configuration and relay policy', async () => {
  const savedFetch = globalThis.fetch;
  const userId = 'a0000000-0000-4000-8000-000000000001';
  const sessionId = 'b0000000-0000-4000-8000-000000000001';
  const row = { client_id: 'nac_test', id: 'upstream-text', name: 'Published text', owned_by: 'upstream',
    supported_endpoint_types: ['openai'], available: true, type: 'textGeneration' as const,
    template_id: 'starrouter-kimi-k3', sort_order: 0, published: true, revision: 1 };
  let isAdmin = false;
  let conflict = false;
  let roleError = '';
  let mutations: Record<string, unknown>[] = [];
  let generated = 0;
  const headers = { cookie: `shotloom_session=${sessionId}`, origin: 'http://localhost:5173', 'content-type': 'application/json' };
  const request = (path: string, method = 'GET', body?: unknown) => app.request(`/api${path}`, {
    method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.host === 'gateway.example.com') {
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer private-oauth-token');
      if (url.pathname === '/v1/models') return Response.json({ data: [{ id: row.id, owned_by: 'upstream' }, { id: 'unpublished' }] });
      generated++; return Response.json({ choices: [{ message: { content: 'ok' } }] });
    }
    const table = url.pathname.split('/').at(-1);
    if (table === 'sessions') return Response.json({ id: sessionId, user_id: userId, owner: { id: userId, sub: '1', username: null, email: null },
      access_token_cipher: encrypt('private-oauth-token'), refresh_token_cipher: null,
      created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 3600000).toISOString() });
    if (table === 'users') { assert.equal(url.searchParams.get('client_id'), 'eq.nac_test'); return Response.json({ id: userId }); }
    if (table === 'list_admin_users') {
      const args = JSON.parse(String(init?.body));
      assert.equal(args.p_client_id, 'nac_test'); assert.equal(args.p_actor_id, userId);
      assert.equal(args.p_query, '854771076@qq.com'); assert.equal(args.p_offset, 20); assert.equal(args.p_limit, 20);
      return Response.json({ items: [{ id: userId, sub: '1', username: 'test', is_admin: true }], total: 21 });
    }
    if (table === 'set_app_admin') {
      const args = JSON.parse(String(init?.body));
      assert.equal(args.p_client_id, 'nac_test'); assert.equal(args.p_actor_id, userId); assert.equal(args.p_user_id, userId);
      assert.equal(args.p_is_admin, true); assert.equal(args.p_expected_admin, false);
      return roleError ? Response.json({ code: roleError, message: 'denied' }, { status: 400 }) : Response.json({ id: userId, is_admin: true });
    }
    if (table === 'manage_models') {
      const args = JSON.parse(String(init?.body));
      assert.equal(args.p_client_id, 'nac_test'); assert.equal(args.p_actor_id, userId);
      mutations.push(args);
      return conflict ? Response.json({ code: '40001', message: 'MODEL_CONFLICT' }, { status: 409 }) : Response.json(args.p_value);
    }
    assert.equal(url.searchParams.get('client_id'), 'eq.nac_test');
    if (table === 'app_admins') return Response.json(isAdmin ? { user_id: userId } : null);
    if (table === 'model_publications') return Response.json(url.searchParams.has('id')
      ? url.searchParams.get('id') === `eq.${row.id}` ? row : null : [row, { ...row, id: 'hidden', published: false }]);
    if (table === 'admin_audit') return Response.json([]);
    assert.fail(`Unexpected fetch ${url.pathname}`);
  };
  try {
    assert.equal((await app.request('/api/admin/models')).status, 401);
    assert.equal((await request('/admin/models')).status, 403);
    assert.equal((await request('/admin/models/sync', 'POST')).status, 403);
    assert.equal((await request('/admin/users')).status, 403);
    assert.equal((await request(`/admin/users/${userId}/admin`, 'PUT', { is_admin: true, expected_admin: false })).status, 403);
    assert.equal(mutations.length, 0);
    isAdmin = true;
    assert.equal((await request('/admin/me')).status, 200);
    assert.equal((await request('/admin/users?pageSize=1000')).status, 400);
    assert.equal((await request('/admin/users?page=-1')).status, 400);
    const users = await (await request('/admin/users?page=2&pageSize=20&search=854771076%40qq.com')).json();
    assert.equal(users.data.total, 21);
    const rolePath = `/admin/users/${userId}/admin`;
    assert.equal((await request('/admin/users/invalid/admin', 'PUT', {})).status, 400);
    assert.equal((await request(rolePath, 'PUT', { is_admin: 'true', expected_admin: false })).status, 400);
    assert.equal((await request(rolePath, 'PUT', { is_admin: true, expected_admin: false, client_id: 'other-app' })).status, 400);
    assert.equal((await request(rolePath, 'PUT', { is_admin: true, expected_admin: false })).status, 200);
    for (const [code, status] of [['42501', 403], ['P0002', 404], ['40001', 409], ['23514', 409]] as const) {
      roleError = code;
      assert.equal((await request(rolePath, 'PUT', { is_admin: true, expected_admin: false })).status, status);
    }
    roleError = '';
    const catalog = await (await request('/models')).json();
    assert.deepEqual(catalog.data.publications.map((model: { id: string }) => model.id), [row.id]);
    assert.deepEqual(catalog.data.upstreamModels.map((model: { id: string }) => model.id), [row.id]);
    assert.equal((await request('/admin/models', 'PUT', { ...row, template_id: null })).status, 400);
    assert.equal((await request('/admin/models', 'PUT', { ...row, type: 'imageGeneration' })).status, 400);
    assert.equal((await request('/admin/models/sync', 'POST')).status, 200);
    assert.equal('published' in (mutations[0]!.p_value as object[])[0]!, false);
    conflict = true;
    assert.equal((await request('/admin/models', 'PUT', row)).status, 409);
    conflict = false;
    assert.equal((await request('/relay/chat/completions', 'POST', { model: 'unpublished' })).status, 403);
    assert.equal((await request('/relay/images/generations', 'POST', { model: row.id })).status, 403);
    assert.equal((await request('/relay/chat/completions', 'POST', { messages: [] })).status, 400);
    assert.equal((await request('/relay/chat/completions', 'POST', { model: row.id })).status, 200);
    row.published = false;
    assert.equal((await request('/relay/chat/completions', 'POST', { model: row.id })).status, 403);
    assert.equal((await request('/relay/videos/existing-task')).status, 200);
    assert.equal((await request('/relay/unknown-free-endpoint')).status, 403);
    assert.equal(generated, 2);
    for (const template of executionTemplates) {
      assert.ok(compilePublication({ ...row, published: true, type: template.type as typeof row.type, template_id: template.id }));
    }
  } finally { globalThis.fetch = savedFetch; }
});
