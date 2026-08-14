import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { clonePlainData } from '../renderer/src/utils/plainDataClone.mjs';

let server;
let buildCustomCatalogModels;
let getModelInfo;
let setExternalCatalogModels;

before(async () => {
  server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  ({ buildCustomCatalogModels } = await server.ssrLoadModule('/src/domain/provider/CustomModelCatalog.ts'));
  ({ getModelInfo, setExternalCatalogModels } = await server.ssrLoadModule('/src/domain/catalog/ModelCatalog.ts'));
});

after(async () => {
  setExternalCatalogModels?.([]);
  await server?.close();
});

test('自定义厂商的响应式配置可以转为持久化普通数据', () => {
  const model = new Proxy({
    id: 'custom-image-model',
    name: 'Custom Image Model',
    type: 'imageGeneration',
    defaultMode: 'generate',
    modes: [new Proxy({
      id: 'generate',
      endpoint: { path: '/images/generations', method: 'POST' },
      requestTemplate: { model: '{{model}}', prompt: '{{prompt}}' },
      outputConstraints: {},
      params: [],
    }, {})],
  }, {});
  const providerConfigs = new Proxy({
    custom: new Proxy({ apiKey: 'test-key', baseUrl: 'https://example.com/v1', models: [model] }, {}),
  }, {});

  assert.throws(() => structuredClone(providerConfigs), /clone/i);
  const plain = clonePlainData(providerConfigs);
  assert.doesNotThrow(() => structuredClone(plain));
  assert.notEqual(plain.custom.models[0], model);
});

test('自定义厂商目录可直接接收响应式模型配置', () => {
  const model = new Proxy({
    id: 'custom-chat-model',
    name: 'Custom Chat Model',
    provider: 'ignored-provider',
    type: 'textGeneration',
    defaultMode: 'chat',
    modes: [new Proxy({
      id: 'chat',
      endpoint: { path: '/chat/completions', method: 'POST' },
      requestTemplate: { model: '{{model}}', messages: '{{messages}}' },
      outputConstraints: { supportsToolCalls: false },
      params: [],
    }, {})],
  }, {});
  const configs = new Proxy({
    myProvider: new Proxy({ models: [model] }, {}),
  }, {});

  const catalog = buildCustomCatalogModels(configs);
  assert.equal(catalog.length, 1);
  assert.equal(catalog[0].provider, 'myProvider');
  assert.equal(catalog[0].id, 'custom-chat-model');
  assert.notEqual(catalog[0].modes[0], model.modes[0]);
  assert.doesNotThrow(() => structuredClone(catalog));
});

test('跨厂商复用内置模型 ID 时使用自定义厂商路由', () => {
  const configs = {
    startrouter: {
      models: [{
        id: 'deepseek-v4-pro',
        name: 'DeepSeek V4 Pro via StarRouter',
        provider: 'startrouter',
        type: 'textGeneration',
        defaultMode: 'text-generation',
        enabled: true,
        modes: [{
          id: 'text-generation',
          endpoint: { path: '/chat/completions', method: 'POST' },
          requestTemplate: { model: '{{model}}', messages: '{{messages}}' },
          outputConstraints: { supportsToolCalls: true },
          params: [],
        }],
      }],
    },
  };

  setExternalCatalogModels(buildCustomCatalogModels(configs));
  assert.equal(getModelInfo('deepseek-v4-pro').provider, 'startrouter');
});
