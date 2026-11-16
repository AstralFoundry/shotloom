import assert from 'node:assert/strict';
import test from 'node:test';
import { NativeApi } from '../src/api';
import { nativeRequestAllowed, type NativeRequest } from '../../../shared/nativeBridge';

test('native requests only expose the user-facing API, never admin, relay or arbitrary URLs', () => {
  for (const path of ['/auth/me', '/auth/account', '/auth/usage?page=2&page_size=10', '/projects', '/library-folders', '/feedback?offset=20&limit=20', '/notifications']) assert.ok(nativeRequestAllowed('GET', path));
  assert.ok(nativeRequestAllowed('POST', '/library-folders'));
  assert.ok(nativeRequestAllowed('GET', '/catalog/skills'));
  assert.ok(nativeRequestAllowed('PUT', '/catalog/skills'));
  for (const path of ['/catalog/recipes', '/catalog/assets', '/catalog/skills?userId=other', '/catalog/skills/../settings']) assert.equal(nativeRequestAllowed('PUT', path), false);
  for (const [method, path] of [['GET', '/admin/feedback'], ['POST', '/relay/chat/completions'], ['GET', 'https://attacker.example/feedback'], ['GET', '//attacker.example'], ['GET', '/feedback/../admin'], ['GET', '/feedback?redirect=evil'], ['DELETE', '/feedback'], ['GET', '/auth/account?redirect=evil'], ['GET', '/auth/usage?access_token=secret'], ['GET', '/library-folders?parentId=other'], ['DELETE', '/library-folders'], ['POST', '/auth/topup']]) assert.equal(nativeRequestAllowed(method!, path!), false);
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
