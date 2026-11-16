import assert from 'node:assert/strict';
import test from 'node:test';
import { NativeApi } from '../src/api';
import { nativeRequestAllowed, type NativeRequest } from '../../../shared/nativeBridge';

test('native requests only expose the user-facing API, never admin, relay or arbitrary URLs', () => {
  for (const path of ['/auth/me', '/projects', '/feedback?offset=20&limit=20', '/notifications']) assert.ok(nativeRequestAllowed('GET', path));
  for (const [method, path] of [['GET', '/admin/feedback'], ['POST', '/relay/chat/completions'], ['GET', 'https://attacker.example/feedback'], ['GET', '//attacker.example'], ['GET', '/feedback/../admin'], ['GET', '/feedback?redirect=evil'], ['DELETE', '/feedback']]) assert.equal(nativeRequestAllowed(method!, path!), false);
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
