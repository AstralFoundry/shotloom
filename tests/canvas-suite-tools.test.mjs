import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

let env, tools, projects, normalization, settings, identity, sessions;
before(async () => {
  env = await createRendererEnv({ storage: new Map(), withWindow: true });
  projects = await env.load('store/projectStore');
  normalization = await env.load('store/projectNormalization');
  settings = (await env.load('store/settingsStore')).settingsStore;
  identity = await env.load('services/agentProjectIdentity');
  sessions = await env.load('services/harnessSessionStore');
  tools = await env.load('services/harnessProductTools');
});
after(async () => { await env?.dispose(); });

function fixture() {
  projects.store.project = normalization.createProject('Canvas suite tools');
  projects.store.projectDir = '/canvas-suite-project';
  projects.store.filePath = '/canvas-suite-project/project.shotloom.json';
  settings.agentApprovalPolicy = 'ask';
  settings.agentCanRunNodes = false;
  const conversation = sessions.createHarnessSession(projects.store.project, { agentId: 'canvas-primary' });
  const binding = { sessionId: crypto.randomUUID(), projectKey: identity.getAgentProjectKey(), conversationId: conversation.id, agentId: 'canvas-primary' };
  tools.productToolCatalog(binding);
  tools.bindProductSession(binding);
  return binding;
}

function request(binding, toolName, input = {}, extra = {}) {
  return { requestId: crypto.randomUUID(), binding, toolName, input, ...extra };
}

test('画布 Agent 可以创建、读取并更新分镜脚本与批量表节点', async () => {
  const binding = fixture();
  const created = await tools.executeProductRequest(request(binding, 'canvas_storyboard', {
    action: 'create',
    title: '雨夜',
    source: '女主在便利店门口躲雨',
    shotCount: 3,
    shotDuration: 5,
    shots: [{ plot: '女主站在屋檐下', videoPrompt: '雨丝落下' }],
  }, { approvedByHarness: true }));
  assert.equal(created.result.success, true);
  const nodeId = created.result.nodeId;
  assert.equal(created.result.rows.length, 1);
  const firstShot = created.result.rows[0];
  const nodeInProject = projects.store.project.nodes.find((node) => node.id === nodeId);
  nodeInProject.storyboardShots[0].imageNodeId = 'existing-image';
  const updated = await tools.executeProductRequest(request(binding, 'canvas_storyboard', {
    action: 'update', nodeId,
    shots: [
      { id: firstShot.id, plot: '屋檐下', videoPrompt: '雨丝落下', dialogue: '等等' },
      { plot: '街角', videoPrompt: '横移', durationSeconds: 6 },
    ],
  }, { approvedByHarness: true }));
  assert.equal(updated.result.rows[0].imageNodeId, 'existing-image', '整表更新保留已有产出节点');
  assert.equal(updated.result.rows.length, 2);
  assert.equal(updated.result.totalDuration, 10);
  const read = await tools.executeProductRequest(request(binding, 'canvas_get_storyboard', { nodeId }));
  assert.equal(read.result.rows[1].dialogue, '');
  assert.match(read.result.rows[1].videoPrompt, /横移/);
  const batch = await tools.executeProductRequest(request(binding, 'canvas_batch_table', {
    action: 'create', title: '换装批次', operation: 'try_on', columnCount: 2,
    rows: [{ prompt: '参考图1人物穿参考图2服装' }],
  }, { approvedByHarness: true }));
  assert.equal(batch.result.success, true);
  assert.equal(batch.result.concurrency, 5);
  assert.equal(batch.result.columns.length, 2);
  const batchId = batch.result.nodeId;
  const batchRead = await tools.executeProductRequest(request(binding, 'canvas_get_batch_table', { nodeId: batchId }));
  assert.equal(batchRead.result.rows.length, 1);
  const batchUpdate = await tools.executeProductRequest(request(binding, 'canvas_batch_table', {
    action: 'update', nodeId: batchId, operation: 'creative', globalPrompt: '统一冷色',
    rows: [{ prompt: '第二行' }, { prompt: '第三行', enabled: false }],
  }, { approvedByHarness: true }));
  assert.equal(batchUpdate.result.operation, 'creative');
  assert.equal(batchUpdate.result.rows.length, 2);
  assert.equal(batchUpdate.result.globalPrompt, '统一冷色');
});

test('分镜行同样拒绝不存在的参考图，并回滚创建', async () => {
  const binding = fixture();
  const created = await tools.executeProductRequest(request(binding, 'canvas_storyboard', {
    action: 'create', source: '画面', shots: [{ plot: '镜头', referenceNodeIds: ['missing-image'] }],
  }, { approvedByHarness: true }));
  assert.equal(created.result.success, false);
  assert.match(created.result.error, /missing-image/);
  assert.equal(projects.store.project.nodes.some((node) => node.canvasView === 'storyboard-script'), false);
});

test('批量表拒绝引用不存在的图片节点，生成工具遵守运行节点开关', async () => {
  const binding = fixture();
  const created = await tools.executeProductRequest(request(binding, 'canvas_batch_table', {
    action: 'create', operation: 'creative', rows: [{ prompt: '画面', referenceNodeIds: ['missing-image'] }],
  }, { approvedByHarness: true }));
  assert.equal(created.result.success, false);
  assert.match(created.result.error, /missing-image/);
  assert.equal(projects.store.project.nodes.some((node) => node.type === 'batchTable'), false);

  const storyboard = await tools.executeProductRequest(request(binding, 'canvas_storyboard', {
    action: 'create', source: '一个镜头', shots: [{ plot: '画面' }],
  }, { approvedByHarness: true }));
  await assert.rejects(
    tools.executeProductRequest(request(binding, 'canvas_generate_storyboard', { nodeId: storyboard.result.nodeId, kind: 'script' }, { approvedByHarness: true })),
    /Unknown or unavailable Agent tool/,
    '关闭允许 Agent 运行节点后生成工具不可用',
  );
  settings.agentCanRunNodes = true;
  const visible = tools.productToolCatalog(binding).filter((tool) => tool.name === 'canvas_generate_storyboard');
  assert.equal(visible.length, 1);
  const denied = await tools.executeProductRequest(request(binding, 'canvas_generate_storyboard', { nodeId: storyboard.result.nodeId, kind: 'script' }, { approvedByHarness: true }));
  assert.equal(denied.result.success, false, '没有可用文本模型时不会假装启动任务');
});
