/**
 * 存量节点模型修复：切到已配置可用模型，且保留参考图与输入方式要求。
 */
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

let env;
let repair;
let store;
let settingsStore;
let normalization;

before(async () => {
  env = await createRendererEnv({ storage: new Map(), withWindow: true });
  repair = await env.load('services/nodeModelRepairService');
  ({ store } = await env.load('store/projectStore'));
  ({ settingsStore } = await env.load('store/settingsStore'));
  normalization = await env.load('store/projectNormalization');
});

beforeEach(() => {
  store.project = {
    ...normalization.createProject(),
    id: 'project-repair',
    nodes: [
      { id: 'img', type: 'imageGeneration', model: 'gpt-image-2.6-sunburst', inputMode: 'image-to-image', imageRecipe: { kind: 'angle' } },
      { id: 'img2', type: 'imageGeneration', model: 'gpt-image-2.6-sunburst', inputMode: 'text-to-image' },
      { id: 'vid', type: 'videoGeneration', model: 'grok-imagine-video-1.5' },
    ],
    edges: [],
    tasks: [],
  };
  settingsStore.providerConfigs = {
    starrouter: { apiKey: 'k', baseUrl: 'https://api.starrouter.ai' },
  };
});

after(async () => {
  await env?.dispose();
});

test('把无凭据的图片节点切到已配置且支持参考图的模型', () => {
  const result = repair.repairUnconfiguredNodeModels();
  const image = store.project.nodes.find((node) => node.id === 'img');
  assert.ok(String(image.model).startsWith('starrouter-'), `实际：${image.model}`);
  assert.ok(result.repaired.some((item) => item.nodeId === 'img'));
  // 带 imageRecipe 的节点必须保留可参考图的输入方式。
  assert.notEqual(image.inputMode, 'text-to-image');
});

test('普通图片节点与视频节点也会切到可用模型', () => {
  repair.repairUnconfiguredNodeModels();
  const image2 = store.project.nodes.find((node) => node.id === 'img2');
  const video = store.project.nodes.find((node) => node.id === 'vid');
  assert.ok(String(image2.model).startsWith('starrouter-'));
  assert.ok(String(video.model).startsWith('starrouter-'), `实际：${video.model}`);
});

test('已有可用模型时不动，也不产生撤销记录', () => {
  store.project.nodes = [{ id: 'ok', type: 'imageGeneration', model: 'starrouter-gpt-image-2.6-sunburst', inputMode: 'reference' }];
  const historyBefore = JSON.stringify(store.project.canvasHistory || []);
  const result = repair.repairUnconfiguredNodeModels();
  // 已可用的节点不进入 repaired，也不进入 skipped（skipped 只表示修复失败）。
  assert.deepEqual(result, { repaired: [], skipped: [] });
  assert.equal(JSON.stringify(store.project.canvasHistory || []), historyBefore);
});

test('一个可用模型都没有时不乱改，报告原因', () => {
  settingsStore.providerConfigs = {};
  store.project.nodes = [{ id: 'stuck', type: 'imageGeneration', model: 'gpt-image-2.6-sunburst' }];
  const result = repair.repairUnconfiguredNodeModels();
  assert.deepEqual(result.repaired, []);
  assert.deepEqual(result.skipped, [{ nodeId: 'stuck', reason: 'no-available-model' }]);
  assert.equal(store.project.nodes[0].model, 'gpt-image-2.6-sunburst');
});

test('设置页入口：调用真实修复服务并回报结果', async () => {
  const { readSource } = await import('./helpers/sourceContract.mjs');
  const panel = readSource('renderer/src/app/views/SettingsPanel.tsx');
  const feature = readSource('renderer/src/app/views/SettingsFeature.tsx');
  assert.match(panel, /repairNodeModels: \(\) => void \| Promise<void>/);
  assert.match(panel, /controller\.repairNodeModels\(\)/);
  assert.match(feature, /repairUnconfiguredNodeModels\(\)/);
  assert.match(feature, /settings\.repairNodeModels\.done/);
});
