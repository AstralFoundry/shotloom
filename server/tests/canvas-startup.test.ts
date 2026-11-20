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
const { issueNativeToken } = await import('../src/lib/nativeAuth');

test('canvas startup authenticates once, reads dependencies concurrently and preserves ownership/errors', async () => {
  const original = globalThis.fetch;
  const user = randomUUID(), session = randomUUID(), projectId = randomUUID(), missing = randomUUID();
  const project = { id: projectId, nodes: [], storageRevision: 7 };
  const assets = { storageVersion: 1, assets: [], materials: [], references: [] };
  let validSession = true, failedCatalog = false, sessionReads = 0;
  const started: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)), table = url.pathname.split('/').at(-1)!;
    if (table === 'sessions') {
      sessionReads++;
      return Response.json(validSession ? {
        id: session, user_id: user, owner: { id: user, sub: '1', username: null, email: null },
        access_token_cipher: encrypt('token'), refresh_token_cipher: null,
        created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 3600000).toISOString(),
      } : null);
    }
    started.push(table);
    await gate;
    if (table === 'settings') {
      assert.equal(url.searchParams.get('user_id'), `eq.${user}`);
      return Response.json([{ key: 'locale', payload: 'en-US' }, { key: 'agentCanRunNodes', payload: false }]);
    }
    const body = JSON.parse(String(init?.body));
    assert.equal(body.p_user_id, user);
    if (table === 'load_project') return Response.json(body.p_id === projectId ? project : null);
    assert.equal(table, 'read_catalog_versioned');
    assert.equal(body.p_kind, 'assets');
    return failedCatalog ? Response.json({ message: 'unavailable', code: 'XX000' }, { status: 500 }) : Response.json({catalog:assets,revision:3});
  };
  const request = (id = projectId, expected = user) => app.request(`/api/project/${id}/startup`, {
    headers: { cookie: `shotloom_session=${session}`, 'x-shotloom-user': expected },
  });
  let pending: Promise<Response> | undefined;
  try {
    assert.equal((await app.request(`/api/project/${projectId}/startup`)).status, 401);
    assert.equal((await app.request(`/api/project/${projectId}/startup`, { headers: { authorization: `Bearer ${issueNativeToken(session)}` } })).status, 401);
    pending = request();
    for (let i = 0; i < 100 && started.length < 3; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.deepEqual([...started].sort(), ['load_project', 'read_catalog_versioned', 'settings']);
    assert.equal(sessionReads, 1);
    release();
    const response = await pending;
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    for (const name of ['project', 'settings', 'assets']) assert.match(response.headers.get('server-timing')!, new RegExp(`${name};dur=\\d+\\.\\d+`));
    assert.deepEqual((await response.json()).data, { project, settings: { locale: 'en-US', agentCanRunNodes: false }, assets: { ...assets, __catalogRevision: 3 } });
    assert.equal((await request('invalid')).status, 400);
    assert.equal((await request(missing)).status, 404);
    const readsBeforeMismatch = started.length;
    assert.equal((await request(projectId, randomUUID())).status, 409);
    assert.equal(started.length, readsBeforeMismatch);
    failedCatalog = true;
    assert.equal((await request()).status, 500, 'never replace a failed asset read with an empty catalog');
    const minimal = await app.request(`/api/project/${projectId}/startup?parts=project,settings`, { headers: { cookie: `shotloom_session=${session}` } });
    assert.equal(minimal.status,200,'an unrelated catalog failure cannot block the project/settings startup');
    assert.deepEqual((await minimal.json()).data,{project,settings:{locale:'en-US',agentCanRunNodes:false}});
    validSession = false;
    assert.equal((await request()).status, 401, 'completed startup responses cannot cache revoked authentication');
  } finally { release(); await pending?.catch(() => {}); globalThis.fetch = original; }
});
