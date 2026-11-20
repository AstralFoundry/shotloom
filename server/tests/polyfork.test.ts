import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
Object.assign(process.env, {
  NODE_ENV: 'test', GATEWAY_BASE_URL: 'https://gateway.example.com', GATEWAY_CLIENT_ID: 'nac_test',
  GATEWAY_CLIENT_SECRET: 'test-secret', GATEWAY_REDIRECT_URI: 'http://localhost:5173/api/auth/callback',
  FRONTEND_URL: 'http://localhost:5173', SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role', SUPABASE_PUBLISHABLE_KEY: 'test-publishable', SESSION_ENCRYPTION_KEY: '11'.repeat(32),
});
const { app } = await import('../src/index');
const { encrypt } = await import('../src/lib/crypto');

test('Polyfork queries and downloads require auth, constrain upstream URLs and preserve free mesh attribution', async () => {
  const original = globalThis.fetch;
  const user = randomUUID(), session = randomUUID();
  const id = 'armchair-980c7c';
  const asset = { id, title: 'Armchair', free: true, thumbnail: null, triangles: null, size_m: null, credit: 'Armchair by Polyfork, CC BY 4.0', license: 'Mesh files: CC BY 4.0', download: { glb: `https://polyfork.dev/cdn/${id}.glb` } };
  const requests: URL[] = [];
  let detail: unknown = asset, mode = 'ok';
  const glb = Buffer.alloc(24); glb.write('glTF'); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(24, 8);
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === 'example.supabase.co') {
      if (url.pathname.endsWith('/sessions')) return Response.json({ id: session, user_id: user, owner: { id: user, sub: '1', username: null, email: null }, access_token_cipher: encrypt('token'), refresh_token_cipher: null, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 3600000).toISOString() });
      assert(url.pathname.endsWith('/users')); return Response.json({ id: user });
    }
    assert.equal(url.origin, 'https://polyfork.dev');
    assert.equal(init?.redirect, 'error');
    assert.equal(new Headers(init?.headers).get('user-agent'), 'Shotloom/ModelLibrary');
    assert.equal(new Headers(init?.headers).has('authorization'), false);
    requests.push(url);
    if (mode === 'rate') return new Response(null, { status: 429, headers: { 'retry-after': '120' } });
    if (url.pathname === '/api/assets') return Response.json({ assets: [asset], total: 1, page: 2, per_page: 24 });
    if (url.pathname.startsWith('/api/assets/')) return Response.json(detail);
    assert.equal(url.pathname, `/cdn/${id}.glb`);
    if (mode === 'oversized') return new Response('x', { headers: { 'content-length': String(33 * 1024 * 1024) } });
    if (mode === 'invalid') return new Response('not a GLB');
    return new Response(glb);
  };
  const request = (path: string) => app.request(`/api/polyfork${path}`, { headers: { cookie: `shotloom_session=${session}` } });
  try {
    assert.equal((await app.request('/api/polyfork/assets')).status, 401);
    const list = await request('/assets?q=chair&page=2&url=https://evil.example/');
    assert.equal(list.status, 200);
    assert.equal((await list.json()).data.assets[0].triangles, null);
    assert.equal(requests[0]!.searchParams.get('free'), '1');
    assert.equal(requests[0]!.searchParams.has('url'), false);
    const info = (await (await request(`/assets/${id}`)).json()).data;
    assert.equal(info.credit, asset.credit); assert.equal(info.source, `https://polyfork.dev/asset/${id}`);
    assert.equal(info.licenseUrl, 'https://creativecommons.org/licenses/by/4.0/');
    const file = await request(`/assets/${id}/model`);
    assert.equal(file.status, 200); assert.equal(file.headers.get('content-type'), 'model/gltf-binary');
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), glb);
    for (const path of ['/assets?page=0', '/assets?per_page=101', '/assets?per_page=oops', '/assets/model.mjs/model']) assert.equal((await request(path)).status, 400);
    const count = requests.length;
    detail = { ...asset, free: false };
    assert.equal((await request(`/assets/${id}/model`)).status, 400);
    assert.equal(requests.length, count + 1, 'paid files are never fetched');
    detail = { ...asset, download: { glb: 'https://evil.example/private' } };
    assert.equal((await request(`/assets/${id}/model`)).status, 502);
    detail = { ...asset, credit: '', license: 'No redistribution' };
    assert.equal((await request(`/assets/${id}/model`)).status, 502);
    detail = asset;
    for (const failure of ['oversized', 'invalid']) { mode = failure; assert.equal((await request(`/assets/${id}/model`)).status, 502); }
    mode = 'rate';
    assert.equal((await request('/assets')).status, 429);
    const rateCount = requests.length;
    assert.equal((await request('/assets')).status, 429);
    assert.equal(requests.length, rateCount, '429 stops subsequent upstream calls during Retry-After');
  } finally { globalThis.fetch = original; }
});
