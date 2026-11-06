/**
 * 打光 / 多角度的模型选择：源图不能收参考图时，派生节点改用已配置且支持参考图的模型。
 */
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

let env;
let store;
let settingsStore;
let normalization;
let applyImageRecipe;

before(async () => {
  env = await createRendererEnv({ storage: new Map(), withWindow: true });
  ({ store } = await env.load('store/projectStore'));
  ({ settingsStore } = await env.load('store/settingsStore'));
  normalization = await env.load('store/projectNormalization');
  ({ applyImageRecipe } = await env.load('app/adapters/canvas/imageRecipeActions'));
});

beforeEach(() => {
  store.project = {
    ...normalization.createProject(),
    id: 'project-recipe-model',
    nodes: [{
      id: 'source-image', type: 'imageGeneration', title: '参考图',
      model: 'qwen-image-3.0-pro', x: 0, y: 0, width: 320, height: 320,
      status: 'completed', prompt: '原提示词',
    }],
    edges: [],
    tasks: [],
  };
});

after(async () => {
  await env?.dispose();
});

const ANGLE_PARAMS = { horizontalAngle: 90, pitchAngle: 0, cameraDistance: 2.4, wideAngle: true };

test('源图模型只支持文生图时，派生节点改用已配置且支持参考图的模型', () => {
  settingsStore.providerConfigs = {
    openai: { apiKey: 'openai-key', baseUrl: 'https://api.openai.com/v1' },
    qwen: { apiKey: 'qwen-key', baseUrl: 'https://dashscope.aliyuncs.com' },
  };

  assert.equal(applyImageRecipe('source-image', 'angle', ANGLE_PARAMS), true);
  assert.equal(store.project.nodes.length, 2);
  const derived = store.project.nodes[1];
  assert.equal(derived.model, 'gpt-image-2.6-sunburst');
  assert.equal(derived.imageRecipe.kind, 'angle');
});

test('没有任何支持参考图的模型时明确拒绝，而不是派生出必然失败的节点', () => {
  settingsStore.providerConfigs = {
    qwen: { apiKey: 'qwen-key', baseUrl: 'https://dashscope.aliyuncs.com' },
  };

  assert.equal(applyImageRecipe('source-image', 'angle', ANGLE_PARAMS), false);
  assert.equal(store.project.nodes.length, 1);
  assert.equal(store.project.edges.length, 0);
});

test('源图模型本身支持参考图时沿用源模型，不无故换厂商', () => {
  store.project.nodes[0].model = 'gemini-3-pro-image';
  settingsStore.providerConfigs = {
    google: { apiKey: 'google-key', baseUrl: 'https://generativelanguage.googleapis.com' },
    openai: { apiKey: 'openai-key', baseUrl: 'https://api.openai.com/v1' },
  };

  assert.equal(applyImageRecipe('source-image', 'angle', ANGLE_PARAMS), true);
  assert.equal(store.project.nodes[1].model, 'gemini-3-pro-image');
});

test('就地重跑时源模型不支持参考图则拒绝，不静默改模型', () => {
  settingsStore.providerConfigs = {
    openai: { apiKey: 'openai-key', baseUrl: 'https://api.openai.com/v1' },
  };
  store.project.nodes[0].imageRecipe = { version: 1, kind: 'angle', params: ANGLE_PARAMS };

  assert.equal(applyImageRecipe('source-image', 'angle', ANGLE_PARAMS), false);
  assert.equal(store.project.nodes[0].model, 'qwen-image-3.0-pro');
});
