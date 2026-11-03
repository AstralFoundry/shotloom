import test from 'node:test';
import assert from 'node:assert/strict';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

const clone = value => JSON.parse(JSON.stringify(value));

async function fixture() {
  const env = await createRendererEnv({ withWindow: true });
  const { store } = await env.load('store/projectStore');
  const { desktopApi } = await env.load('services/desktopApi');
  const { createProject } = await env.load('store/projectNormalization');
  const snapshots = await env.load('services/clipSnapshotStore');
  const clipboard = await env.load('store/clipboardStore');
  store.project = createProject('copy test');
  store.projectDir = '/copy-test';
  const asset = 'canvas:source:output';
  const linked = { id: 'linked', mediaId: 'media', sourceConnectionId: 'edge', startTime: 1, duration: 2, inPoint: 1, outPoint: 3, effects: [{ id: 'fx', type: 'blur', params: { amount: 7 } }] };
  const manual = { ...clone(linked), id: 'manual' }; delete manual.sourceConnectionId;
  const edge = { id: 'edge', source: 'source', target: 'clip', data: { skipTaskInput: true, derivation: 'clip-source', assetId: asset, clipIds: ['linked'] } };
  const native = { id: 'engine-project', settings: { width: 1280, height: 720 }, timeline: { tracks: [{ id: 'track', clips: [linked, manual] }] }, mediaLibrary: { items: [{ id: 'media', shotloomAssetId: asset }] }, textClips: [{ id: 'text', text: '中文字幕', startTime: 1, duration: 2 }], shotloomSession: { playhead: 2, view: { pixelsPerSecond: 90, scrollX: 37, scrollY: 8 }, undo: [{ before: { projectId: 'engine-project', clips: [clone(linked)] } }], redo: [] } };
  store.project.nodes = [
    { id: 'source', type: 'videoGeneration', uploadedFile: { path: '/original/source.mp4', name: 'source.mp4' } },
    { id: 'clip', type: 'clipStudio', clipNodeVersion: 1, videoEditProject: { openReelSnapshot: 'project.sqlite#editor/clip', assets: [{ id: asset, type: 'video', sourceFile: '/original/source.mp4' }], tracks: [{ clips: [{ id: 'linked', assetId: asset, sourceConnectionId: 'edge' }] }] }, clipSources: [{ edge, assetId: asset, state: 'connected', used: true }], clipExportDeliveries: [{ id: 'old-export' }] },
  ];
  store.project.edges = [edge];
  store.project.nodes[1].videoEditProject.openReelOverview = {
    id: native.id, timeline: clone(native.timeline),
    shotloomSession: { view: clone(native.shotloomSession.view), playhead: 2 },
  };
  const files = new Map([['/copy-test/project.sqlite#editor/clip', clone(native)]]);
  desktopApi.project.getEditorSnapshot = async (directory, nodeId) => clone(files.get(`${directory}/project.sqlite#editor/${nodeId}`) ?? null);
  desktopApi.project.setEditorSnapshot = async (directory, nodeId, snapshot) => { files.set(`${directory}/project.sqlite#editor/${nodeId}`, clone(snapshot)); return { saved: true }; };
  desktopApi.file.copyToDirectory = async (_path, directory) => ({ filePath: `${directory}/copied-source.mp4` });
  let staged;
  desktopApi.clipboard.stageWorkflow = async payload => { staged = clone(payload); return payload; };
  desktopApi.clipboard.readStagedSentinel = async () => ({ snapshotId: 'snapshot' });
  desktopApi.clipboard.loadStagedPayload = async () => ({ ...clone(staged), resources: staged.resources.map(resource => ({ ...resource, stagedPath: '/staged/source.mp4' })) });
  return { env, store, desktopApi, files, native, snapshots, ...clipboard, payload: () => staged };
}

test('通过实际暂存/粘贴入口复制完整工程、历史和视图，来源与文件引用映射到副本', async () => {
  const f = await fixture();
  try {
    await f.stageSelectedWorkflow();
    assert.equal(f.payload().nodes[1].clipTransfer.native.textClips[0].text, '中文字幕');
    assert.ok(f.payload().resources.some(resource => resource.filePath === '/original/source.mp4'));
    await f.pasteStagedWorkflow();
    const nodes = f.store.project.nodes;
    const copied = nodes.find(node => node.type === 'clipStudio' && node.id !== 'clip');
    const sourceCopy = nodes.find(node => node.type === 'videoGeneration' && node.id !== 'source');
    const edge = f.store.project.edges.find(edge => edge.target === copied.id);
    const restored = f.files.get(`/copy-test/${copied.videoEditProject.openReelSnapshot}`);
    assert.notEqual(restored.id, f.native.id);
    assert.equal(restored.timeline.tracks[0].clips[0].sourceConnectionId, edge.id);
    assert.equal(copied.videoEditProject.openReelOverview.id, restored.id);
    assert.equal(copied.videoEditProject.openReelOverview.timeline.tracks[0].clips[0].sourceConnectionId, edge.id);
    assert.equal(f.store.project.nodes.find(node => node.id === 'clip').videoEditProject.openReelOverview.id, 'engine-project');
    assert.equal(restored.shotloomSession.undo[0].before.clips[0].sourceConnectionId, edge.id);
    assert.equal(restored.shotloomSession.undo[0].before.projectId, restored.id);
    assert.equal(restored.timeline.tracks[0].clips[1].sourceConnectionId, undefined);
    assert.equal(restored.timeline.tracks[0].clips[0].effects[0].params.amount, 7);
    assert.equal(restored.shotloomSession.view.scrollX, 37);
    assert.equal(restored.shotloomSession.playhead, 2);
    assert.deepEqual(restored.textClips, f.native.textClips);
    const asset = `canvas:${sourceCopy.id}:output`;
    assert.equal(restored.mediaLibrary.items[0].shotloomAssetId, asset);
    assert.equal(copied.videoEditProject.assets[0].id, asset);
    assert.equal(copied.videoEditProject.assets[0].sourceFile, '/copy-test/assets/copied-source.mp4');
    assert.equal(edge.data.assetId, asset);
    assert.equal(copied.clipSources[0].edge.source, sourceCopy.id);
    assert.equal(copied.clipSources[0].edge.id, edge.id);
    assert.equal(copied.clipTransfer, undefined);
    assert.equal(copied.clipExportDeliveries, undefined);
    restored.timeline.tracks[0].clips[0].effects[0].params.amount = 99;
    await f.snapshots.writeNativeSnapshot('/copy-test', copied.id, restored);
    assert.equal((await f.snapshots.readNativeSnapshot('/copy-test', 'clip', true)).timeline.tracks[0].clips[0].effects[0].params.amount, 7);
  } finally { await f.env.dispose(); }
});

test('只复制剪辑节点时保留媒体和历史，剥离未复制连线的归属，撤销不会接回原节点', async () => {
  const f = await fixture();
  try {
    f.store.selectedNodeId = 'clip'; f.store.selectedNodeIds = ['clip'];
    await f.stageSelectedWorkflow(); await f.pasteStagedWorkflow();
    const copied = f.store.project.nodes.find(node => node.type === 'clipStudio' && node.id !== 'clip');
    const restored = f.files.get(`/copy-test/${copied.videoEditProject.openReelSnapshot}`);
    assert.equal(restored.timeline.tracks[0].clips.length, 2);
    assert.equal(restored.timeline.tracks[0].clips[0].sourceConnectionId, undefined);
    assert.equal(copied.videoEditProject.openReelOverview.timeline.tracks[0].clips[0].sourceConnectionId, undefined);
    assert.equal(restored.shotloomSession.undo[0].before.clips[0].sourceConnectionId, undefined);
    assert.deepEqual(copied.clipSources, []);
    assert.equal(f.store.project.edges.length, 1);
    assert.equal(copied.videoEditProject.assets[0].id, 'canvas:source:output');
  } finally { await f.env.dispose(); }
});

test('完整快照读取或副本写盘失败时，不生成空副本或画布历史', async () => {
  const f = await fixture();
  try {
    f.files.clear();
    await assert.rejects(f.stageSelectedWorkflow(), /快照不存在/);
    assert.equal(f.payload(), undefined);
    f.files.set('/copy-test/project.sqlite#editor/clip', clone(f.native));
    await f.stageSelectedWorkflow();
    const before = clone(f.store.project);
    f.desktopApi.project.setEditorSnapshot = async () => { throw new Error('readonly'); };
    await assert.rejects(f.pasteStagedWorkflow(), /readonly/);
    for (const key of ['nodes', 'edges', 'materials', 'canvasHistory']) assert.deepEqual(f.store.project[key], before[key]);
  } finally { await f.env.dispose(); }
});

test('模板导入也创建独立工程快照；摘要不完整的旧载荷明确失败', async () => {
  const f = await fixture();
  try {
    const workflow = await f.captureWorkflowSnapshot();
    const result = await f.importWorkflowTemplate(workflow);
    assert.equal(result.importedNodes, 2);
    const copied = f.store.project.nodes.find(node => node.type === 'clipStudio' && node.id !== 'clip');
    assert.ok(f.files.has(`/copy-test/${copied.videoEditProject.openReelSnapshot}`));
    const before = f.store.project.nodes.length;
    delete workflow.nodes[1].clipTransfer;
    await assert.rejects(f.importWorkflowTemplate(workflow), /缺少完整工程/);
    assert.equal(f.store.project.nodes.length, before);
  } finally { await f.env.dispose(); }
});

test('复制优先取得引擎当前快照，项目切换后不暂存旧请求', async () => {
  const f = await fixture();
  let unregister;
  try {
    let finish;
    unregister = f.snapshots.registerClipSnapshotReader('/copy-test', 'clip', () => new Promise(resolve => { finish = resolve; }));
    const pending = f.stageSelectedWorkflow();
    f.store.project = clone(f.store.project);
    finish({ ...clone(f.native), modifiedAt: 999 });
    await assert.rejects(pending, /项目或剪辑节点已变化/);
    assert.equal(f.payload(), undefined);
  } finally { unregister?.(); await f.env.dispose(); }
});

test('媒体复制失败或快照写入中切换项目，不向目标画布提交半份工程', async () => {
  const f = await fixture();
  try {
    await f.stageSelectedWorkflow();
    f.desktopApi.file.copyToDirectory = async () => { throw new Error('media copy failed'); };
    await assert.rejects(f.pasteStagedWorkflow(), /media copy failed/);
    assert.equal(f.store.project.nodes.length, 2);
    assert.equal(f.store.project.canvasHistory.length, 0);
    f.desktopApi.file.copyToDirectory = async () => ({ filePath: '/copy-test/assets/source.mp4' });
    let finish;
    f.desktopApi.project.setEditorSnapshot = () => new Promise(resolve => { finish = resolve; });
    const pending = f.pasteStagedWorkflow();
    while (!finish) await new Promise(resolve => setImmediate(resolve));
    f.store.project = clone(f.store.project);
    finish({ filePath: '/copy-test/new-snapshot.json' });
    await assert.rejects(pending, /项目已切换/);
    assert.equal(f.store.project.nodes.length, 2);
    assert.equal(f.store.project.materials.length, 0);
    assert.equal(f.store.project.canvasHistory.length, 0);
  } finally { await f.env.dispose(); }
});
