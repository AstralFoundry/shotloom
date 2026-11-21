import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

const env = await createRendererEnv({ storage: new Map(), withWindow: true });
after(() => env.dispose());
const { store } = await env.load('store/projectStore');
const { settingsStore, getAvailableModelIdsByType } = await env.load('store/settingsStore');
const batch = await env.load('services/batchTableService');
const script = await env.load('services/storyboardScriptService');
const { batchCellHandle, batchColumnHandle, batchRowColumnReferences, defaultBatchTable } = await env.load('domain/graph/BatchTable');

function seed() {
  store.project = { ...store.project, id: 'suite-test', nodes: [], edges: [], tasks: [], materials: [], assets: [] };
  store.projectDir = null;
  store.filePath = null;
  settingsStore.providerConfigs = { openai: { apiKey: 'fixture-key', baseUrl: 'http://127.0.0.1:1' } };
  for (const id of ['person', 'clothes', 'background']) store.project.nodes.push({ id, type: 'imageGeneration', title: id, uploadedFile: { path: `/${id}.png`, resourceType: 'image' } });
}

test('批量表在提交失败时仍保存行与产出身份，重复提交复用节点，已删除引用不能启动', async () => {
  seed();
  assert.ok(getAvailableModelIdsByType('imageGeneration').length);
  const table = { ...defaultBatchTable(), concurrency: 1, rows: [{ id: 'row-1', enabled: true, prompt: '换装', referenceNodeIds: ['person', 'clothes', ''], outputNodeId: '' }] };
  // 一个不可用的模型在 runNode 的凭据校验处失败，真实服务不会发出网络请求。
  store.project.nodes.push({ id: 'table', type: 'batchTable', batchTable: table, batchGenerationSettings: { model: 'unavailable-fixture-model', config: {}, inputMode: '' } });
  await batch.runBatchTable('table');
  let saved = batch.batchTableData(store.project.nodes.find(node => node.id === 'table'));
  const outputId = saved.rows[0].outputNodeId;
  assert.ok(outputId);
  assert.ok(store.project.nodes.some(node => node.id === outputId));
  assert.equal(saved.runState.running, false);
  assert.equal(saved.runState.failed, 1);
  assert.equal(store.project.tasks.length, 0);
  await batch.runBatchTable('table');
  saved = batch.batchTableData(store.project.nodes.find(node => node.id === 'table'));
  assert.equal(saved.rows[0].outputNodeId, outputId);
  assert.equal(store.project.nodes.filter(node => node.batchSourceNodeId === 'table').length, 1);
  store.project.nodes = store.project.nodes.filter(node => node.id !== 'clothes');
  assert.equal(batch.batchRowCanRun(saved, saved.rows[0], []), false);
});

test('批量表拖动已连接的默认参考按实际展示值交换，保存后空列不挪位', () => {
  seed();
  const table = { ...defaultBatchTable(), rows: [{ id: 'a', enabled: true, prompt: 'A', referenceNodeIds: [], outputNodeId: '' }, { id: 'b', enabled: true, prompt: 'B', referenceNodeIds: ['', '', 'background'], outputNodeId: '' }] };
  store.project.nodes.push({ id: 'table', type: 'batchTable', batchTable: table });
  store.project.edges.push({ id: 'input', source: 'person', target: 'table', data: { batchColumnId: table.columns[0].id } });
  batch.moveBatchCell('table', 'a', 0, 'b', 2);
  const saved = batch.batchTableData(store.project.nodes.find(node => node.id === 'table'));
  assert.deepEqual(saved.rows[0].referenceNodeIds, ['background', '', '']);
  assert.deepEqual(saved.rows[1].referenceNodeIds, ['person', '', 'person']);
});

test('整列连线按行分配，单格连线随列移动且可独立清除', async () => {
  seed();
  const { canvasController } = await env.load('app/adapters/canvasAdapter');
  const { buildCanvasViewData } = await env.load('app/adapters/canvas/canvasViewData');
  const table = { ...defaultBatchTable(), rows: [
    { id: 'row:1', enabled: true, prompt: '换装', referenceNodeIds: [], outputNodeId: '' },
    { id: 'row:2', enabled: true, prompt: '换装', referenceNodeIds: [], outputNodeId: '' },
  ] };
  store.project.nodes.push({ id: 'table', type: 'batchTable', batchTable: table });
  const [first, second] = table.columns;
  const connect = (source, targetHandle) => canvasController.connect({ source, target: 'table', sourceHandle: 'port-right', targetHandle });
  assert.equal(connect('person', batchColumnHandle(first.id)), true);
  assert.equal(connect('clothes', batchColumnHandle(first.id)), true);
  assert.equal(connect('clothes', batchColumnHandle(second.id)), true);
  assert.deepEqual(batchRowColumnReferences(batch.batchReferenceInputs('table'), 0), ['person', 'clothes', '']);
  assert.deepEqual(batchRowColumnReferences(batch.batchReferenceInputs('table'), 1), ['clothes', 'clothes', '']);

  const handle = batchCellHandle('row:1', second.id);
  assert.equal(connect('background', handle), true);
  const [cellEdge] = buildCanvasViewData(store).edges.filter(edge => edge.data?.batchCell);
  assert.equal(cellEdge.targetHandle, handle);
  assert.equal(cellEdge.source, 'background');
  assert.equal(store.project.edges.length, 3);
  batch.moveBatchColumn('table', second.id, first.id);
  assert.equal(buildCanvasViewData(store).edges.find(edge => edge.data?.batchCell)?.id, cellEdge.id);
  canvasController.selectEdge(cellEdge.id);
  canvasController.deleteSelection();
  assert.equal(buildCanvasViewData(store).edges.some(edge => edge.data?.batchCell), false);
  assert.equal(store.project.edges.length, 3);
});

test('从节点两侧创建时只允许匹配的节点，并一次撤销创建与连线', async () => {
  seed();
  const { canvasController } = await env.load('app/adapters/canvasAdapter');
  const { undoCanvas } = await env.load('store/canvasHistoryStore');
  const scriptHandle = (await env.load('domain/graph/StoryboardScript')).STORYBOARD_CONTEXT_HANDLE;
  const anchor = { id: 'anchor', type: 'textGeneration', title: '文本', model: 'unregistered-text-model', x: 400, y: 100 };
  store.project.nodes.push(anchor);
  assert.deepEqual(canvasController.portNodeTypes('anchor', 'left'), ['textGeneration']);
  assert.ok(canvasController.portNodeTypes('anchor', 'right').includes('storyboardScript'));
  assert.ok(!canvasController.portNodeTypes('anchor', 'right').includes('batchTable'));
  const countBefore = store.project.nodes.length;
  await canvasController.createNodeFromPort('anchor', 'left', 'imageGeneration');
  assert.equal(store.project.nodes.length, countBefore);

  await canvasController.createNodeFromPort('anchor', 'left', 'textGeneration');
  const source = store.project.nodes.find(node => node.id === store.selectedNodeId);
  assert.ok(source.x < anchor.x);
  assert.ok(store.project.edges.some(edge => edge.source === source.id && edge.target === anchor.id));
  undoCanvas();
  assert.equal(store.project.nodes.length, countBefore);
  assert.equal(store.project.edges.length, 0);

  await canvasController.createNodeFromPort('anchor', 'right', 'storyboardScript');
  assert.equal(store.project.edges[0].source, 'anchor');
  assert.equal(store.project.edges[0].targetHandle, scriptHandle);
  assert.equal(store.project.edges[0].target, store.selectedNodeId);

  await canvasController.createNodeFromPort('person', 'right', 'batchTable');
  const batchNode = store.project.nodes.find(node => node.id === store.selectedNodeId);
  assert.equal(batchNode.type, 'batchTable');
  assert.ok(store.project.edges.some(edge => edge.source === 'person'
    && edge.target === batchNode.id && edge.targetHandle === batchColumnHandle(batchNode.batchTable.columns[0].id)));
});

test('分镜产出保持镜头身份，图片与视频分列排布，镜头内容编辑后创建产出仍保留台词', () => {
  seed();
  const node = script.createStoryboardScriptNode({ x: 100, y: 80 });
  assert.equal(node.storyboardShotCount, 0);
  assert.deepEqual(script.storyboardShots(node).map((row) => row.durationSeconds), [6, 6, 6]);
  const [shot] = script.storyboardShots(node);
  script.updateStoryboardShot(node.id, shot.id, { plot: '推门', dialogue: '有人吗？', durationSeconds: 9 });
  script.updateStoryboardShot(node.id, shot.id, { camera: '缓慢推近' });
  const image = script.ensureStoryboardShotNode(node.id, shot.id, 'image');
  const video = script.ensureStoryboardShotNode(node.id, shot.id, 'video');
  assert.equal(script.storyboardShots(node)[0].dialogue, '有人吗？');
  assert.equal(script.storyboardShots(node)[0].durationSeconds, 9);
  assert.deepEqual([image.canvasWidth, image.canvasHeight], [480, 270]);
  assert.ok(image.x + image.canvasWidth < video.x);
  const second = script.storyboardShots(node)[1];
  const nextVideo = script.ensureStoryboardShotNode(node.id, second.id, 'video');
  assert.equal(nextVideo.x, video.x);
  assert.ok(video.y + video.canvasHeight < nextVideo.y);
  assert.equal(video.outputSpec.duration, 9);
  assert.deepEqual(script.storyboardShotNodes(node.id, shot.id), { imageNodeId: image.id, videoNodeId: video.id });
  assert.equal(script.ensureStoryboardShotNode(node.id, shot.id, 'video').id, video.id);
});


test('分镜行端口隔离资产，镜头移动保留连线，删除清理本行连线', () => {
  seed();
  const node = script.createStoryboardScriptNode({ x: 100, y: 80 });
  const [first, second, third] = script.storyboardShots(node);
  assert.equal(script.connectStoryboardRowAsset('person', node.id, first.id), true);
  assert.equal(script.connectStoryboardRowAsset('person', node.id, second.id), true);
  assert.deepEqual(script.storyboardShotReferenceIds(node.id, first), ['person']);
  assert.deepEqual(script.storyboardShotReferenceIds(node.id, third), []);
  const output = script.ensureStoryboardShotNode(node.id, first.id, 'video');
  assert.ok(store.project.edges.some((edge) => edge.source === node.id && edge.target === output.id && edge.sourceHandle === `storyboard-out:${first.id}`));
  script.moveStoryboardShot(node.id, first.id, 1);
  assert.deepEqual(script.storyboardShotReferenceIds(node.id, first), ['person']);
  script.removeStoryboardShot(node.id, first.id);
  assert.ok(!store.project.edges.some((edge) => String(edge.sourceHandle || edge.targetHandle || '').endsWith(first.id)));
  assert.deepEqual(script.storyboardShotReferenceIds(node.id, second), ['person']);
  assert.ok(store.project.nodes.some((item) => item.id === output.id));
});

test('分镜批次在提交失败后保存逐镜结果，单镜重试复用产出并保留其它项', async () => {
  seed();
  assert.ok(getAvailableModelIdsByType('imageGeneration').length);
  const node = script.createStoryboardScriptNode({ x: 0, y: 0 });
  const [first, second] = script.storyboardShots(node);
  const outputs = [first, second].map((row) => {
    script.updateStoryboardShot(node.id, row.id, { imagePrompt: '傍晚的街道' });
    const output = script.ensureStoryboardShotNode(node.id, row.id, 'image');
    output.model = 'unavailable-fixture-model';
    return output.id;
  });
  await script.runStoryboardShots(node.id, 'image');
  const before = script.storyboardBatch(node);
  assert.deepEqual(before.items.map((item) => [item.status, item.attempts]), [['failed', 1], ['failed', 1]]);
  assert.ok(before.items.every((item) => item.error && item.retryable));
  assert.equal(store.project.tasks.length, 0);
  await script.retryStoryboardBatch(node.id, before.id, second.id);
  const after = script.storyboardBatch(node);
  assert.equal(after.id, before.id);
  assert.deepEqual(after.items.map((item) => [item.status, item.attempts]), [['failed', 1], ['failed', 2]]);
  assert.deepEqual(script.storyboardShots(node).slice(0, 2).map((shot) => shot.imageNodeId), outputs);
});

test('分镜批次按已保存的提交身份恢复，未知提交状态不参与重试', async () => {
  seed();
  const node = script.createStoryboardScriptNode({ x: 0, y: 0 });
  const [first, second] = script.storyboardShots(node);
  node.storyboardBatch = {
    id: 'restored-batch',
    kind: 'image',
    items: [
      { shotId: first.id, shotNumber: 1, status: 'submitting', submissionId: 'saved-submission', attempts: 1 },
      { shotId: second.id, shotNumber: 2, status: 'submitting', attempts: 1 },
    ],
  };
  store.project.tasks.push({ id: 'remote-task', submissionId: 'saved-submission', status: 'queued' });
  assert.equal(script.isStoryboardRunActive(node.id), true);
  assert.deepEqual(script.storyboardBatch(node).items.map((item) => [item.status, item.retryable]), [['queued', false], ['failed', false]]);
  store.project.tasks[0].status = 'completed';
  assert.equal(script.isStoryboardRunActive(node.id), false);
  assert.deepEqual(script.storyboardBatch(node).items.map((item) => [item.status, item.retryable]), [['completed', false], ['failed', false]]);
  await script.retryStoryboardBatch(node.id, 'restored-batch');
  assert.equal(store.project.tasks.length, 1);
});

test('停止分镜批次只跳过等待镜头，保留已提交任务的最终状态', { timeout: 3000 }, async () => {
  seed();
  const { desktopApi } = await env.load('services/desktopApi');
  const original = desktopApi.model.imageGeneration;
  const { cancelTask } = await env.load('store/taskStore');
  const started = Promise.withResolvers();
  const response = Promise.withResolvers();
  desktopApi.model.imageGeneration = () => {
    started.resolve();
    return response.promise;
  };
  try {
    const node = script.createStoryboardScriptNode({ x: 0, y: 0 });
    const [first, second] = script.storyboardShots(node);
    for (const shot of [first, second]) script.updateStoryboardShot(node.id, shot.id, { imagePrompt: '傍晚的街道' });
    const run = script.runStoryboardShots(node.id, 'image');
    try {
      assert.equal(store.project.tasks.length, 1);
      assert.equal(script.storyboardBatch(node).items[0].taskId, store.project.tasks[0].id);
      script.cancelStoryboardRun(node.id);
      assert.deepEqual(script.storyboardBatch(node).items.map((item) => item.status), ['running', 'cancelled']);
      await Promise.race([started.promise, run]);
      response.reject(new Error('测试：上游返回失败'));
      await run;
    } finally {
      for (const task of store.project.tasks) cancelTask(task.id);
    }
    assert.deepEqual(script.storyboardBatch(node).items.map((item) => item.status), ['failed', 'cancelled']);
    assert.equal(store.project.tasks.length, 1);
    assert.equal(script.storyboardShotNodes(node.id, second.id).imageNodeId, '');
  } finally {
    desktopApi.model.imageGeneration = original;
  }
});

test('分镜资产角色按镜头保存，修改或移除关联会同步既有产出的参考', () => {
  seed();
  const node = script.createStoryboardScriptNode({ x: 0, y: 0 });
  const [first, second] = script.storyboardShots(node);
  assert.equal(script.connectStoryboardRowAsset('person', node.id, first.id), true);
  assert.equal(script.setStoryboardShotAssetBindings(node.id, first.id, [{ nodeId: 'person', role: 'character' }]), true);
  assert.equal(script.setStoryboardShotAssetBindings(node.id, second.id, [{ nodeId: 'person', role: 'prop' }]), true);
  const output = script.ensureStoryboardShotNode(node.id, first.id, 'image');
  const reference = () => store.project.edges.find((edge) => edge.source === 'person' && edge.target === output.id);
  assert.equal(reference()?.data?.storyboardAssetRole, 'character');
  assert.equal(script.setStoryboardShotAssetBindings(node.id, first.id, [{ nodeId: 'person', role: 'wardrobe' }]), true);
  assert.equal(reference()?.data?.storyboardAssetRole, 'wardrobe');
  const saved = JSON.parse(JSON.stringify(node));
  assert.deepEqual(script.storyboardShots(saved).map((row) => row.assetRoles?.person), ['wardrobe', 'prop', undefined]);
  assert.equal(script.setStoryboardShotAssetBindings(node.id, first.id, [{ nodeId: 'missing', role: 'style' }]), false);
  assert.ok(reference());
  script.setStoryboardShotAssetBindings(node.id, first.id, []);
  assert.equal(reference(), undefined);
  assert.deepEqual(script.storyboardShotAssetBindings(node.id, script.storyboardShots(node)[1]), [{ nodeId: 'person', role: 'prop' }]);
});

test('项目资产通过真实素材记录引入，已有画布节点会复用，视频和音频支持独立绑定', () => {
  seed();
  store.project.materials.push({ id: 'voice-file', path: '/voice.wav', resourceType: 'audio' });
  store.project.assets.push({ id: 'voice-asset', materialId: 'voice-file', name: '对白', resourceType: 'audio', category: 'voice' });
  const node = script.createStoryboardScriptNode({ x: 0, y: 0 });
  const [shot] = script.storyboardShots(node);
  const voice = script.importStoryboardProjectAsset('voice-asset');
  assert.equal(voice.role, 'audio');
  assert.deepEqual(script.importStoryboardProjectAsset('voice-asset'), voice);
  const imported = store.project.nodes.find((item) => item.id === voice.nodeId);
  assert.equal(imported.uploadedFile.path, '/voice.wav');
  store.project.nodes.push({ id: 'action', type: 'videoGeneration', uploadedFile: { path: '/action.mp4', resourceType: 'video' } });
  assert.equal(script.connectStoryboardRowAsset('action', node.id, shot.id), true);
  assert.equal(script.connectStoryboardRowAsset(voice.nodeId, node.id, shot.id), true);
  assert.deepEqual(script.storyboardShotAssetBindings(node.id, shot), [{ nodeId: 'action', role: 'motion' }, voice]);
  const output = script.ensureStoryboardShotNode(node.id, shot.id, 'image');
  assert.ok(!store.project.edges.some((edge) => edge.target === output.id && [voice.nodeId, 'action'].includes(edge.source)));
});

test('分镜合并按镜头顺序和当前选中视频版本输出，只登记成功返回的成片', async () => {
  seed();
  const { mergeCanvasVideos } = await env.load('services/canvasVideoMergeService');
  const { desktopApi } = await env.load('services/desktopApi');
  const node = script.createStoryboardScriptNode({ x: 0, y: 0 });
  const [first, second, third] = script.storyboardShots(node);
  const firstVideo = script.ensureStoryboardShotNode(node.id, first.id, 'video');
  const secondVideo = script.ensureStoryboardShotNode(node.id, second.id, 'video');
  const thirdVideo = script.ensureStoryboardShotNode(node.id, third.id, 'video');
  firstVideo.x = 999;
  secondVideo.x = -99;
  firstVideo.generatedOutputs = [
    { id: 'selected', filePath: '/shot-1-selected.mp4', resourceType: 'video' },
    { id: 'other', filePath: '/shot-1-other.mp4', resourceType: 'video' },
  ];
  firstVideo.selectedOutputNodeId = 'selected';
  secondVideo.uploadedFile = { path: '/shot-2.mp4', resourceType: 'video' };
  thirdVideo.uploadedFile = { path: '/shot-3-reference.png', resourceType: 'image' };
  const sources = script.storyboardReadyVideos(script.storyboardShots(node));
  assert.deepEqual(sources.map((source) => source.shotNumber), [1, 2]);

  const original = desktopApi.file.concatVideos;
  try {
    desktopApi.file.concatVideos = async () => null;
    await assert.rejects(mergeCanvasVideos(sources, node.id));
    assert.equal(script.storyboardFinalVideo(node.id), undefined);
    desktopApi.file.concatVideos = async (paths) => {
      assert.deepEqual(paths, ['/shot-1-selected.mp4', '/shot-2.mp4']);
      return { filePath: '/cut.mp4', name: 'cut.mp4', size: 192 };
    };
    const cut = await mergeCanvasVideos(sources, node.id);
    assert.equal(script.storyboardFinalVideo(node.id).id, cut.id);
    assert.equal(cut.uploadedFile.path, '/cut.mp4');
    assert.ok(store.project.materials.some((item) => item.id === cut.materialId));
    assert.deepEqual(store.project.edges.filter((edge) => edge.target === cut.id).map((edge) => edge.source), [node.id, firstVideo.id, secondVideo.id]);
  } finally {
    desktopApi.file.concatVideos = original;
  }
});

test('分镜制作的生成目标区分空描述、已有结果、进行中和缺首帧', () => {
  seed();
  const node = script.createStoryboardScriptNode({ x: 0, y: 0 });
  const [first, second, third] = script.storyboardShots(node);
  for (const shot of [first, second]) script.updateStoryboardShot(node.id, shot.id, { videoPrompt: '人物推门' });
  const existing = script.ensureStoryboardShotNode(node.id, second.id, 'video');
  existing.uploadedFile = { path: '/completed.mp4', resourceType: 'video' };
  const states = (force = false) => script.storyboardGenerationTargets(node, script.storyboardShots(node), 'video', force).map((item) => item.state);
  assert.deepEqual(states(), ['ready', 'done', 'noPrompt']);
  script.setStoryboardGenerationSettings(node.id, { videoInputMode: 'keyframe' });
  assert.deepEqual(states(), ['missingKeyframe', 'done', 'noPrompt']);
  assert.deepEqual(states(true), ['missingKeyframe', 'missingKeyframe', 'noPrompt']);
  const frame = script.ensureStoryboardShotNode(node.id, first.id, 'image');
  frame.uploadedFile = { path: '/keyframe.png', resourceType: 'image' };
  assert.deepEqual(states(), ['ready', 'done', 'noPrompt']);
  const pending = script.ensureStoryboardShotNode(node.id, first.id, 'video');
  pending.status = 'running';
  assert.deepEqual(states(), ['busy', 'done', 'noPrompt']);
  pending.status = 'failed';
  store.project.tasks.unshift({ id: 'uncertain', nodeId: pending.id, submissionUncertain: true, status: 'failed' });
  assert.deepEqual(states(), ['uncertain', 'done', 'noPrompt']);
  assert.equal(script.storyboardShots(node)[2].id, third.id);
});

test('镜头制作区区分画布连线、逐镜关联、生成引用和首帧来源', () => {
  seed();
  const node = script.createStoryboardScriptNode({ x: 0, y: 0 });
  const [shot] = script.storyboardShots(node);
  script.connectStoryboardRowAsset('person', node.id, shot.id);
  script.setStoryboardShotAssetBindings(node.id, shot.id, [
    { nodeId: 'person', role: 'character' },
    { nodeId: 'clothes', role: 'wardrobe' },
  ]);
  const image = script.ensureStoryboardShotNode(node.id, shot.id, 'image');
  image.uploadedFile = { path: '/frame.png', resourceType: 'image' };
  script.setStoryboardGenerationSettings(node.id, { videoInputMode: 'keyframe' });
  const current = script.storyboardShots(node)[0];
  const sources = new Map(script.storyboardShotInputSources(node, current).map((source) => [source.id, source]));
  assert.deepEqual(sources.get('person').via, ['shot', 'row', 'image']);
  assert.equal(sources.get('clothes').role, 'wardrobe');
  assert.deepEqual(sources.get(image.id).via, ['firstFrame']);
});

test('动作板采用独立镜头产出，沿用图片任务，失败可复用原节点重试', { timeout: 3000 }, async () => {
  seed();
  const { desktopApi } = await env.load('services/desktopApi');
  const originalImage = desktopApi.model.imageGeneration;
  const originalDownload = desktopApi.file.downloadUrlToProject;
  const originalSave = desktopApi.file.saveDataUrlToProject;
  const node = script.createStoryboardScriptNode({ x: 0, y: 0 });
  const [first, second] = script.storyboardShots(node);
  script.updateStoryboardShot(node.id, first.id, { plot: '人物起身走向门口', characters: '主角' });
  const image = script.ensureStoryboardShotNode(node.id, first.id, 'image');
  node.storyboardBatch = { id: 'earlier-image-batch', kind: 'image', items: [] };
  let dispatches = 0;
  desktopApi.model.imageGeneration = async ({ prompt }) => {
    assert.match(prompt, /3 列 4 行/);
    assert.match(prompt, /人物起身走向门口/);
    if (++dispatches === 1) throw new Error('本地测试故障');
    return { output_format: 'png', data: [{ b64_json: 'iVBORw0KGgo=' }] };
  };
  desktopApi.file.downloadUrlToProject = async () => ({ filePath: '/local-action-board.png', size: 8 });
  desktopApi.file.saveDataUrlToProject = async () => ({ filePath: '/local-action-board.png', size: 8, mimeType: 'image/png' });
  try {
    await script.runStoryboardShots(node.id, 'actionBoard');
    const failed = script.storyboardBatch(node);
    assert.equal(failed.kind, 'actionBoard');
    assert.deepEqual(failed.items.map((item) => [item.shotId, item.status]), [[first.id, 'failed']]);
    const [row, empty] = script.storyboardShots(node);
    assert.equal(empty.id, second.id);
    assert.equal(empty.actionBoardNodeId, undefined);
    assert.equal(row.imageNodeId, image.id);
    assert.notEqual(row.actionBoardNodeId, image.id);
    assert.equal(script.storyboardBatch(node, 'image').id, 'earlier-image-batch');
    const board = store.project.nodes.find((item) => item.id === row.actionBoardNodeId);
    assert.deepEqual(board.storyboardActionBoard, { columns: 3, rows: 4 });
    assert.equal(board.storyboardShotId, first.id);
    assert.ok(store.project.edges.some((edge) => edge.sourceHandle === `storyboard-out:${first.id}` && edge.target === board.id));
    await script.retryStoryboardBatch(node.id, failed.id, first.id);
    assert.equal(script.storyboardBatch(node).items[0].status, 'completed');
    assert.equal(script.storyboardShots(node)[0].actionBoardNodeId, board.id);
    assert.equal(script.storyboardAssetMedia(board), 'image');
    await script.runStoryboardShots(node.id, 'actionBoard');
    assert.equal(dispatches, 2);
  } finally {
    desktopApi.model.imageGeneration = originalImage;
    desktopApi.file.downloadUrlToProject = originalDownload;
    desktopApi.file.saveDataUrlToProject = originalSave;
  }
});

test('复制分镜节点和产出时重映射关联，略过未复制节点和原任务身份', async () => {
  seed();
  const { remapImportedNodeReferences, addCanvasEdge } = await env.load('store/canvasGraphStore');
  const node = script.createStoryboardScriptNode({ x: 0, y: 0 });
  const [first, second] = script.storyboardShots(node);
  script.setStoryboardShotAssetBindings(node.id, first.id, [{ nodeId: 'clothes', role: 'wardrobe' }, { nodeId: 'person', role: 'character' }]);
  const image = script.ensureStoryboardShotNode(node.id, first.id, 'image');
  const board = script.ensureStoryboardShotNode(node.id, first.id, 'actionBoard');
  node.storyboardBatch = { id: 'original-task', kind: 'actionBoard', items: [] };
  const copy = JSON.parse(JSON.stringify({ ...node, id: 'script-copy' }));
  const copiedBoard = { ...board, id: 'board-copy' };
  const idMap = new Map([[node.id, copy.id], [board.id, copiedBoard.id], ['person', 'person-copy']]);
  remapImportedNodeReferences([copy, copiedBoard], idMap);
  const cloned = script.storyboardShots(copy)[0];
  assert.equal(cloned.id, first.id);
  assert.equal(cloned.imageNodeId, '');
  assert.equal(cloned.actionBoardNodeId, copiedBoard.id);
  assert.deepEqual(cloned.referenceNodeIds, ['person-copy']);
  assert.equal(cloned.assetRoles['person-copy'], 'character');
  assert.equal(copy.storyboardBatch, undefined);
  assert.equal(copiedBoard.storyboardSourceNodeId, copy.id);
  assert.equal(script.storyboardShots(node)[0].imageNodeId, image.id);

  const imported = { nodes: [copy, { id: 'person-copy' }], edges: [] };
  for (const row of [first, second, first]) {
    addCanvasEdge(imported, 'person-copy', copy.id, { touch: false, edge: { targetHandle: `storyboard-in:${row.id}` } });
  }
  assert.equal(imported.edges.length, 2);
});

test('本地模型回执推动拆镜、分镜图、异步视频和成片，保持镜头顺序', { timeout: 6000 }, async () => {
  seed();
  settingsStore.providerConfigs.bfl = { apiKey: 'fixture-key', baseUrl: 'http://127.0.0.1:1' };
  const { desktopApi } = await env.load('services/desktopApi');
  const { subscribeDomain } = await env.load('store/domainReactivity');
  const { mergeCanvasVideos } = await env.load('services/canvasVideoMergeService');
  const { cancelTask } = await env.load('store/taskStore');
  const originalModel = { ...desktopApi.model };
  const originalFile = { ...desktopApi.file };
  const originalTimers = { setInterval: window.setInterval, clearInterval: window.clearInterval };
  window.setInterval = (callback) => setInterval(callback, 10);
  window.clearInterval = (timer) => clearInterval(timer);
  const scriptResult = { shots: [
    { durationSeconds: 5, plot: '晨光照进房间', imagePrompt: '窗前晨光', videoPrompt: '镜头推向窗前' },
    { durationSeconds: 5, plot: '人物来到窗前', imagePrompt: '人物站在窗前', videoPrompt: '人物走向窗户' },
  ] };
  let images = 0;
  let videoSubmissions = 0;
  const receivedPrompts = [];
  desktopApi.model.chatCompletion = async () => ({ choices: [{ message: { content: JSON.stringify(scriptResult) } }] });
  desktopApi.model.imageGeneration = async () => {
    images += 1;
    return { output_format: 'png', data: [{ b64_json: 'iVBORw0KGgo=' }] };
  };
  desktopApi.model.videoGeneration = async ({ prompt }) => {
    receivedPrompts.push(prompt);
    return { id: `video-${++videoSubmissions}` };
  };
  desktopApi.model.videoTask = async ({ taskId }) => ({
    id: taskId, status: 'Ready', result: { sample: `https://fixture.invalid/${taskId}.mp4` },
  });
  desktopApi.file.saveDataUrlToProject = async (_data, title) => ({ filePath: `/fixtures/${title}`, size: 8 });
  desktopApi.file.downloadUrlToProject = async (url, title) => ({ filePath: `/fixtures/${url.startsWith('data:') ? title : new URL(url).pathname.slice(1)}`, size: 8 });
  desktopApi.file.concatVideos = async (paths) => {
    assert.deepEqual(paths, ['/fixtures/video-1.mp4', '/fixtures/video-2.mp4']);
    return { filePath: '/fixtures/final.mp4', name: 'final.mp4', size: 16 };
  };
  try {
    const node = script.createStoryboardScriptNode({ x: 0, y: 0 });
    node.prompt = '一个清晨，人物来到窗前。';
    const savedNode = store.project.nodes.find((item) => item.id === node.id);
    const textTask = script.runStoryboardScriptGeneration(node.id);
    assert.ok(textTask);
    await new Promise((resolve) => {
      function check() {
        if (['completed', 'failed', 'error', 'cancelled'].includes(textTask.status)) {
          unsubscribe();
          resolve();
        }
      }
      const unsubscribe = subscribeDomain(check);
      check();
    });
    assert.equal(textTask.status, 'completed', textTask.error);
    assert.deepEqual(script.storyboardShots(savedNode).map((shot) => shot.videoPrompt), scriptResult.shots.map((shot) => shot.videoPrompt));
    await script.runStoryboardShots(node.id, 'image');
    assert.equal(images, 2);
    assert.ok(script.storyboardBatch(savedNode, 'image').items.every((item) => item.status === 'completed'));
    for (const shot of script.storyboardShots(savedNode)) {
      const video = script.ensureStoryboardShotNode(node.id, shot.id, 'video');
      video.model = 'flux-3-video';
    }
    await script.runStoryboardShots(node.id, 'video');
    assert.deepEqual(receivedPrompts, scriptResult.shots.map((shot) => shot.videoPrompt));
    const ready = script.storyboardReadyVideos(script.storyboardShots(savedNode));
    assert.deepEqual(ready.map((source) => source.shotNumber), [1, 2]);
    const final = await mergeCanvasVideos(ready, node.id);
    assert.equal(final.id, script.storyboardFinalVideo(node.id).id);
  } finally {
    for (const task of store.project.tasks) cancelTask(task.id);
    Object.assign(window, originalTimers);
    Object.assign(desktopApi.model, originalModel);
    Object.assign(desktopApi.file, originalFile);
  }
});

test('拆镜输入的 @ 设定按真实节点展开，避免重复发送或使用已断开的设定', async () => {
  seed();
  const { buildGenerationPayload, generationUpstreamReadiness } = await env.load('domain/graph/generationPayload');
  const node = script.createStoryboardScriptNode({ x: 0, y: 0 });
  store.project.nodes.push(
    { id: 'context-a', type: 'textGeneration', title: '设定.甲', textContent: '第一份设定包含 $& 和 @设定.甲-2。' },
    { id: 'context-b', type: 'textGeneration', title: '设定.甲', textContent: '第二份设定正文。' },
    { id: 'unlinked', type: 'textGeneration', title: '未连接设定', textContent: '不应进入请求。' },
  );
  assert.equal(script.connectStoryboardContext('context-a', node.id), true);
  assert.equal(script.connectStoryboardContext('context-b', node.id), true);
  assert.deepEqual(script.storyboardContextReferences(node.id).map((item) => item.id), ['context-a', 'context-b']);
  node.prompt = '开场 @设';
  script.insertStoryboardContextMention(node.id, 'context-a', 3, 5);
  script.insertStoryboardContextMention(node.id, 'context-b', node.prompt.length, node.prompt.length);
  assert.equal(node.prompt, '开场 @设定.甲 @设定.甲-2 ');
  assert.equal(generationUpstreamReadiness(node, store.project).ready, true);
  const request = buildGenerationPayload(node, store.project);
  assert.match(request.prompt, /【项目设定：设定\.甲】\n第一份设定包含 \$& 和 @设定\.甲-2。/u);
  assert.equal(request.prompt.split('第二份设定正文。').length, 2);
  assert.doesNotMatch(request.prompt, /不应进入请求/u);
  store.project.edges = store.project.edges.filter((edge) => edge.source !== 'context-b');
  assert.equal(generationUpstreamReadiness(node, store.project).ready, false);
  assert.equal(script.insertStoryboardContextMention(node.id, 'context-b', 0, 0), null);
});
