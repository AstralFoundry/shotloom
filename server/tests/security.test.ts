import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NODE_ENV = 'test';
process.env.GATEWAY_BASE_URL = 'https://gateway.example.com';
process.env.GATEWAY_CLIENT_ID = 'nac_test';
process.env.GATEWAY_CLIENT_SECRET = 'test-confidential-secret';
process.env.GATEWAY_REDIRECT_URI = 'http://localhost:5173/api/auth/callback';
process.env.FRONTEND_URL = 'http://localhost:5173';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
process.env.SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key';
process.env.SESSION_ENCRYPTION_KEY = '11'.repeat(32);

const { app } = await import('../src/index');
const { encrypt, decrypt } = await import('../src/lib/crypto');
const { scopedKey } = await import('../src/lib/supabase');
const { relayPath } = await import('../src/lib/relay');

test('relay preserves gateway protocols and cannot forward credentials to dashboard or other hosts', () => {
  assert.equal(relayPath('/chat/completions', 'openai', 'v1'), '/v1/chat/completions');
  assert.equal(relayPath('/v1/responses', 'openai', 'v1'), '/v1/responses');
  assert.equal(relayPath('/contents/generations/tasks', 'bytedance', 'root'), '/api/v3/contents/generations/tasks');
  assert.equal(relayPath('/videos/text2video', 'kling', 'root'), '/kling/v1/videos/text2video');
  assert.equal(relayPath('/v2/video_generation', 'minimax', 'root'), '/hailuo/v2/video_generation');
  assert.equal(relayPath('/v2/query/video_generation/task_1', 'minimax', 'root'), '/hailuo/v2/query/video_generation/task_1');
  assert.throws(() => relayPath('/admin', 'minimax', 'root'));
  assert.equal(relayPath('/v1beta/models/gemini:generateContent', 'google', 'origin'), '/v1beta/models/gemini:generateContent');
  for (const path of ['//attacker.example', '/api/user/self', '/v1/../api/user', '/v1/%2e%2e/api/user', '/v1/a?secret=x']) {
    assert.throws(() => relayPath(path, 'openai', 'origin'));
  }
});

test('official Supabase login uses a private PKCE cookie and an isolated provider', async () => {
  const response = await app.request('/api/auth/login?redirect=https://attacker.example');
  assert.equal(response.status, 302);
  const target = new URL(response.headers.get('location')!);
  assert.equal(target.origin, 'https://example.supabase.co');
  assert.equal(target.pathname, '/auth/v1/authorize');
  assert.equal(target.searchParams.get('provider'), 'custom:shotloom-newapi');
  assert.equal(target.searchParams.get('redirect_to'), 'http://localhost:5173/api/auth/callback');
  assert.equal(target.searchParams.get('code_challenge_method'), 's256');
  assert.equal(target.searchParams.has('client_secret'), false);
  const cookies = response.headers.getSetCookie();
  const pkce = cookies.find(cookie => cookie.startsWith('shotloom-supabase-auth-code-verifier='))!;
  assert.ok(pkce); assert.match(pkce, /HttpOnly/i); assert.match(pkce, /SameSite=Lax/i);
  const flowCookie = cookies.find(cookie => cookie.startsWith('shotloom_oauth='))!;
  const flow = JSON.parse(decrypt(decodeURIComponent(flowCookie.split(';')[0]!.split('=').slice(1).join('='))));
  assert.equal(flow.redirect, 'http://localhost:5173');
});

test('callbacks reject absent, corrupt and expired flow cookies before token exchange', async () => {
  for (const flow of [undefined, 'corrupt', { createdAt: Date.now() - 601_000 }, { createdAt: Date.now() + 60_000 }]) {
    const response = await app.request('/api/auth/callback?code=one-time', {
      headers: flow ? { cookie: `shotloom_oauth=${encodeURIComponent(encrypt(typeof flow === 'string' ? flow : JSON.stringify(flow)))}` } : {},
    });
    assert.equal(response.status, 302);
    assert.match(response.headers.get('location')!, /invalid_state/);
  }
});

test('new-api identity binding rejects user metadata, another App and ambiguous identities', async () => {
  const { gatewaySubject } = await import('../src/lib/authClient');
  const identity = { provider: 'custom:shotloom-newapi', identity_data: { sub: '8', aud: ['nac_test'] }, id: 'identity', user_id: 'user', identity_id: 'identity', created_at: '' };
  assert.equal(gatewaySubject({ identities: [identity] }, identity.provider, 'nac_test'), '8');
  for (const identities of [undefined, [], [identity, identity], [{ ...identity, provider: 'custom:newapi' }], [{ ...identity, identity_data: { sub: '8', aud: ['other-app'] } }], [{ ...identity, identity_data: { sub: 'invalid', aud: ['nac_test'] } }]]) {
    assert.throws(() => gatewaySubject({ identities }, identity.provider, 'nac_test'));
  }
});

test('anonymous data access and cross-origin writes are denied', async () => {
  for (const path of ['/api/projects', '/api/settings', '/api/files/content?bucket=media&key=x']) {
    assert.equal((await app.request(path)).status, 401);
  }
  for (const origin of [undefined, 'https://attacker.example']) {
    const response = await app.request('/api/settings', { method: 'PUT', headers: origin ? { origin } : {} });
    assert.equal(response.status, 403);
  }
});

test('object references cannot escape the configured application and user prefix', () => {
  assert.equal(scopedKey('owner', 'folder/file.mp4'), 'nac_test/owner/folder/file.mp4');
  for (const key of ['../other/file', '/absolute', 'a//b', 'a/./b', 'a\\b', 'a?token=x', 'a%2fb', 'a\0b']) {
    assert.throws(() => scopedKey('owner', key));
  }
});

test('encrypted session material rejects tampering', () => {
  const cipher = encrypt('private-token');
  assert.equal(decrypt(cipher), 'private-token');
  const [iv, tag, body] = cipher.split('.');
  const bytes = Buffer.from(body!, 'base64url'); bytes[0] = bytes[0]! ^ 1;
  assert.throws(() => decrypt(`${iv}.${tag}.${bytes.toString('base64url')}`));
});
