import assert from 'node:assert/strict';
import test from 'node:test';
import { NativeApi, createNativeApi } from '../src/api';
import { nativeRequestAllowed, type NativeRequest } from '../../../shared/nativeBridge';

test('a confirmed write snapshot replaces cache and fences an older in-flight detail read', async () => {
  const sent: NativeRequest[] = []; let id = 0;
  const api = new NativeApi(request => sent.push(request), () => String(++id));
  const path = '/feedback/11111111-1111-4111-8111-111111111111';
  const old = api.read(path);
  const confirmed = { item: { revision: 1 }, replies: [] };
  api.setCached(path, confirmed);
  api.receive({ type: 'response', id: sent[0]!.id, data: { stale: true } });
  await old;
  assert.deepEqual(await api.read(path), confirmed);
  assert.equal(sent.length, 1);
  api.invalidate(); assert.equal(api.cached(path), undefined);
});

test('native requests only expose the user-facing API, never admin, relay or arbitrary URLs', () => {
  for (const path of ['/auth/me', '/auth/account', '/auth/usage?page=2&page_size=10', '/projects', '/library-folders', '/feedback?offset=20&limit=20', '/notifications']) assert.ok(nativeRequestAllowed('GET', path));
  assert.ok(nativeRequestAllowed('POST', '/library-folders'));
  assert.ok(nativeRequestAllowed('GET', '/catalog/skills'));
  assert.ok(nativeRequestAllowed('PUT', '/catalog/skills'));
  assert.ok(nativeRequestAllowed('GET', '/settings/mobile'));
  assert.ok(nativeRequestAllowed('PATCH', '/settings/mobile'));
  assert.ok(nativeRequestAllowed('GET', '/models'));
  assert.equal(nativeRequestAllowed('GET', '/settings'), false);
  assert.equal(nativeRequestAllowed('PUT', '/settings'), false);
  for (const path of ['/catalog/recipes', '/catalog/assets', '/catalog/skills?userId=other', '/catalog/skills/../settings']) assert.equal(nativeRequestAllowed('PUT', path), false);
  for (const [method, path] of [['GET', '/admin/feedback'], ['POST', '/relay/chat/completions'], ['GET', 'https://attacker.example/feedback'], ['GET', '//attacker.example'], ['GET', '/feedback/../admin'], ['GET', '/feedback?redirect=evil'], ['DELETE', '/feedback'], ['GET', '/auth/account?redirect=evil'], ['GET', '/auth/usage?access_token=secret'], ['GET', '/library-folders?parentId=other'], ['DELETE', '/library-folders'], ['POST', '/auth/topup']]) assert.equal(nativeRequestAllowed(method!, path!), false);
});

test('HTTP transport sends native credentials directly, reports expiry, and ignores late replies after disconnect', async () => {
  const original = globalThis.fetch;
  let expired = 0, id = 0;
  const api = createNativeApi('https://cloud.example', 'native-token', () => String(++id), () => expired++);
  const replies: ((response: Response) => void)[] = [];
  globalThis.fetch = async (input, init) => {
    assert.match(String(input), /^https:\/\/cloud.example\/api\//);
    assert.equal(init?.credentials, 'omit');
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer native-token');
    return new Promise(resolve => replies.push(resolve));
  };
  try {
    const first = api.request('/projects');
    replies.shift()!(Response.json({ success: true, data: [{ id: 'fixture' }] }));
    assert.deepEqual(await first, [{ id: 'fixture' }]);
    const failed = api.request('/auth/me');
    replies.shift()!(Response.json({ success: false, message: 'Expired' }, { status: 401 }));
    await assert.rejects(failed, /Expired/); assert.equal(expired, 1);
    const late = api.request('/auth/me');
    api.disconnect(); await assert.rejects(late, /interrupted/);
    replies.shift()!(Response.json({ success: false, message: 'Expired' }, { status: 401 }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(expired, 1, 'an old session cannot expire a new one');
    await assert.rejects(api.request('/relay/chat/completions', 'POST'), /unavailable/);
  } finally { api.disconnect(); globalThis.fetch = original; }
});
test('native request replies correlate by ID, propagate errors and reject on disconnect', async () => {
  const sent: NativeRequest[] = [];
  let next = 0;
  const api = new NativeApi(request => sent.push(request), () => String(++next));
  const first = api.request('/feedback');
  const second = api.request('/notifications');
  api.receive({ type: 'response', id: sent[1]!.id, data: { unread: 2 } });
  api.receive({ type: 'response', id: sent[0]!.id, data: { items: [] } });
  assert.deepEqual(await first, { items: [] }); assert.deepEqual(await second, { unread: 2 });
  const failed = api.request('/auth/me');
  api.receive({ type: 'response', id: sent[2]!.id, error: 'Expired', status: 401 });
  await assert.rejects(failed, { message: 'Expired', status: 401 });
  const interrupted = api.request('/projects');
  api.disconnect(); await assert.rejects(interrupted, /interrupted/);
  await assert.rejects(api.request('/admin/feedback'), /unavailable/);
  assert.equal(sent.length, 4);
});

test('background bridge reconnect queues new requests, never replays interrupted writes, and cancels queued work on expiry', async () => {
  const sent: NativeRequest[] = []; let id = 0;
  const api = new NativeApi(request => sent.push(request), () => String(++id));
  const writing = api.request('/feedback', 'POST', { description: 'draft' });
  api.pause(); await assert.rejects(writing, /interrupted/);
  const reading = api.request('/notifications');
  assert.equal(sent.length, 1, 'new work waits for the authenticated ready message');
  api.resume(); assert.equal(sent.length, 2); assert.equal(sent[1]?.path, '/notifications');
  api.receive({ type: 'response', id: sent[1]!.id, data: { items: [] } });
  assert.deepEqual(await reading, { items: [] });
  api.pause(); const expired = api.request('/projects'); api.disconnect();
  await assert.rejects(expired, /interrupted/);
  api.resume(); assert.equal(sent.length, 2, 'disconnected queued work must never execute later');
});


test('read cache coalesces pages, refreshes explicitly, expires, and cannot be repopulated by an old session', async () => {
  const sent: NativeRequest[] = []; let id = 0;
  const api = new NativeApi(request => sent.push(request), () => String(++id));
  const reply = (value: unknown) => api.receive({ type: 'response', id: sent.at(-1)!.id, data: value });
  const first = api.read('/projects'); const concurrent = api.read('/projects');
  assert.equal(sent.length, 1); reply([{ id: 'one' }]);
  assert.deepEqual(await first, await concurrent);
  await api.read('/projects'); assert.equal(sent.length, 1);
  const fresh = api.read('/projects', true); assert.equal(sent.length, 2); reply([]); await fresh;
  assert.deepEqual(api.cached('/projects'), []);
  const now = Date.now; Date.now = () => now() + 61000;
  try { const expired = api.read('/projects'); assert.equal(sent.length, 3); reply(['fresh']); await expired; } finally { Date.now = now; }
  const old = api.read('/notifications'); api.invalidate(); reply(['old-user']); await old;
  assert.equal(api.cached('/notifications'), undefined);
  const auth = api.read('/auth/me'); reply({ id: 'user' }); await auth;
  const nextAuth = api.read('/auth/me'); assert.equal(sent.at(-1)!.path, '/auth/me'); reply({ id: 'user' }); await nextAuth;
  const projects = api.read('/projects'); reply(['fresh']); await projects;
  const writing = api.request('/notifications/read-all', 'PUT'); reply(null); await writing;
  assert.deepEqual(api.cached('/projects'), ['fresh'], 'notification writes preserve unrelated project projections');
  api.invalidate(['/projects']);
  const failed = api.read('/projects'); api.receive({ type:'response', id:sent.at(-1)!.id, error:'Unavailable', status:503 });
  await assert.rejects(failed, /Unavailable/); assert.equal(api.cached('/projects'), undefined);
});

test('targeted invalidation fences stale reads without discarding unrelated in-flight work', async () => {
  const sent: NativeRequest[] = []; let id = 0;
  const api = new NativeApi(request => sent.push(request), () => String(++id));
  const reply = (path: string, data: unknown) => api.receive({ type: 'response', id: sent.findLast(request => request.path === path)!.id, data });
  const project = api.read('/projects');
  const inbox = api.read('/notifications?offset=0&limit=1');
  const write = api.request('/notifications/read-all', 'PUT', {});
  reply('/notifications?offset=0&limit=1', { unread: 1 }); await inbox;
  assert.equal(api.cached('/notifications?offset=0&limit=1'), undefined);
  reply('/projects', ['kept']); await project;
  reply('/notifications/read-all', null); await write;
  assert.deepEqual(api.cached('/projects'), ['kept']);
  const settings = api.read('/settings/mobile'); reply('/settings/mobile', { locale: 'en-US' }); await settings;
  const saving = api.request('/catalog/skills', 'PUT', { skills: [] }); reply('/catalog/skills', null); await saving;
  assert.deepEqual(api.cached('/settings/mobile'), { locale: 'en-US' });
  api.invalidateWrite('/project/fixture');
  assert.equal(api.cached('/projects'), undefined);
  assert.deepEqual(api.cached('/settings/mobile'), { locale: 'en-US' }, 'canvas saves preserve settings');
  const me = api.read('/auth/me'); reply('/auth/me', { id: 'one' }); await me;
  assert.deepEqual(api.cached('/auth/me'), { id: 'one' }, 'verified profile is available for display');
  const checking = api.read('/auth/me'); const concurrent = api.read('/auth/me');
  assert.equal(sent.filter(request => request.path === '/auth/me').length, 2, 'auth checks bypass TTL but coalesce in flight');
  reply('/auth/me', { id: 'one' }); await Promise.all([checking, concurrent]);
  api.invalidate(); assert.equal(api.cached('/auth/me'), undefined);
});

test('upstream 401 verifies the application session without retrying writes or expiring a valid login', async () => {
  const original = globalThis.fetch;
  let expired = 0, id = 0;
  const api = createNativeApi('https://cloud.example', 'token', () => String(++id), () => expired++);
  const paths: string[] = [];
  let sessionStatus = 200;
  globalThis.fetch = async input => {
    const path = new URL(String(input)).pathname; paths.push(path);
    return path === '/api/auth/me' && sessionStatus === 200
      ? Response.json({ success: true, data: { id: 'user' } })
      : Response.json({ success: false, message: 'Unauthorized' }, { status: path === '/api/auth/me' ? sessionStatus : 401 });
  };
  try {
    await assert.rejects(api.request('/models'), /Unauthorized/);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(expired, 0);
    assert.deepEqual(paths, ['/api/models', '/api/auth/me']);
    sessionStatus = 503;
    await assert.rejects(api.request('/feedback', 'POST', { description: 'draft' }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(expired, 0);
    assert.equal(paths.filter(path => path === '/api/feedback').length, 1);
    sessionStatus = 401;
    await assert.rejects(api.request('/models'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(expired, 1);
  } finally { api.disconnect(); globalThis.fetch = original; }
});
