import assert from 'node:assert/strict';
import test from 'node:test';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

test('模型准备完成前不连接宿主，并合并重复初始化', async () => {
  const env = await createRendererEnv();
  try {
    const { DirectorHostSession } = await env.loadVendor('shotloom-director-desk/src/core/host-session.ts');
    const binding = new DirectorHostSession();
    let release, started;
    const gate = new Promise(resolve => { release = resolve; });
    const loading = new Promise(resolve => { started = resolve; });
    const first = binding.initialize('model-node', async () => { started(); await gate; });
    await loading;
    assert.equal(binding.connected, false);
    const duplicate = binding.initialize('model-node', () => assert.fail('duplicate initialization must not reload'));
    release();
    assert.equal(await first, true);
    assert.equal(await duplicate, false);
    assert.equal(binding.connected, true);
  } finally { await env.dispose(); }
});

test('导演台重复 ready/load 初始化不会回灌旧场景或清空已产生的编辑', async () => {
  const env = await createRendererEnv();
  try {
    const { DirectorHostSession } = await env.loadVendor('shotloom-director-desk/src/core/host-session.ts');
    const binding = new DirectorHostSession();
    let scene = { color: 'white', revision: 0 };
    assert.equal(await binding.initialize('node-a', () => { scene = { color: 'white', revision: 1 }; }), true);
    const id = binding.id;
    scene = { color: 'blue', revision: 2 };
    assert.equal(await binding.initialize('node-a', () => { scene = { color: 'white', revision: 1 }; }), false);
    assert.deepEqual(scene, { color: 'blue', revision: 2 });
    assert.equal(binding.id, id);
    assert.doesNotThrow(() => binding.assertCurrent(id, scene.revision));
  } finally { await env.dispose(); }
});

test('重建 iframe 后即使 revision 相同，也拒绝旧会话批次和缺少标识的批次', async () => {
  const env = await createRendererEnv();
  try {
    const { DirectorHostSession } = await env.loadVendor('shotloom-director-desk/src/core/host-session.ts');
    const first = new DirectorHostSession();
    await first.initialize('node-a', () => {});
    const reopened = new DirectorHostSession();
    await reopened.initialize('node-a', () => {});
    for (const stale of [first.id, undefined, '']) {
      assert.throws(() => reopened.assertCurrent(stale, 2), error => {
        assert.equal(error.code, 'SESSION_MISMATCH');
        assert.equal(error.facts.currentRevision, 2);
        assert.equal(error.facts.currentSessionId, reopened.id);
        return true;
      });
    }
    assert.doesNotThrow(() => reopened.assertCurrent(reopened.id, 2));
  } finally { await env.dispose(); }
});

test('切换节点必须重新绑定；加载失败保持未连接且可以重试', async () => {
  const env = await createRendererEnv();
  try {
    const { DirectorHostSession } = await env.loadVendor('shotloom-director-desk/src/core/host-session.ts');
    const binding = new DirectorHostSession();
    await binding.initialize('node-a', () => {});
    const oldId = binding.id;
    await assert.rejects(binding.initialize('node-b', () => { throw Error('invalid document'); }), /invalid document/);
    assert.equal(binding.connected, false);
    assert.throws(() => binding.assertCurrent(oldId, 2), { code: 'SESSION_MISMATCH' });
    assert.equal(await binding.initialize('node-b', () => {}), true);
    assert.equal(binding.connected, true);
    assert.notEqual(binding.id, oldId);
  } finally { await env.dispose(); }
});


test('revision diff 区分增删改、场景属性与历史过期', async () => {
  const env = await createRendererEnv();
  try {
    const { DirectorHostSession } = await env.loadVendor('shotloom-director-desk/src/core/host-session.ts');
    const binding = new DirectorHostSession();
    await binding.initialize('node-a', () => {});
    const doc = entities => ({ scenes: [{ id: 'scene-a', state: { entities, duration: 5 } }] });
    binding.record(1, doc([{ id: 'a', color: 'red' }, { id: 'b' }]));
    binding.record(2, doc([{ id: 'a', color: 'blue' }, { id: 'c' }]));
    const diff = binding.diff(1, 2);
    assert.equal(diff.complete, true);
    assert.deepEqual(diff.addedEntityIds, ['c']);
    assert.deepEqual(diff.deletedEntityIds, ['b']);
    assert.deepEqual(diff.modifiedEntityIds, ['a']);
    const copiedScene = { id: 'scene-b', state: { entities: [{ id: 'a', color: 'red' }] } };
    binding.record(3, { scenes: [...doc([{ id: 'a', color: 'red' }]).scenes, copiedScene] });
    binding.record(4, { scenes: [...doc([{ id: 'a', color: 'blue' }]).scenes, copiedScene] });
    assert.deepEqual(binding.diff(3, 4).modifiedEntityIds, ['a']);
    for (let i = 3; i < 36; i++) binding.record(i, doc([]));
    assert.equal(binding.diff(1, 35).complete, false);
  } finally { await env.dispose(); }
});

test('等待模型资源时不重复加载，也不让已切换的旧会话重新连接', async () => {
  const env = await createRendererEnv();
  try {
    const { DirectorHostSession } = await env.loadVendor('shotloom-director-desk/src/core/host-session.ts');
    const binding = new DirectorHostSession();
    const pending = Promise.withResolvers();
    const first = binding.initialize('node-a', async signal => {
      await pending.promise;
      assert.equal(signal.aborted, true);
    });
    assert.equal(binding.connected, false);
    assert.equal(await binding.initialize('node-a', () => assert.fail('duplicated load')), false);
    const next = Promise.withResolvers();
    const second = binding.initialize('node-b', () => next.promise);
    pending.resolve();
    assert.equal(await first, false);
    assert.equal(binding.connected, false);
    next.resolve();
    assert.equal(await second, true);
    assert.equal(binding.connected, true);
  } finally { await env.dispose(); }
});
