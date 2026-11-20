import assert from 'node:assert/strict';
import test from 'node:test';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

test('archiving an unopened project uses its own Worker scope and always releases it', async () => {
  const workers = [];
  const originals = new Map(['Worker', 'document', 'isSecureContext', 'indexedDB', 'OffscreenCanvas', 'navigator', 'setInterval'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let heartbeat;
  const setInterval = globalThis.setInterval;
  globalThis.setInterval = (callback, ms, ...args) => {
    if (ms === 20000) heartbeat = callback;
    return setInterval(callback, ms, ...args);
  };
  globalThis.document = { baseURI: 'http://localhost/' };
  globalThis.Worker = class {
    messages = [];
    terminated = false;
    constructor() { workers.push(this); }
    postMessage(message) {
      this.messages.push(structuredClone(message));
      queueMicrotask(() => this.onmessage({ data: { type: 'result', id: message.id,
        ...(message.type === 'archive' ? { value: { sessionIds: message.payload.sessionIds } } : {}),
        ...(workers.length === 2 ? { error: 'Project is locked' } : {}),
      } }));
    }
    terminate() { this.terminated = true; }
  };
  const modules = {
    './cloudRequest': `export const cloudEnabled=true,cloudOrigin="",cloudUserHeaders=()=>({});
      export async function readCloudSession(force){if(force)throw new TypeError('network error');return {id:'local'};}
      export async function verifyCloudSession(){try{await readCloudSession(true);}catch{}}`,
    './agentProjectIdentity': 'export const getAgentProjectIdentity=()=>({projectKey:"current",fenceKey:"current:1"});',
    '../store/domainReactivity': 'export const subscribeDomain=()=>()=>{};',
  };
  const env = await createRendererEnv({ withWindow: true, plugins: [{
    name: 'worker-lifecycle-boundaries', enforce: 'pre',
    resolveId(source, importer) { if (importer?.endsWith('/services/browserHarnessTransport.ts') && source in modules) return '\0lifecycle:' + source; },
    load(id) { if (id.startsWith('\0lifecycle:')) return modules[id.slice(11)]; },
  }] });
  try {
    const { archiveBrowserHarness, connectBrowserHarness, bindBrowserHarness, registerBrowserToolHandler } = await env.load('services/browserHarnessTransport');
    assert.deepEqual(await archiveBrowserHarness('unopened', ['local-session'], true), { sessionIds: ['local-session'] });
    assert.deepEqual(workers[0].messages, [
      { type: 'boot', id: 'boot', payload: { userId: 'local', projectKey: 'unopened' } },
      { type: 'archive', id: 'archive', payload: { projectKey: 'unopened', sessionIds: ['local-session'], archived: true } },
    ]);
    assert.equal(workers[0].terminated, true);
    await assert.rejects(archiveBrowserHarness('locked', undefined, true), /Project is locked/);
    assert.equal(workers[1].terminated, true);
    assert.equal(workers[1].messages.length, 1, 'a failed boot must not submit archive changes');
    globalThis.isSecureContext = true;
    globalThis.indexedDB = {};
    globalThis.OffscreenCanvas = class {};
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: {} } });
    await connectBrowserHarness();
    workers[2].onmessage({ data: { type: 'fatal', error: 'storage failed' } });
    assert.equal(workers[2].terminated, true);
    await connectBrowserHarness();
    workers[2].onerror({ message: 'late failure from the previous Worker' });
    await bindBrowserHarness(new Proxy({ binding: 'new-worker' }, {}));
    assert.deepEqual(workers[3].messages.at(-1).payload, { binding: 'new-worker' });
    assert.equal(workers.length, 4, 'late failures must not dispose the replacement Worker');
    assert.equal(workers[3].terminated, false);
    await heartbeat();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(workers[3].terminated, false, 'a transient auth heartbeat network error must not terminate the active run');
    let signal;
    registerBrowserToolHandler(async (_request, value) => { signal = value; });
    workers[3].onmessage({ data: { type: 'host-request', id: 'cancellable-tool', method: 'tool', payload: { requestId: 'tool-call' } } });
    assert.equal(signal?.aborted, false);
    workers[3].onmessage({ data: { type: 'host-abort', id: 'cancellable-tool' } });
    assert.equal(signal.aborted, true, 'Worker cancellation must reach the product handler');
    await new Promise(resolve => setImmediate(resolve));
    workers[3].onmessage({ data: { type: 'fatal', error: 'test teardown' } });
  } finally {
    await env.dispose();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
});
