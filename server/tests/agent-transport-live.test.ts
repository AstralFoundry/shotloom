import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { serve } from '@hono/node-server';

process.env.NODE_ENV = 'test';

test('authenticated HTTP carrier follows official streams, isolates sessions and closes on logout', {
  skip: process.env.SHOTLOOM_LIVE_TESTS !== '1', timeout: 120_000,
}, async () => {
  const { app } = await import('../src/index');
  const { disposeAgentHosts, closeAgentSession } = await import('../src/agent');
  const { admin, upsertUser, createSession } = await import('../src/lib/supabase');
  const owner = await upsertUser(`wire-${randomUUID()}`, { username: 'Cloud transport test' });
  const session = await createSession(owner.id, { accessToken: 'not-sent-to-gateway', expiresAt: Date.now() + 3600_000 });
  const otherSession = await createSession(owner.id, { accessToken: 'other-browser-session', expiresAt: Date.now() + 3600_000 });
  const headers = { cookie: `${process.env.COOKIE_NAME || 'shotloom_session'}=${session}`, origin: process.env.FRONTEND_URL!, 'content-type': 'application/json' };
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/api/agent`;
  const control = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const request = async (path: string, body: unknown) => {
    const response = await fetch(`${url}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
    const result = await response.json();
    assert.equal(response.status, 200, result.message);
    return result.data;
  };
  try {
    const { id } = await request('/connect', {});
    const denied = await fetch(`${url}/${id}/events`, { headers: { ...headers, cookie: `${process.env.COOKIE_NAME || 'shotloom_session'}=${otherSession}` } });
    assert.equal(denied.status, 404);
    const response = await fetch(`${url}/${id}/events`, { headers, signal: control.signal });
    assert.equal(response.status, 200);
    reader = response.body!.getReader();
    let buffer = '';
    const decoder = new TextDecoder();
    async function eventFor(requestId: string) {
      while (true) {
        let end: number;
        while ((end = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
          const data = frame.split('\n').find(line => line.startsWith('data:'))?.slice(5);
          if (data) { const event = JSON.parse(data); if (event.requestId === requestId) return event; }
        }
        const next = await reader!.read();
        if (next.done) throw new Error('Agent event stream closed too soon');
        buffer += decoder.decode(next.value, { stream: true });
      }
    }
    assert.equal((await eventFor(id)).kind, 'connected');
    const projectKey = randomUUID();
    const bound = await request(`/${id}/bind`, { binding: { projectKey, conversationId: randomUUID(), agentId: 'canvas-primary' }, tools: [], skills: [] });
    assert.deepEqual((await request('/sessions/archive', { projectKey: 'another-project', sessionIds: [bound.sessionId], archived: true })).sessionIds, []);
    assert.deepEqual((await request('/sessions/archive', { projectKey, sessionIds: [bound.sessionId], archived: true })).sessionIds, [bound.sessionId]);
    assert.deepEqual((await request('/sessions/archive', { projectKey, sessionIds: [bound.sessionId], archived: false })).sessionIds, [bound.sessionId]);
    const requestId = randomUUID();
    await request(`/${id}/message`, { requestId, kind: 'fetch', payload: {
      path: '/api/session/list', method: 'POST', headers: { 'content-type': 'application/json' },
      body: Buffer.from(JSON.stringify({ type: 'client-request', rpcId: 'test', method: 'session/list', payload: { args: { _request: {} } } })).toString('base64'),
    } });
    const event = await eventFor(requestId);
    assert.equal(event.kind, 'result');
    const catalog = JSON.parse(Buffer.from(event.value.body, 'base64').toString()).result;
    assert.equal(catalog.ok, true);
    assert.ok(catalog.value.items.some((row: { sessionId: string }) => row.sessionId === bound.sessionId));
    const streamId = randomUUID();
    await request(`/${id}/message`, { requestId: streamId, kind: 'stream', payload: { endpoint: 'workspace/follow', payload: { args: {} } } });
    assert.equal((await eventFor(streamId)).kind, 'item');
    await request(`/${id}/message`, { requestId: streamId, kind: 'cancel' });
    assert.ok(['end', 'error'].includes((await eventFor(streamId)).kind));
    closeAgentSession(session);
    assert.equal((await fetch(`${url}/${id}/bind`, { method: 'POST', headers, body: '{}' })).status, 404);
  } finally {
    control.abort(); await reader?.cancel().catch(() => {});
    await disposeAgentHosts();
    await new Promise<void>(resolve => server.close(() => resolve()));
    assert.equal((await admin.from('users').delete().eq('id', owner.id)).error, null);
  }
});
