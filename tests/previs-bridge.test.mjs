import test from 'node:test';
import assert from 'node:assert/strict';
import { subscribePrevisWorld, sendPrevisScene } from '../renderer/src/app/adapters/previsBridge.ts';
import { installPrevisBridge, previsBridge } from '../vendor/canvas-previs/src/host/bridge.ts';
import { uploadMediaFile } from '../vendor/canvas-previs/src/host/files.ts';

function bridgeWindow(t) {
  const messages = [];
  const listeners = new Set();
  const peer = { postMessage: (data, origin) => messages.push({ data, origin }) };
  const previous = globalThis.window;
  const cleanup = [];
  globalThis.window = {
    location: { origin: 'https://shotloom.test' }, parent: peer,
    addEventListener: (_, listener) => listeners.add(listener),
    removeEventListener: (_, listener) => listeners.delete(listener),
  };
  t.after(() => { cleanup.forEach((dispose) => dispose()); globalThis.window = previous; });
  return {
    peer, messages, cleanup,
    receive(data, source = peer) {
      for (const listener of listeners) listener({ data, source, origin: window.location.origin });
    },
  };
}

test('export receipts wait for the real canvas result and return failures', async (t) => {
  const context = bridgeWindow(t);
  let finish;
  const completed = new Promise((resolve) => { finish = resolve; });
  const dispose = subscribePrevisWorld(() => ({ contentWindow: context.peer }), {
    onReady() {}, onSceneChanged() {}, onAddPrompt() {}, onAddToCanvas() {}, onFlush() {},
    onCaptures: () => completed,
  });
  context.cleanup.push(dispose);
  context.receive({ type: 'shotloom:previs-captures', payload: {
    requestId: 'export-1', captures: [{ dataUrl: 'data:image/png;base64,AA==', fileName: 'frame.png' }],
  } });
  await Promise.resolve();
  assert.equal(context.messages.length, 0);
  finish();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(context.messages[0].data.payload, { requestId: 'export-1', ok: true });
  context.receive({ type: 'shotloom:previs-add-canvas', payload: { requestId: 'invalid' } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(context.messages[1].data.payload.ok, false);
  assert.equal(context.messages[1].data.payload.requestId, 'invalid');
});

test('engine exports reject host errors; unrelated windows cannot confirm them', async (t) => {
  const context = bridgeWindow(t);
  const dispose = installPrevisBridge({ onInit() {}, onImages() {} });
  context.cleanup.push(dispose);
  const exported = previsBridge.addPrompt('Shot', 'A moving camera');
  const requestId = context.messages[0].data.payload.requestId;
  context.receive({ type: 'shotloom:previs-result', payload: { requestId, ok: true } }, {});
  const rejected = assert.rejects(exported, /disk full/);
  context.receive({ type: 'shotloom:previs-result', payload: { requestId, ok: false, error: 'disk full' } });
  await rejected;
});

test('a project save failure is returned to the workbench instead of confirming saved', async (t) => {
  const context = bridgeWindow(t);
  context.cleanup.push(subscribePrevisWorld(() => ({ contentWindow: context.peer }), {
    onReady() {}, onSceneChanged() {}, onAddPrompt() {}, onAddToCanvas() {}, onCaptures() {},
    onFlush: async () => { throw new Error('project save failed'); },
  }));
  context.receive({ type: 'shotloom:previs-flush', payload: { requestId: 'save-1' } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(context.messages[0].data.payload, {
    requestId: 'save-1', ok: false, error: 'project save failed',
  });
});

test('image updates do not re-adopt a stale scene; explicit scene replacement is delivered', (t) => {
  const context = bridgeWindow(t);
  const scenes = [];
  const images = [];
  const dispose = installPrevisBridge({ onInit: (init, replace) => scenes.push([init.scene, replace]), onImages: (nodes) => images.push(nodes) });
  context.cleanup.push(dispose);
  const scene = { id: 'scene', objects: [], shots: [], cameras: [], lights: [] };
  context.receive({ type: 'shotloom:previs-init', payload: { scene } });
  context.receive({ type: 'shotloom:previs-images', payload: { imageNodes: [{ id: 'image' }] } });
  assert.equal(scenes.length, 1);
  assert.equal(images[0][0].id, 'image');
  const edited = { ...scene, updatedAt: 'new' };
  context.receive({ type: 'shotloom:previs-scene', payload: { scene: edited } });
  assert.equal(scenes[1][0], edited);
  assert.equal(scenes[1][1], true);
  context.receive({ type: 'shotloom:previs-init' });
  assert.equal(scenes.length, 2);
});

test('domain proxies are serialized before crossing the iframe boundary', (t) => {
  const context = bridgeWindow(t);
  const scene = new Proxy({ id: 'scene', objects: [] }, {});
  sendPrevisScene({ contentWindow: context.peer }, scene);
  assert.deepEqual(structuredClone(context.messages[0].data).payload.scene, { id: 'scene', objects: [] });
});

test('an unavailable asset database cannot report a successful model import', async () => {
  await assert.rejects(uploadMediaFile(new Blob(['model']), 'model'), /无法保存世界引擎素材/);
});
