/**
 * 新建节点的默认模型：工程设置要生效；默认模型没有凭据时退回已配置的模型。
 */
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readSource } from './helpers/sourceContract.mjs';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

let env;
let nodeStore;
let store;
let settingsStore;
let normalization;
let availability;

before(async () => {
  env = await createRendererEnv({ storage: new Map(), withWindow: true });
  nodeStore = await env.load('store/nodeStore');
  ({ store } = await env.load('store/projectStore'));
  ({ settingsStore } = await env.load('store/settingsStore'));
  normalization = await env.load('store/projectNormalization');
  availability = await env.load('domain/provider/ModelAvailability');
});

beforeEach(() => {
  store.project = {
    ...normalization.createProject(),
    id: 'project-default-model',
    nodes: [],
    edges: [],
    tasks: [],
  };
  settingsStore.providerConfigs = {};
});

after(async () => {
  await env?.dispose();
});

function configureStarrouter() {
  settingsStore.providerConfigs = {
    starrouter: { apiKey: 'test-key', baseUrl: 'https://api.starrouter.ai' },
  };
}

test('工程默认模型生效：选了 StarRouter 图片模型，新建图片节点就用它', () => {
  configureStarrouter();
  store.project.settings.defaultImageModel = 'starrouter-gpt-image-2.6-sunburst';

  const node = nodeStore.addNode('imageGeneration');
  assert.equal(node.model, 'starrouter-gpt-image-2.6-sunburst');
});

test('默认模型没有凭据时退回已配置厂商的模型，不再落到 OpenAI', () => {
  configureStarrouter();
  // 目录默认值是 OpenAI 系；用户没配 OpenAI 时不应该继续用它。
  store.project.settings.defaultImageModel = 'gpt-image-2.6-sunburst';

  const node = nodeStore.addNode('imageGeneration');
  assert.notEqual(node.model, 'gpt-image-2.6-sunburst');
  assert.ok(String(node.model).startsWith('starrouter-'), `实际模型：${node.model}`);
  assert.equal(availability.getModelCredentialStatus(node.model, settingsStore.providerConfigs).available, true);
});

test('完全没有配置厂商时保留默认模型，提示用户去配置而不是静默换一个', () => {
  store.project.settings.defaultImageModel = 'gpt-image-2.6-sunburst';
  const node = nodeStore.addNode('imageGeneration');
  assert.equal(node.model, 'gpt-image-2.6-sunburst');
});

test('设置默认模型会触达自动保存，而不只写会话缓存', () => {
  const settingsFeature = readSource('renderer/src/app/views/SettingsFeature.tsx');
  assert.match(settingsFeature, /setProjectModel: \(key, value\) => \{[\s\S]*?touchProject\(\)/);
  assert.doesNotMatch(settingsFeature, /setProjectModel: \(key, value\) => \{[\s\S]{0,120}persistSession\(\)/);
});
