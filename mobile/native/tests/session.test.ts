import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import type * as Session from '../src/session';

async function fixture() {
  const result = await build({ entryPoints: ['src/session.ts'], absWorkingDir: fileURLToPath(new URL('..', import.meta.url)), bundle: true, write: false, platform: 'node', format: 'cjs', plugins: [{ name: 'auth-platform', setup(builder) {
    builder.onResolve({ filter: /^(expo-crypto|expo-secure-store|expo-web-browser)$|^\.\/i18n$/ }, () => ({ path: 'auth', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `
      const crypto=require('node:crypto');const state=globalThis.__nativeAuth={stored:new Map(),requests:[],mode:'success',userId:'fixture-user'};
      exports.CryptoDigestAlgorithm={SHA256:'sha256'};exports.CryptoEncoding={BASE64:'base64'};
      exports.digestStringAsync=async(_algorithm,value,options)=>crypto.createHash('sha256').update(value).digest(options?.encoding||'hex');
      exports.getRandomBytesAsync=async size=>crypto.randomBytes(size);exports.randomUUID=()=>crypto.randomUUID();
      exports.getItemAsync=async key=>state.stored.get(key)||null;exports.setItemAsync=async(key,value)=>state.stored.set(key,value);exports.deleteItemAsync=async key=>state.stored.delete(key);
      exports.t=key=>key;
      exports.openAuthSessionAsync=async(url,redirect)=>{state.authUrl=url;state.redirect=redirect;if(state.mode==='cancel')return {type:'cancel'};const query=new URL(url).searchParams;return {type:'success',url:redirect+'?code=one-time-code&state='+(state.mode==='bad-state'?'wrong':query.get('native_state'))}};
    ` }));
  } }] });
  const module = { exports: {} as typeof Session };
  new Function('require', 'module', 'exports', result.outputFiles[0]!.text)(createRequire(import.meta.url), module, module.exports);
  return { session: module.exports, state: (globalThis as any).__nativeAuth };
}

test('browser login binds PKCE and state, persists only the Shotloom session, and restores per origin', async () => {
  const { session, state } = await fixture();
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    state.requests.push(String(input));
    assert.equal(String(input), 'https://cloud.example/api/auth/native/exchange');
    const body = JSON.parse(String(init?.body));
    const { createHash } = await import('node:crypto');
    assert.equal(createHash('sha256').update(body.verifier).digest('base64url'), new URL(state.authUrl).searchParams.get('native_challenge'));
    assert.equal(body.code, 'one-time-code');
    return Response.json({ success: true, data: { token: 'opaque-shotloom-session', userId: state.userId } });
  };
  try {
    assert.equal(await session.restoreSession('https://cloud.example'), null);
    const value = await session.login('https://cloud.example');
    assert.deepEqual(value, { token: 'opaque-shotloom-session', userId: 'fixture-user' });
    assert.equal(state.redirect, 'shotloom-preview://auth/callback');
    assert.deepEqual(await session.restoreSession('https://cloud.example'), value);
    assert.equal(await session.restoreSession('https://another.example'), null);
    await session.clearSession('https://cloud.example');
    assert.equal(await session.restoreSession('https://cloud.example'), null);
  } finally { globalThis.fetch = original; }
});

test('cancelled or mismatched callbacks cannot exchange or persist a session; another account is revoked', async () => {
  const { session, state } = await fixture();
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    state.requests.push(String(input));
    if (String(input).endsWith('/logout')) assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer other-token');
    return Response.json({ success: true, data: String(input).endsWith('/logout') ? null : { token: 'other-token', userId: 'other-user' } });
  };
  try {
    state.mode = 'cancel';
    assert.equal(await session.login('https://cloud.example'), null);
    state.mode = 'bad-state';
    await assert.rejects(session.login('https://cloud.example'), /cloud.login.failed/);
    assert.equal(state.requests.length, 0);
    assert.equal(state.stored.size, 0);
    state.mode = 'success';
    await assert.rejects(session.login('https://cloud.example', 'fixture-user'), /cloud.login.accountChanged/);
    assert.ok(state.requests.at(-1).endsWith('/auth/logout'));
    assert.equal(state.stored.size, 0);
  } finally { globalThis.fetch = original; }
});

test('workspace bootstrap puts a one-time code in the POST body and keeps the persistent token out of WebView', async () => {
  const { session } = await fixture();
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), 'https://cloud.example/api/auth/native/workspace-ticket');
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer private-token');
    assert.deepEqual(JSON.parse(String(init?.body)), { redirect: 'https://cloud.example/?project=fixture' });
    return Response.json({ success: true, data: { code: 'one-time' } });
  };
  try {
    const source = await session.workspaceSource('https://cloud.example', 'private-token', 'https://cloud.example/?project=fixture');
    assert.equal(source.uri, 'https://cloud.example/api/auth/native/workspace');
    assert.equal(source.method, 'POST');
    assert.equal(source.body, 'code=one-time');
    assert.equal(JSON.stringify(source).includes('private-token'), false);
  } finally { globalThis.fetch = original; }
});
