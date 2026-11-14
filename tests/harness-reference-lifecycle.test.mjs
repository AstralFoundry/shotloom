import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({
  entryPoints: ['harness/host/client/canvasReferences.ts'], bundle: true, write: false,
  format: 'esm', platform: 'node', plugins: [{ name: 'reference-presentation-stubs', setup(plugin) {
    plugin.onLoad({ filter: /canvasReferenceMenu\.tsx$/ }, () => ({ contents: 'export const referenceCategories=[];export const directorReferenceCategories=[];export function installCanvasReferenceMenu(){}', loader: 'js' }));
    plugin.onLoad({ filter: /canvasMediaCards\.tsx$/ }, () => ({ contents: 'export function installCanvasMediaCards(){return Object.assign(()=>{},{loading(){}})}', loader: 'js' }));
    plugin.onLoad({ filter: /client\/i18n\.ts$/ }, () => ({ contents: 'export const t=key=>key', loader: 'js' }));
  } }],
});
const { installCanvasReferences } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

function runtime() {
  const sources = new Map();
  const inputTriggers = { registerSource(source) {
    assert.ok(!sources.has(source.name), `duplicate source: ${source.name}`);
    sources.set(source.name, source);
    return () => sources.delete(source.name);
  } };
  const mount = (sessionId, label) => {
    const cleanup = [];
    const ctx = { inputTriggers: new Proxy(inputTriggers, { get(target, key) { return typeof key === 'symbol' ? target : Reflect.get(target, key); } }), sessions: { scope() {} }, effect(start) { cleanup.push(start()); } };
    installCanvasReferences(ctx, sessionId, {
      agentId: 'director-primary', preview() {}, navigate() {},
      async readReference(id) { return id ? { node: { id, label, type: 'character', mediaType: 'other' } } : { nodes: [{ id: label, label, type: 'character', mediaType: 'other' }] }; },
    });
    return () => { for (const stop of cleanup.reverse()) stop(); };
  };
  return { sources, mount };
}
const candidates = (source, sessionId) => source.candidates({ sessionId }, { query: '' });

test('overlapping director mounts share registration; old cleanup cannot remove the new owner', async () => {
  const { sources, mount } = runtime();
  const old = mount('session-a', 'old');
  const newer = mount('session-a', 'new');
  await Promise.resolve();
  assert.equal(sources.size, 2);
  const source = [...sources.values()][0];
  assert.equal((await candidates(source, 'session-a'))[0].name, 'new');
  old(); old();
  assert.equal(sources.size, 2);
  assert.match(await source.codec.serialize('node', new AbortController().signal), /new/);
  const legacy = [...sources.values()].find(item => !item.name.endsWith(':session-a'));
  assert.match(await legacy.codec.serialize('node', new AbortController().signal), /new/);
  newer();
  assert.equal(sources.size, 0);
  const retry = mount('session-a', 'retry');
  await Promise.resolve();
  assert.equal((await candidates([...sources.values()][0], 'session-a'))[0].name, 'retry');
  retry();
});

test('different director sessions keep candidates and serialization isolated', async () => {
  const { sources, mount } = runtime();
  const stopA = mount('session-a', 'A');
  const stopB = mount('session-b', 'B');
  await Promise.resolve();
  assert.equal(sources.size, 3);
  const a = [...sources.values()].find(source => source.name.endsWith(':session-a'));
  const b = [...sources.values()].find(source => source.name.endsWith(':session-b'));
  assert.deepEqual(await candidates(a, 'session-b'), []);
  assert.equal((await candidates(b, 'session-b'))[0].name, 'B');
  assert.match(await a.codec.serialize('node', new AbortController().signal), /"label":"A"/);
  const legacy=[...sources.values()].find(item=>!item.name.includes(':session-'));
  await assert.rejects(legacy.codec.serialize('node',new AbortController().signal));
  stopB();
  assert.equal(sources.size, 2);
  assert.equal((await candidates(a, 'session-a'))[0].name, 'A');
  stopA();
});

test('new-owner disposal restores an older live owner and repeated retries clean up', async () => {
  const { sources, mount } = runtime();
  const original = mount('session-a', 'original');
  for (let attempt = 0; attempt < 20; attempt++) {
    const stop = mount('session-a', `retry-${attempt}`);
    await Promise.resolve();
    stop();
    assert.equal(sources.size, 2);
    assert.equal((await candidates([...sources.values()][0], 'session-a'))[0].name, 'original');
  }
  original();
  assert.equal(sources.size, 0);
});
