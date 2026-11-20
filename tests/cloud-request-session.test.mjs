import assert from 'node:assert/strict';
import test from 'node:test';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

test('short summary cache is bounded by expiry, writes, refresh and session identity', async () => {
  const env = await createRendererEnv({ withWindow: true });
  const original = globalThis.fetch;
  let calls = 0, fail = false;
  globalThis.fetch = async () => { calls++; return Response.json({success: !fail, data: {items: [{id: 'one'}]}}, {status: fail ? 503 : 200}); };
  try {
    const {cloudRequest, bindCloudUser} = await env.load('services/cloudRequest');
    bindCloudUser('owner');
    const read = options => cloudRequest('/catalog/skills/page?limit=20', 'GET', undefined, {cacheMs: 5000, ...options});
    const first = await read(); first.items.length = 0;
    assert.equal((await read()).items.length, 1, 'caller mutation cannot corrupt cached summaries');
    assert.equal(calls, 1);
    await read({force: true}); assert.equal(calls, 2);
    await cloudRequest('/catalog/skills', 'PATCH', {}); await read(); assert.equal(calls, 4);
    bindCloudUser('owner', true); await read(); assert.equal(calls, 5);
    fail = true;
    await assert.rejects(read({force: true}), error => error.status === 503);
    await assert.rejects(read(), error => error.status === 503);
    assert.equal(calls, 7, 'failed refresh cannot leave an old success cached');
    fail = false;
    await read({cacheMs: 1}); await new Promise(resolve => setTimeout(resolve, 10));
    await read(); assert.equal(calls, 9);
  } finally { globalThis.fetch = original; await env.dispose(); }
});

test('concurrent reads share transport but writes and session recovery fence old reads', async () => {
  const env = await createRendererEnv({ withWindow: true });
  const original = globalThis.fetch;
  const sent = [];
  globalThis.fetch = (url, init) => new Promise(resolve => sent.push({ url, init, resolve }));
  try {
    const { cloudRequest, bindCloudUser } = await env.load('services/cloudRequest');
    bindCloudUser('owner');
    const a = cloudRequest('/settings'), b = cloudRequest('/settings');
    assert.equal(sent.length, 1, 'same-account reads should share one network request');
    bindCloudUser('owner');
    assert.equal(cloudRequest('/settings'), a, 'silent confirmation of the same account preserves in-flight reads');
    assert.ok(sent[0].init.signal instanceof AbortSignal);
    const write = cloudRequest('/settings/preferences', 'PATCH', { locale: 'en-US' });
    const afterWrite = cloudRequest('/settings');
    assert.equal(sent.length, 3, 'a read after a mutation cannot reuse an older in-flight read');
    bindCloudUser('owner', true);
    const afterRecovery = cloudRequest('/settings');
    assert.equal(sent.length, 4);
    for (const request of sent) request.resolve(Response.json({ success: true, data: { ok: true } }));
    const results = await Promise.allSettled([a, b, write, afterWrite, afterRecovery]);
    assert.equal(results[0].reason.code, 'STALE_RESPONSE');
    assert.equal(results[1].reason.code, 'STALE_RESPONSE');
    assert.equal(results[2].status, 'fulfilled', 'writes are never replayed');
    assert.equal(results[3].reason.code, 'STALE_RESPONSE');
    globalThis.fetch = (_url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
    const keepAlive = setTimeout(() => {}, 100);
    await assert.rejects(cloudRequest('/auth/account', 'GET', undefined, { timeoutMs: 5 }), error => error.name === 'TimeoutError');
    clearTimeout(keepAlive);
  } finally { globalThis.fetch = original; await env.dispose(); }
});

test('a slow session confirmation cannot extend the original GET budget', async () => {
  const env = await createRendererEnv({ withWindow: true });
  const original = globalThis.fetch;
  let release;
  globalThis.fetch = async url => String(url).endsWith('/auth/me')
    ? new Promise(resolve => { release = () => resolve(Response.json({ success: true, data: { id: 'owner' } })); })
    : Response.json({ success: false }, { status: 401 });
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    const { cloudRequest, bindCloudUser } = await env.load('services/cloudRequest');
    bindCloudUser('owner');
    await assert.rejects(cloudRequest('/models', 'GET', undefined, { timeoutMs: 10 }), error => error.name === 'TimeoutError');
  } finally { release?.(); clearTimeout(keepAlive); globalThis.fetch = original; await env.dispose(); }
});

test('session reads reuse a short memory cache but forced checks detect revocation and account changes', async () => {
  const env = await createRendererEnv({ withWindow: true });
  const original = globalThis.fetch;
  let calls = 0, status = 200, user = 'user';
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  globalThis.fetch = async (_url, init) => {
    calls++;
    assert.equal(init.headers['x-shotloom-user'], 'user');
    await gate;
    return Response.json({ success: status === 200, data: { id: user } }, { status });
  };
  try {
    const { readCloudSession, bindCloudUser, verifyCloudSession } = await env.load('services/cloudRequest');
    const events = [];
    window.dispatchEvent = event => { events.push(event.type); return true; };
    bindCloudUser('user');
    const first = readCloudSession(), second = readCloudSession();
    assert.equal(calls, 1);
    release();
    assert.equal((await first).id, 'user'); await second;
    await readCloudSession();
    assert.equal(calls, 1);
    status = 401;
    await verifyCloudSession();
    assert.equal(calls, 2, '401 verification bypasses cached success');
    assert.equal(events.length, 1);
    status = 200; user = 'other'; bindCloudUser('user');
    await assert.rejects(readCloudSession(), error => error.code === 'ACCOUNT_CHANGED');
  } finally { release(); globalThis.fetch = original; await env.dispose(); }
});

test('upstream failures verify the cookie session once without logging out or replaying writes', async () => {
  const env = await createRendererEnv({ withWindow: true });
  const originalFetch = globalThis.fetch;
  const events = [];
  window.dispatchEvent = event => { events.push(event.type); return true; };
  const calls = [];
  let status = 200;
  let release;
  globalThis.fetch = async (url, init) => {
    const path = new URL(String(url), 'https://fixture.example').pathname;
    calls.push({ path, method: init.method });
    if (path === '/api/auth/me') {
      await new Promise(resolve => { release = resolve; });
      if (status === 0) throw new TypeError('Network unavailable');
      return Response.json({ success: status === 200, data: { id: 'user' } }, { status });
    }
    return Response.json({ success: false, message: 'Provider rejected token' }, { status: 401 });
  };
  try {
    const { cloudRequest, bindCloudUser } = await env.load('services/cloudRequest');
    bindCloudUser('user');
    for (const sessionStatus of [200, 503, 0, 401]) {
      status = sessionStatus;
      const start = calls.length;
      const pending = Promise.allSettled([cloudRequest('/models'), cloudRequest('/feedback', 'POST', { description: 'draft' })]);
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(events.length, 0, 'a provider 401 alone cannot expire the application session');
      assert.equal(calls.slice(start).filter(call => call.path === '/api/auth/me').length, 1);
      release();
      assert.ok((await pending).every(result => result.status === 'rejected'));
      assert.equal(calls.slice(start).filter(call => call.path === '/api/feedback').length, 1);
      assert.equal(events.length, sessionStatus === 401 ? 1 : 0);
    }
    status = 200;
    globalThis.fetch = async () => Response.json({ success: false, code: 'ACCOUNT_CHANGED' }, { status: 409 });
    bindCloudUser('user');
    await assert.rejects(cloudRequest('/projects'));
    assert.equal(events.length, 2, 'account changes must still block the workspace');
    globalThis.fetch = async url => {
      if (String(url).endsWith('/auth/me')) await new Promise(resolve => { release = resolve; });
      return Response.json({ success: false }, { status: 401 });
    };
    bindCloudUser('user');
    const stale = assert.rejects(cloudRequest('/models'));
    await new Promise(resolve => setImmediate(resolve));
    bindCloudUser('user', true);
    release(); await stale;
    assert.equal(events.length, 2, 'old auth checks cannot expire a recovered session');
    globalThis.fetch = async () => Response.json({ success: false }, { status: 401 });
    await assert.rejects(cloudRequest('/auth/me'));
    await assert.rejects(cloudRequest('/auth/me'));
    assert.equal(events.length, 3, 'a revoked session expires once');
    const mutations = [];
    window.location = { search: '?native=embedded' };
    window.ReactNativeWebView = { postMessage: value => mutations.push(JSON.parse(value)) };
    globalThis.fetch = async () => Response.json({ success: true, data: {} });
    await cloudRequest('/project/fixture', 'PUT', {});
    assert.deepEqual(mutations, [{ type: 'workspace-mutated', path: '/project/fixture' }]);
  } finally { globalThis.fetch = originalFetch; await env.dispose(); }
});
