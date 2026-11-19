import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';

Object.assign(process.env, {
  NODE_ENV: 'test', GATEWAY_BASE_URL: 'https://gateway.example.com', GATEWAY_CLIENT_ID: 'nac_test',
  GATEWAY_CLIENT_SECRET: 'test-secret', GATEWAY_REDIRECT_URI: 'http://localhost:5173/api/auth/callback',
  FRONTEND_URL: 'http://localhost:5173', SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role', SUPABASE_PUBLISHABLE_KEY: 'test-publishable', SESSION_ENCRYPTION_KEY: '11'.repeat(32),
});
const { app } = await import('../src/index');
const { encrypt, decrypt } = await import('../src/lib/crypto');
const { issueNativeTicket, consumeNativeTicket, issueNativeToken } = await import('../src/lib/nativeAuth');
const verifier = 'a'.repeat(64);
const challenge = createHash('sha256').update(verifier).digest('base64url');

test('native OAuth keeps Supabase PKCE and only accepts a fixed app callback with bound challenge and state', async () => {
  const state = randomUUID();
  const response = await app.request(`/api/auth/login?native_challenge=${challenge}&native_state=${state}&redirect=https://attacker.example`);
  assert.equal(response.status, 302);
  assert.equal(new URL(response.headers.get('location')!).origin, 'https://example.supabase.co');
  assert.ok(response.headers.getSetCookie().some(cookie => cookie.startsWith('shotloom-supabase-auth-code-verifier=') && cookie.includes('HttpOnly')));
  const cookie = response.headers.getSetCookie().find(cookie => cookie.startsWith('shotloom_oauth='))!;
  const flow = JSON.parse(decrypt(decodeURIComponent(cookie.split(';')[0]!.split('=').slice(1).join('='))));
  assert.deepEqual(flow.native, { challenge, state });
  assert.equal(flow.redirect, 'http://localhost:5173');
  assert.equal((await app.request('/api/auth/login?native_challenge=invalid')).status, 400);
  const failed = await app.request('/api/auth/callback?error=access_denied', { headers: { cookie: cookie.split(';')[0]! } });
  assert.equal(failed.headers.get('location'), `shotloom-preview://auth/callback?state=${state}&error=invalid_state`);
});

test('handoffs require the matching proof and purpose, expire and cannot be replayed', () => {
  const code = issueNativeTicket({ kind: 'login', sessionId: randomUUID(), challenge });
  assert.throws(() => consumeNativeTicket(code, 'workspace'));
  assert.throws(() => consumeNativeTicket(code, 'login', 'b'.repeat(64)));
  assert.equal(consumeNativeTicket(code, 'login', verifier).kind, 'login');
  assert.throws(() => consumeNativeTicket(code, 'login', verifier));
  const expiring = issueNativeTicket({ kind: 'login', sessionId: randomUUID(), challenge });
  const now = Date.now;
  Date.now = () => now() + 61_000;
  try { assert.throws(() => consumeNativeTicket(expiring, 'login', verifier)); } finally { Date.now = now; }
});

test('native exchange, scoped API access, workspace cookies and logout use the same revocable server session', async () => {
  const original = globalThis.fetch;
  const sessionId = randomUUID(), userId = randomUUID();
  let exists = true;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/sessions')) {
      if (init?.method === 'DELETE') { exists = false; return new Response(null, { status: 204 }); }
      return Response.json(exists ? { id: sessionId, user_id: userId, owner: { id: userId, sub: '1', username: 'Fixture', email: null }, access_token_cipher: encrypt('private-provider-token'), refresh_token_cipher: null, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 3600000).toISOString() } : null);
    }
    if (url.pathname.endsWith('/users')) return Response.json({ id: userId, username: 'Fixture' });
    if (url.pathname.endsWith('/rpc/load_catalog')) {
      const reserved = readdirSync(new URL('../../renderer/src/agent/content/skills/', import.meta.url))[0]!;
      return Response.json({ storageVersion: 1, extra: 'preserved', skills: [{ id: reserved }, { id: 'custom' }, { id: 'legacy-system', builtIn: true }] });
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  };
  const request = (path: string, method = 'GET', body?: unknown, token?: string, origin?: string) => app.request(path, {
    method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(origin ? { origin } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  try {
    const code = issueNativeTicket({ kind: 'login', sessionId, challenge });
    assert.equal((await request('/api/auth/native/exchange', 'POST', { code, verifier: 'b'.repeat(64) })).status, 401);
    const exchanged = await request('/api/auth/native/exchange', 'POST', { code, verifier });
    assert.equal(exchanged.status, 200);
    const { data } = await exchanged.json();
    assert.equal(data.userId, userId);
    assert.equal(JSON.stringify(data).includes('private-provider-token'), false);
    const token = data.token as string;
    assert.equal((await request('/api/auth/native/exchange', 'POST', { code, verifier })).status, 401);
    assert.equal((await request('/api/auth/me', 'GET', undefined, token)).status, 200);
    const catalog = (await (await request('/api/catalog/skills', 'GET', undefined, token)).json()).data;
    assert.equal(catalog.skills.length, 3, 'native edits must retain hidden built-in records');
    assert.ok(catalog.skills.some((skill: { id: string }) => skill.id === 'custom'));
    assert.equal(catalog.extra, 'preserved'); assert.ok(catalog.systemSkillIds.length);
    for (const path of ['/api/settings', '/api/relay/chat/completions', '/api/admin/feedback']) {
      assert.equal((await request(path, 'GET', undefined, token)).status, 401);
    }
    assert.equal((await request('/api/auth/me', 'GET', undefined, token, 'https://attacker.example')).status, 401);
    assert.equal((await request('/api/settings/mobile', 'PATCH', { locale: 'en-US' }, token, 'https://attacker.example')).status, 403);
    assert.equal((await request('/api/auth/native/exchange', 'POST', { code, verifier }, undefined, 'https://attacker.example')).status, 403);
    assert.equal((await request('/api/auth/native/workspace-ticket', 'POST', { redirect: 'https://attacker.example/' }, token)).status, 400);
    const ticketResponse = await request('/api/auth/native/workspace-ticket', 'POST', { redirect: '/?project=fixture&native=embedded' }, token);
    assert.equal(ticketResponse.status, 200);
    const workspaceCode = (await ticketResponse.json()).data.code;
    assert.equal((await request('/api/settings/mobile', 'PATCH', { locale: 'en-US' }, token, 'null')).status, 403);
    assert.equal((await request('/api/auth/native/exchange', 'POST', { code, verifier }, undefined, 'null')).status, 403);
    assert.equal((await request('/api/auth/native/workspace', 'POST', { code: workspaceCode }, undefined, 'https://attacker.example')).status, 403);
    assert.equal((await app.request('/api/auth/native/workspace', { method: 'POST', headers: { origin: 'null', 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code: 'x'.repeat(43) }).toString() })).status, 401);
    const source = () => app.request('/api/auth/native/workspace', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'null' }, body: new URLSearchParams({ code: workspaceCode }).toString() });
    const workspace = await source();
    assert.equal(workspace.status, 303);
    assert.equal(workspace.headers.get('location'), 'http://localhost:5173/?project=fixture&native=embedded');
    assert.ok(workspace.headers.getSetCookie().some(cookie => cookie.startsWith(`shotloom_session=${sessionId}`) && cookie.includes('HttpOnly')));
    assert.equal((await source()).status, 401);
    const warmTicket = await request('/api/auth/native/workspace-ticket', 'POST', { redirect: '/?native=prewarm' }, token);
    const warmCode = (await warmTicket.json()).data.code;
    const warm = await app.request('/api/auth/native/workspace', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'null' }, body: new URLSearchParams({ code: warmCode }).toString() });
    assert.equal(warm.status, 200);
    assert.equal(warm.headers.get('cache-control'), 'no-store');
    assert.ok(warm.headers.getSetCookie().some(cookie => cookie.includes('HttpOnly')));
    const warmHtml = await warm.text();
    assert.match(warmHtml, /workspace-session-ready/);
    assert.ok(warmHtml.includes(userId));
    assert.equal(warmHtml.includes(sessionId), false, 'session credentials stay in HttpOnly cookies');
    assert.equal(warmHtml.includes('private-provider-token'), false);
    assert.equal((await request('/api/auth/logout', 'POST', undefined, token)).status, 200);
    assert.equal(exists, false);
    assert.equal((await request('/api/auth/me', 'GET', undefined, token)).status, 401);
    assert.equal((await request('/api/auth/me', 'GET', undefined, issueNativeToken(randomUUID()).slice(1))).status, 401);
  } finally { globalThis.fetch = original; }
});

test('successful Supabase callback binds the existing user and returns only a proof-bound handoff to the app', async () => {
  const original = globalThis.fetch;
  const userId = randomUUID(), sessionId = randomUUID(), state = randomUUID();
  const authUser = { id: randomUUID(), aud: 'authenticated', role: 'authenticated', email: 'fixture@example.com', app_metadata: { provider: 'custom:shotloom-newapi' }, user_metadata: {}, created_at: new Date().toISOString(), identities: [{ id: 'identity', user_id: userId, provider: 'custom:shotloom-newapi', identity_data: { sub: '8', aud: ['nac_test'] } }] };
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/token') return Response.json({ access_token: 'supabase-token', refresh_token: 'supabase-refresh', token_type: 'bearer', expires_in: 3600, user: authUser, provider_token: 'provider-token', provider_refresh_token: 'provider-refresh' });
    if (url.pathname === '/auth/v1/user') return Response.json(authUser);
    if (url.pathname === '/oauth/userinfo') return Response.json({ sub: '8', username: 'Fixture' });
    if (url.pathname.endsWith('/users')) return Response.json({ id: userId, username: 'Fixture', email: null });
    if (url.pathname.endsWith('/sessions') && init?.method === 'POST') {
      const row = JSON.parse(String(init.body));
      assert.equal(row.user_id, userId);
      assert.equal(decrypt(row.access_token_cipher), 'provider-token');
      return Response.json({ id: sessionId });
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  };
  try {
    const start = await app.request(`/api/auth/login?native_challenge=${challenge}&native_state=${state}`);
    const cookies = start.headers.getSetCookie().map(cookie => cookie.split(';')[0]!).join('; ');
    const response = await app.request('/api/auth/callback?code=supabase-code', { headers: { cookie: cookies } });
    assert.equal(response.status, 302);
    const target = new URL(response.headers.get('location')!);
    assert.equal(`${target.protocol}//${target.host}${target.pathname}`, 'shotloom-preview://auth/callback');
    assert.equal(target.searchParams.get('state'), state);
    assert.equal(target.searchParams.has('error'), false);
    assert.equal(target.toString().includes('provider-token'), false);
    assert.equal(response.headers.getSetCookie().some(cookie => cookie.startsWith('shotloom_session=')), false, 'the native flow does not sign the system browser into the workspace');
    assert.equal(consumeNativeTicket(target.searchParams.get('code')!, 'login', verifier).sessionId, sessionId);
  } finally { globalThis.fetch = original; }
});
