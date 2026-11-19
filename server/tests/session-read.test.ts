import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';

Object.assign(process.env, {
  NODE_ENV: 'test', GATEWAY_BASE_URL: 'https://gateway.example.com', GATEWAY_CLIENT_ID: 'nac_test',
  GATEWAY_CLIENT_SECRET: 'test-secret', GATEWAY_REDIRECT_URI: 'http://localhost:5173/api/auth/callback',
  FRONTEND_URL: 'http://localhost:5173', SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role', SUPABASE_PUBLISHABLE_KEY: 'test-publishable',
  SESSION_ENCRYPTION_KEY: '11'.repeat(32),
});
const { app } = await import('../src/index');
const { encrypt } = await import('../src/lib/crypto');
const { loadSession, deleteSession, updateSessionTokens } = await import('../src/lib/supabase');

test('session authentication and /me use one tenant-filtered read and never cache revoked sessions', async () => {
  const original = globalThis.fetch;
  const id = randomUUID(), owner = { id: randomUUID(), sub: '1', username: 'Fixture', email: null };
  let exists = true, tenant = 'nac_test', age = 0, reads = 0;
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    reads++;
    assert.ok(url.pathname.endsWith('/sessions'), 'profile must come from the session query');
    assert.match(url.searchParams.get('select') || '', /owner:users!inner\(id,sub,username,email\)/);
    assert.equal(url.searchParams.get('owner.client_id'), 'eq.nac_test');
    return Response.json(exists && tenant === 'nac_test' ? {
      id, user_id: owner.id, owner, access_token_cipher: encrypt('private-provider-token'), refresh_token_cipher: null,
      created_at: new Date(Date.now() - age).toISOString(), expires_at: new Date(Date.now() + 3600000).toISOString(),
    } : null);
  };
  const request = (expectedUser?: string) => app.request('/api/auth/me', {
    headers: { cookie: `shotloom_session=${id}`, ...(expectedUser ? { 'x-shotloom-user': expectedUser } : {}) },
  });
  try {
    const response = await request();
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).data, owner);
    assert.equal(reads, 1);
    assert.equal((await request(randomUUID())).status, 409);
    tenant = 'another-app'; assert.equal((await request()).status, 401);
    tenant = 'nac_test'; age = 30 * 86400000; assert.equal((await request()).status, 401);
    age = 0; assert.equal((await request()).status, 200);
    exists = false; assert.equal((await request()).status, 401);
    assert.equal(reads, 6, 'each request must still validate current session ownership');
  } finally { globalThis.fetch = original; }
});

test('concurrent authenticated requests share only the pending session read', async () => {
  const original = globalThis.fetch;
  const id = randomUUID(), owner = { id: randomUUID(), sub: '1', username: 'Fixture', email: null };
  let reads = 0, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  globalThis.fetch = async () => {
    reads++;
    await gate;
    return Response.json({ id, user_id: owner.id, owner, access_token_cipher: encrypt('token'), refresh_token_cipher: null,
      created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 3600000).toISOString() });
  };
  const request = (expectedUser = owner.id) => app.request('/api/auth/me', {
    headers: { cookie: `shotloom_session=${id}`, 'x-shotloom-user': expectedUser },
  });
  const requests = [request(), request(), request(randomUUID())];
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(reads, 1, 'one startup burst must issue one session query');
    release();
    assert.deepEqual((await Promise.all(requests)).map(response => response.status), [200, 200, 409]);
    assert.equal((await request()).status, 200);
    assert.equal(reads, 2, 'completed reads must not become an authentication cache');
  } finally { release(); await Promise.allSettled(requests); globalThis.fetch = original; }
});

test('session read failures are shared while pending and can be retried', async () => {
  const original = globalThis.fetch;
  const id = randomUUID();
  let reads = 0, failed = true, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  globalThis.fetch = async () => {
    reads++; await gate;
    return failed ? Response.json({ message: 'fixture unavailable', code: '42501' }, { status: 403 }) : Response.json(null);
  };
  const requests = [loadSession(id), loadSession(id)];
  const settled = Promise.allSettled(requests);
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(reads, 1);
    release();
    assert.ok((await settled).every(result => result.status === 'rejected'));
    failed = false;
    assert.equal(await loadSession(id), null);
    assert.equal(reads, 2);
  } finally { release(); await settled; globalThis.fetch = original; }
});

test('concurrent reads of different sessions stay isolated and invalid ids never query storage', async () => {
  const original = globalThis.fetch;
  const ids = [randomUUID(), randomUUID()];
  let reads = 0, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  globalThis.fetch = async input => {
    reads++;
    const id = new URL(String(input)).searchParams.get('id')!.slice(3);
    await gate;
    return Response.json({ id, user_id: id, owner: { id, sub: id, username: null, email: null }, access_token_cipher: encrypt(id), refresh_token_cipher: null,
      created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 3600000).toISOString() });
  };
  const requests = ids.map(id => loadSession(id));
  try {
    assert.equal(await loadSession('invalid'), null);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(reads, 2);
    release();
    const sessions = await Promise.all(requests);
    assert.deepEqual(sessions.map(session => session?.userId), ids);
    assert.deepEqual(sessions.map(session => session?.accessToken), ids);
  } finally { release(); await Promise.allSettled(requests); globalThis.fetch = original; }
});

test('revocation and token updates discard session reads that started before the write', async () => {
  const original = globalThis.fetch;
  const id = randomUUID(), owner = { id: randomUUID(), sub: '1', username: null, email: null };
  let row: Record<string, unknown> | null = { id, user_id: owner.id, owner, access_token_cipher: encrypt('old-token'), refresh_token_cipher: null,
    created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 3600000).toISOString() };
  let reads = 0, release!: () => void;
  let gate = new Promise<void>(resolve => { release = resolve; });
  globalThis.fetch = async (_input, init) => {
    if (init?.method === 'DELETE') { row = null; return new Response(null, { status: 204 }); }
    if (init?.method === 'PATCH') { row = { ...row, ...JSON.parse(String(init.body)) }; return new Response(null, { status: 204 }); }
    reads++;
    const snapshot = structuredClone(row);
    await gate;
    return Response.json(snapshot);
  };
  let pending: Promise<unknown> | undefined;
  try {
    pending = loadSession(id);
    await new Promise(resolve => setImmediate(resolve));
    await updateSessionTokens(id, { accessToken: 'new-token', tokenType: 'Bearer', expiresAt: Date.now() + 3600000 });
    release();
    assert.equal((await pending as Awaited<ReturnType<typeof loadSession>>)?.accessToken, 'new-token');
    assert.equal(reads, 2, 'an old pending response must be reread after token rotation');
    gate = new Promise<void>(resolve => { release = resolve; });
    pending = loadSession(id);
    await new Promise(resolve => setImmediate(resolve));
    await deleteSession(id);
    release();
    assert.equal(await pending, null, 'an old response cannot revive a revoked session');
    assert.equal(await loadSession(id), null);
  } finally { release(); await pending?.catch(() => {}); globalThis.fetch = original; }
});

test('token refresh reuses this request authentication and rotates once for concurrent requests', async () => {
  const original = globalThis.fetch;
  const id = randomUUID(), owner = { id: randomUUID(), sub: '1', username: null, email: null };
  let reads = 0, refreshes = 0, writes = 0, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === '/oauth/token') { refreshes++; return Response.json({ access_token: 'new-token', refresh_token: 'new-refresh', expires_in: 3600 }); }
    assert.ok(url.pathname.endsWith('/sessions'));
    if (init?.method === 'PATCH') { writes++; return new Response(null, { status: 204 }); }
    reads++; await gate;
    return Response.json({ id, user_id: owner.id, owner, access_token_cipher: encrypt('old-token'), refresh_token_cipher: encrypt('refresh-token'),
      created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 10000).toISOString() });
  };
  const requests = Array.from({ length: 3 }, () => app.request('/api/auth/me', { headers: { cookie: `shotloom_session=${id}` } }));
  try {
    await new Promise(resolve => setImmediate(resolve));
    release();
    assert.ok((await Promise.all(requests)).every(response => response.status === 200));
    assert.equal(reads, 1, 'refresh must not add a serial session query after authentication');
    assert.equal(refreshes, 1);
    assert.equal(writes, 1);
  } finally { release(); await Promise.allSettled(requests); globalThis.fetch = original; }
});

test('invalid refresh grants revoke the session while transient gateway failures remain retryable', async () => {
  const original = globalThis.fetch;
  try {
    for (const status of [400, 503]) {
      const id = randomUUID(), owner = { id: randomUUID(), sub: '1', username: null, email: null };
      let exists = true, failed = true, deletes = 0;
      globalThis.fetch = async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname === '/oauth/token') return failed
          ? Response.json({ error: status === 400 ? 'invalid_grant' : 'unavailable' }, { status })
          : Response.json({ access_token: 'new-token', expires_in: 3600 });
        assert.ok(url.pathname.endsWith('/sessions'));
        if (init?.method === 'DELETE') { exists = false; deletes++; return new Response(null, { status: 204 }); }
        if (init?.method === 'PATCH') return new Response(null, { status: 204 });
        return Response.json(exists ? { id, user_id: owner.id, owner, access_token_cipher: encrypt('old-token'), refresh_token_cipher: encrypt('refresh-token'),
          created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 10000).toISOString() } : null);
      };
      const request = () => app.request('/api/auth/me', { headers: { cookie: `shotloom_session=${id}` } });
      const response = await request();
      assert.equal(response.status, status === 400 ? 401 : 502);
      assert.equal(deletes, status === 400 ? 1 : 0);
      failed = false;
      assert.equal((await request()).status, status === 400 ? 401 : 200);
    }
  } finally { globalThis.fetch = original; }
});
