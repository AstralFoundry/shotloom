import assert from 'node:assert/strict';
import test from 'node:test';
import { Hono } from 'hono';
import { requestMetrics, timed, requestSignal } from '../src/lib/requestMetrics';

test('request timing and streamed JSON size record metadata without recording private data', async () => {
  const app = new Hono(), original = console.log, mode = process.env.NODE_ENV;
  const logs: string[] = [];
  console.log = value => logs.push(String(value)); process.env.NODE_ENV = 'production';
  app.use('*', requestMetrics);
  app.get('/fixture/:id', async c => {
    assert.ok(requestSignal());
    await timed('auth', async () => {});
    return c.json({ text:'私有正文',url:'signed-url-secret' });
  });
  try {
    const response = await app.request('/fixture/private-id?token=private-token', { headers:{cookie:'private-cookie'} });
    const body = await response.text();
    assert.equal(response.status,200); assert.match(response.headers.get('server-timing')!, /auth;dur=/);
    assert.ok(response.headers.get('x-request-id'));
    const record = JSON.parse(logs[0]!);
    assert.equal(record.bytes,Buffer.byteLength(body)); assert.equal(record.route,'/fixture/:id');
    assert.ok(!logs[0]!.includes('private') && !logs[0]!.includes('secret') && !logs[0]!.includes('私有正文'));
  } finally { console.log = original; process.env.NODE_ENV = mode; }
});
