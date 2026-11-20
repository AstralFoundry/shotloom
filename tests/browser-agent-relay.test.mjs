import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

async function fixture() {
  const state = { calls: [], checks: [], fail: false, errorFinish: false };
  globalThis.__shotloomRelayProbe = state;
  const result = await build({ entryPoints: [fileURLToPath(new URL('../server/src/agent.ts', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'node', target: 'es2022',
    plugins: [{ name: 'stateless-relay-boundaries', setup(builder) {
      builder.onResolve({ filter: /^\.\/auth$/ }, () => ({ path: 'auth', namespace: 'relay-probe' }));
      builder.onResolve({ filter: /^\.\/env$/ }, () => ({ path: 'env', namespace: 'relay-probe' }));
      builder.onResolve({ filter: /^\.\/models$/ }, () => ({ path: 'models', namespace: 'relay-probe' }));
      builder.onResolve({ filter: /dist\/browserModelRelay\.js$/ }, () => ({ path: 'model', namespace: 'relay-probe' }));
      builder.onLoad({ filter: /.*/, namespace: 'relay-probe' }, args => ({ contents: {
        auth: `export const requireAuth=async(c,next)=>{if(!c.req.header('x-test-owner'))return c.json({message:'unauthorized'},401);c.set('accessToken','server-only-key');await next();};`,
        env: `export const env={GATEWAY_BASE_URL:'https://gateway.invalid'};`,
        models: `export async function assertPublishedRelay(request,path){globalThis.__shotloomRelayProbe.checks.push({path,body:await request.json()});}`,
        model: `export async function createBrowserModelRelay(...args){const state=globalThis.__shotloomRelayProbe;state.calls.push(args);return {async *stream(){if(state.fail)throw new Error('secret-upstream-key');if(state.errorFinish)yield {type:'finish',reason:{kind:'error',failure:{message:'secret-upstream-key',...state.failure}}};else yield {type:'text-delta',index:0,text:'relay-passed'};},dispose:async()=>{state.disposed=true;}};}`,
      }[args.path], loader: 'js' }));
    } }],
  });
  const { agentApp } = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
  agentApp.onError((error, c) => c.json({ message: error.message }, error.status || 500));
  const input = { request: { provider: 'client-route', model: 'published-model', messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }] },
    profile: { api: 'openai-completions', baseURL: 'https://attacker.invalid', headers: { authorization: 'attacker' }, apiKeyEnv: 'attacker',
      models: [{ id: 'published-model', name: 'Published', input: ['text'], contextWindow: 100000 }] }, images: [] };
  const request = value => agentApp.request('/model', { method: 'POST', headers: { 'content-type': 'application/json', 'x-test-owner': 'test' }, body: JSON.stringify(value) });
  return { state, app: agentApp, input, request };
}

test('browser relay authenticates, enforces published endpoints, and ignores client credentials and URLs', async () => {
  const { state, app, input, request } = await fixture();
  assert.equal((await app.request('/model', { method: 'POST' })).status, 401);
  assert.equal((await request({})).status, 400);
  for (const [api, path] of [['openai-completions', '/v1/chat/completions'], ['openai-responses', '/v1/responses'], ['anthropic-messages', '/v1/messages']]) {
    input.profile.api = api;
    const response = await request(input);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /relay-passed/);
    assert.equal(state.checks.at(-1).path, path);
    assert.equal(state.calls.at(-1)[0].baseURL, 'https://gateway.invalid/v1');
    assert.equal(state.calls.at(-1)[0].headers, undefined);
    assert.equal(state.calls.at(-1)[0].apiKeyEnv, undefined);
    assert.equal(state.calls.at(-1)[1], 'server-only-key');
  }
  assert.equal((await app.request('/connect', { method: 'POST', headers: { 'x-test-owner': 'test' } })).status, 404);
  delete globalThis.__shotloomRelayProbe;
});

test('模型错误保留 Harness 恢复所需分类，移除供应商文本和任意字段', async () => {
  const { state, input, request } = await fixture();
  state.errorFinish = true;
  for (const code of ['CONTEXT_WINDOW_EXCEEDED', 'QUOTA', 'INVALID_CREDENTIAL', 'TIMEOUT', 'IMAGE_OFFLOAD_REQUIRED']) {
    state.failure = { code, status: 429, providerRetryAfterMs: 1200, offloadImages: 2, key: 'secret-upstream-key' };
    const frames = (await (await request(input)).text()).trim().split('\n').map(JSON.parse);
    const finish = frames.find(frame => frame.chunk?.type === 'finish');
    assert.equal(finish?.chunk.reason.failure.code, code);
    assert.equal(finish.chunk.reason.failure.status, 429);
    assert.equal(finish.chunk.reason.failure.providerRetryAfterMs, 1200);
    assert.equal(finish.chunk.reason.failure.offloadImages, 2);
    assert.doesNotMatch(JSON.stringify(frames), /secret-upstream-key|server-only-key/);
    assert.equal(frames.at(-1).done, true);
  }
  delete globalThis.__shotloomRelayProbe;
});

test('thrown errors and error finish events never disclose upstream secrets', async () => {
  const { state, input, request } = await fixture();
  for (const kind of ['fail', 'errorFinish']) {
    state.fail = kind === 'fail'; state.errorFinish = kind === 'errorFinish'; state.disposed = false;
    const text = await (await request(input)).text();
    assert.match(text, /MODEL_REQUEST_FAILED/);
    assert.doesNotMatch(text, /secret-upstream-key|server-only-key/);
    assert.equal(state.disposed, true);
  }
  delete globalThis.__shotloomRelayProbe;
});
