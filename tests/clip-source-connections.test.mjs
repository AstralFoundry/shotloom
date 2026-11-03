import test from 'node:test';
import assert from 'node:assert/strict';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

async function fixture() {
  const env = await createRendererEnv();
  const { ClipSourceConnections } = await env.load('app/editor/openReel/clipSourceConnections');
  const edge = { id: 'source-edge', source: 'source', target: 'editor', data: { derivation: 'clip-source' } };
  const node = { id: 'editor', clipSources: [{ edge, assetId: 'asset', state: 'connected', used: true }] };
  let edges = [edge];
  let clips = [
    { id: 'from-source', trackId: 'track', mediaId: 'media', sourceConnectionId: edge.id, startTime: 0, duration: 3 },
    { id: 'manual', trackId: 'track', mediaId: 'media', startTime: 3, duration: 3 },
  ];
  let live = true;
  let imports = 0;
  let resolve = async () => ({ id: 'asset-new', type: 'video', sourceUrl: '/real.mp4', name: 'real.mp4' });
  const errors = [];
  const actions = [];
  const state = () => ({ native: { timeline: { tracks: [{ id: 'track', clips }] } }, playhead: 0, selectedClipIds: [], canUndo: true, canRedo: false, duration: 6 });
  const coordinator = new ClipSourceConnections({
    node: () => live ? node : null,
    edges: () => edges,
    setEdges: value => { edges = value; },
    sourceExists: () => true,
    resolve: id => resolve(id),
    importAsset: async asset => { imports++; return { key: asset.id, mediaId: 'media-new', type: 'video', duration: 2 }; },
    place: async (item, id) => { clips.push({ id: `placed-${imports}`, trackId: 'track', mediaId: item.mediaId, sourceConnectionId: id, startTime: 6, duration: 2 }); coordinator.observe(state()); },
    actions: async (batch) => {
      actions.push(batch);
      for (const action of batch) {
        if (action.type === 'clip/remove') clips = clips.filter(clip => clip.id !== action.params.clipId);
        else if (action.type === 'clip/add') clips.push(structuredClone(action.params.sourceClip));
      }
      coordinator.observe(state());
    },
    changed: () => {},
    error: error => errors.push(error.message),
  });
  coordinator.observe(state());
  return { env, coordinator, node, edge, errors, actions, state,
    get edges() { return edges; }, set edges(value) { edges = value; },
    get clips() { return clips; }, set clips(value) { clips = value; },
    get imports() { return imports; },
    resolveWith(fn) { resolve = fn; }, invalidate() { live = false; },
    dispose: async () => { coordinator.dispose(); await env.dispose(); },
  };
}

test('断开来源只移除归属片段，保留同文件手动副本；恢复连线按原 ID 和效果恢复', async () => {
  const f = await fixture();
  try {
    f.clips[0].effects = [{ id: 'grade', params: { strength: 0.6 } }];
    f.coordinator.observe(f.state());
    f.edges = [];
    await f.coordinator.sync();
    assert.deepEqual(f.clips.map(clip => clip.id), ['manual']);
    assert.equal(f.actions[0].length, 1);
    f.edges = [f.edge];
    await f.coordinator.sync();
    const restored = f.clips.find(clip => clip.id === 'from-source');
    assert.deepEqual(restored.effects, [{ id: 'grade', params: { strength: 0.6 } }]);
    assert.equal(restored.sourceConnectionId, f.edge.id);
    assert.equal(f.imports, 0);
    assert.deepEqual(f.errors, []);
  } finally { await f.dispose(); }
});

test('切分后的归属片段都参与同步，删除最后一段反向断线，原生撤销恢复连线', async () => {
  const f = await fixture();
  try {
    const original = structuredClone(f.clips[0]);
    f.clips.push({ ...original, id: 'split-copy', startTime: 1, duration: 2 });
    f.coordinator.observe(f.state());
    assert.deepEqual(f.edges[0].data.clipIds, ['from-source', 'split-copy']);
    f.clips = f.clips.filter(clip => clip.id !== 'from-source');
    f.coordinator.observe(f.state());
    assert.equal(f.edges.length, 1);
    f.clips = f.clips.filter(clip => clip.id !== 'split-copy');
    f.coordinator.observe(f.state());
    assert.equal(f.edges.length, 0);
    await f.coordinator.sync();
    assert.equal(f.imports, 0);
    f.clips.push(original);
    f.coordinator.observe(f.state());
    assert.equal(f.edges[0].id, f.edge.id);
  } finally { await f.dispose(); }
});

test('新增来源导入落轨一次，重复同步与重选不重复导入', async () => {
  const f = await fixture();
  try {
    f.edges.push({ id: 'second', source: 'source-2', target: 'editor', data: { derivation: 'clip-source' } });
    await f.coordinator.sync();
    await f.coordinator.sync();
    await f.coordinator.sync();
    assert.equal(f.imports, 1);
    assert.equal(f.clips.filter(clip => clip.sourceConnectionId === 'second').length, 1);
    assert.equal(f.node.clipSources.length, 2);
    assert.deepEqual(f.errors, []);
  } finally { await f.dispose(); }
});

test('来源解析期间断线或删除工程，迟到结果不导入、不落轨', async () => {
  const f = await fixture();
  try {
    let release;
    f.resolveWith(() => new Promise(resolve => { release = resolve; }));
    f.edges.push({ id: 'pending', source: 'new', target: 'editor' });
    const pending = f.coordinator.sync();
    f.edges = f.edges.filter(edge => edge.id !== 'pending');
    release({ id: 'late', type: 'video', name: 'late.mp4', sourceUrl: '/late.mp4' });
    await pending;
    assert.equal(f.imports, 0);
    assert.equal(f.clips.length, 2);
    f.edges.push({ id: 'deleted', source: 'new', target: 'editor' });
    const deleted = f.coordinator.sync();
    f.invalidate();
    release({ id: 'late', type: 'video', name: 'late.mp4', sourceUrl: '/late.mp4' });
    await deleted;
    assert.equal(f.imports, 0);
  } finally { await f.dispose(); }
});
