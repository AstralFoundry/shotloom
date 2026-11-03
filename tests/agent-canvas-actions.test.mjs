/**
 * 画布动作只有一个落地入口：执行器负责批次、引用解析与事务，动作实现只读上下文里的项目。
 * 这里跑真实执行器，验证持久化结构、局部失败语义和 tempId 幂等，而不是逐层调用内部函数。
 */
import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

let env;
let projectStore;
let normalization;
let settings;
let catalog;
let history;
let executor;
let identity;

before(async () => {
  env = await createRendererEnv({ storage: new Map(), withWindow: true });
  projectStore = await env.load('store/projectStore');
  normalization = await env.load('store/projectNormalization');
  settings = await env.load('store/settingsStore');
  catalog = await env.load('domain/catalog/ModelCatalog');
  history = await env.load('store/canvasHistoryStore');
  identity = await env.load('services/agentProjectIdentity');
  executor = await env.load('services/agent/agentCanvasExecutor');
});

after(async () => {
  await env?.dispose();
});

/** 按目录真实能力挑模型，测试不写死厂商模型名。 */
function modelFor(type, accepts) {
  const modelId = catalog.getModelIdsByType(type).find((id) => {
    if (!accepts) return true;
    return catalog.getGenerationInputModes(id).some(accepts);
  });
  if (!modelId) throw new Error(`模型目录里没有满足条件的 ${type} 模型`);
  const providerId = catalog.getModelInfo(modelId)?.provider;
  settings.settingsStore.providerConfigs = {
    ...settings.settingsStore.providerConfigs,
    [providerId]: { apiKey: 'sk-test' },
  };
  return modelId;
}

function resetProject(name = '画布动作测试项目') {
  projectStore.store.project = normalization.createProject(name);
  return projectStore.store.project;
}

function run(actions, extra = {}) {
  const current = identity.getAgentProjectIdentity();
  return executor.executeAgentActions({
    actions,
    projectKey: current.projectKey,
    projectInstanceId: current.instanceId,
    projectGeneration: current.generation,
    ...extra,
  });
}

test('create_gen_node 的 inputLinks 与 connect_nodes 写出同一套输入边语义', async () => {
  resetProject();
  const textModel = modelFor('textGeneration');
  const imageModel = modelFor('imageGeneration', (mode) => mode.maxImages > 0);
  const created = await run([
    { type: 'create_gen_node', tempId: 'script-1', nodeType: 'textGeneration', model: textModel, prompt: '第一幕：雨夜取车' },
    {
      type: 'create_gen_node',
      tempId: 'shot-1',
      nodeType: 'imageGeneration',
      model: imageModel,
      prompt: '雨夜街边的红色汽车',
      inputLinks: [{ nodeId: 'script-1' }],
    },
  ]);
  assert.equal(created.appliedCount, 2, created.error);
  const project = projectStore.store.project;
  assert.equal(project.nodes.length, 2);
  assert.equal(project.edges.length, 1);
  const edge = project.edges[0];
  assert.equal(edge.data.inputRole, 'textContext');
  assert.equal(edge.data.inputSlot, undefined);
  assert.equal(edge.source, created.tempIdMap['script-1']);
  assert.equal(edge.target, created.tempIdMap['shot-1']);

  // 图片→视频是引用输入：角色、槽位与节点输入模式必须一起写入。
  const videoModel = modelFor('videoGeneration', (mode) => mode.maxImages > 0);
  const connected = await run([
    { type: 'create_gen_node', tempId: 'shot-2', nodeType: 'videoGeneration', model: videoModel, prompt: '汽车驶出画面' },
    { type: 'connect_nodes', source: 'shot-1', target: 'shot-2', role: 'referenceImage' },
  ]);
  assert.equal(connected.appliedCount, 2, connected.error);
  const videoNode = project.nodes.find((node) => node.id === connected.tempIdMap['shot-2']);
  const mediaEdge = project.edges.find((item) => item.target === videoNode.id);
  assert.equal(mediaEdge.data.inputRole, 'referenceImage');
  assert.ok(mediaEdge.data.inputSlot);
  assert.equal(videoNode.inputMode, catalog.getGenerationInputModes(videoModel)[0].value);
  const referenceResult = connected.actionResults.find((item) => item.type === 'connect_nodes');
  assert.equal(referenceResult.applied, true);
  assert.equal(referenceResult.edgeId, mediaEdge.id);
});

test('同一个 tempId 重放不会复制节点', async () => {
  resetProject();
  const imageModel = modelFor('imageGeneration');
  const action = {
    type: 'create_gen_node', tempId: 'shot-1', nodeType: 'imageGeneration',
    model: imageModel, prompt: '雨夜街边的红色汽车',
  };
  const first = await run([action]);
  const second = await run([action]);
  assert.equal(projectStore.store.project.nodes.length, 1);
  assert.equal(first.createdNodeIds.length, 1);
  assert.equal(second.actionResults[0].deduplicated, true);
  assert.equal(second.actionResults[0].nodeId, first.createdNodeIds[0]);
});

test('无效动作只跳过自己，其余动作保留', async () => {
  resetProject();
  const imageModel = modelFor('imageGeneration');
  const result = await run([
    { type: 'create_gen_node', tempId: 'ok-1', nodeType: 'imageGeneration', model: imageModel, prompt: '可用的镜头' },
    { type: 'create_gen_node', tempId: 'bad-1', nodeType: 'imageGeneration', model: imageModel, prompt: '镜头', config: { prompt: '提示词不能放在 config' } },
    { type: 'move_node', nodeId: 'missing-node', x: 100, y: 100 },
  ]);
  assert.equal(result.appliedCount, 1);
  assert.equal(result.skippedCount, 2);
  assert.equal(result.complete, false);
  assert.equal(result.partial, true);
  assert.equal(projectStore.store.project.nodes.length, 1);
  const skipped = result.actionResults.filter((item) => !item.applied);
  assert.equal(skipped.length, 2);
  assert.match(skipped[0].error, /config/);
  assert.match(skipped[1].error, /不存在/);
});

test('启动生成前必须有真实提示词，缺失时不创建任务', async () => {
  const project = resetProject();
  const imageModel = modelFor('imageGeneration');
  project.nodes.push({ id: 'empty-node', type: 'imageGeneration', model: imageModel, prompt: '', x: 0, y: 0 });
  const result = await run([{ type: 'start_generation', nodeId: 'empty-node' }]);
  assert.equal(result.appliedCount, 0);
  assert.equal(result.skippedCount, 1);
  assert.match(result.actionResults[0].error, /prompt/);
  assert.equal(project.tasks.length, 0);
});

test('移动、禁用与删除连线都写回真实画布并可撤销', async () => {
  resetProject();
  const textModel = modelFor('textGeneration');
  const imageModel = modelFor('imageGeneration');
  const created = await run([
    { type: 'create_gen_node', tempId: 'script-1', nodeType: 'textGeneration', model: textModel, prompt: '第一幕' },
    { type: 'create_gen_node', tempId: 'shot-1', nodeType: 'imageGeneration', model: imageModel, prompt: '镜头', inputLinks: [{ nodeId: 'script-1' }] },
  ]);
  const project = projectStore.store.project;
  const shotId = created.tempIdMap['shot-1'];
  const edgeId = project.edges[0].id;

  const edited = await run([
    { type: 'move_node', nodeId: shotId, position: { x: 640, y: 220 } },
    { type: 'toggle_edge', edgeId, enabled: false },
  ]);
  assert.equal(edited.appliedCount, 2, edited.error);
  assert.equal(project.nodes.find((node) => node.id === shotId).x, 640);
  assert.equal(project.edges.find((edge) => edge.id === edgeId).enabled, false);

  const removed = await run([{ type: 'delete_edge', edgeId }]);
  assert.equal(removed.appliedCount, 1);
  assert.equal(project.edges.length, 0);

  // 批次写必须进画布历史，用户才能撤销整批 Agent 改动。
  assert.equal(history.canUndoCanvas.value, true);
  assert.equal(history.undoCanvas(), true);
  assert.equal(project.edges.length, 1);
  assert.equal(history.undoCanvas(), true);
  assert.notEqual(project.nodes.find((node) => node.id === shotId).x, 640);
  assert.notEqual(project.edges.find((edge) => edge.id === edgeId).enabled, false);

  const deleted = await run([{ type: 'delete_node', nodeId: shotId }]);
  assert.equal(deleted.appliedCount, 1, JSON.stringify(deleted.actionResults));
  assert.equal(project.nodes.length, 1);
  assert.equal(project.edges.length, 0);
});
