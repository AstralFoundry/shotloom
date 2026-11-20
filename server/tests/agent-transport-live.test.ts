import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

process.env.NODE_ENV = 'test';

test('retired cloud Agent transport cannot start a server-side loop', {
  skip: process.env.SHOTLOOM_LIVE_TESTS !== '1', timeout: 30000,
}, async () => {
  const { app } = await import('../src/index');
  const { admin, upsertUser, createSession } = await import('../src/lib/supabase');
  const owner = await upsertUser(`worker-${randomUUID()}`, { username: 'Worker transport test' });
  const session = await createSession(owner.id, { accessToken: 'not-sent-to-gateway', expiresAt: Date.now() + 3600000 });
  const headers = { cookie: `${process.env.COOKIE_NAME || 'shotloom_session'}=${session}`, origin: process.env.FRONTEND_URL!, 'content-type': 'application/json' };
  try {
    const retired = await app.request('/api/agent/connect', { method: 'POST', headers, body: '{}' });
    assert.equal(retired.status, 404);
    const malformed = await app.request('/api/agent/model', { method: 'POST', headers, body: '{}' });
    assert.equal(malformed.status, 400);
  } finally {
    await admin.from('app_users').delete().eq('id', owner.id);
  }
});
