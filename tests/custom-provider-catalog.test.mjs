import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { clonePlainData } from '../renderer/src/utils/plainDataClone.mjs';

let server;
let buildCustomCatalogModels;
let findDuplicateCustomModelIds;
let catalogModelValidationErrors;
let getModelInfo;
let getModelInputCapability;
let setExternalCatalogModels;
let desktopApi;
let buildRuntimeContractForModel;
let getProviderTransport;

before(async () => {
  server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  ({ buildCustomCatalogModels, findDuplicateCustomModelIds } = await server.ssrLoadModule('/src/domain/provider/CustomModelCatalog.ts'));
  ({ catalogModelValidationErrors, getModelInfo, getModelInputCapability, setExternalCatalogModels, buildRuntimeContractForModel } = await server.ssrLoadModule('/src/domain/catalog/ModelCatalog.ts'));
  ({ desktopApi } = await server.ssrLoadModule('/src/services/desktopApi.js'));
  ({ getProviderTransport } = await server.ssrLoadModule('/src/domain/provider/TransportRegistry.ts'));
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
      endpoint: { path: '/chat/completions', method: 'POST', scope: 'root' },
      requestTemplate: { model: '{{model}}', messages: '{{messages}}' },
      resultTextPath: 'choices.0.message.content',
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
          endpoint: { path: '/chat/completions', method: 'POST', scope: 'root' },
          requestTemplate: { model: '{{model}}', messages: '{{messages}}' },
          resultTextPath: 'choices.0.message.content',
          outputConstraints: { supportsToolCalls: true },
          params: [],
        }],
      }],
    },
  };

  setExternalCatalogModels(buildCustomCatalogModels(configs));
  assert.equal(getModelInfo('deepseek-v4-pro').provider, 'startrouter');
});

test('跨自定义厂商的模型 ID 冲突会被保存边界识别', () => {
  const model = (provider) => ({
    id: 'shared-model', name: provider, provider, type: 'textGeneration',
    defaultMode: 'text-generation', enabled: true,
    modes: [{
      id: 'text-generation', endpoint: { path: '/chat', method: 'POST', scope: 'root' },
      requestTemplate: { prompt: '{{prompt}}' }, resultTextPath: 'text',
    }],
  });
  const duplicates = findDuplicateCustomModelIds({
    alpha: { models: [model('alpha')] },
    beta: { models: [model('beta')] },
  });
  assert.deepEqual(duplicates, [{ modelId: 'shared-model', providers: ['alpha', 'beta'] }]);
});

test('外部 inputVariants 缺少槽位时在保存前返回具体错误', () => {
  const errors = catalogModelValidationErrors({
    id: 'broken-video', name: 'Broken Video', provider: 'custom', type: 'videoGeneration',
    defaultMode: 'generate',
    modes: [{
      id: 'generate', endpoint: { path: '/generate', method: 'POST', scope: 'root' },
      requestTemplate: { prompt: '{{prompt}}' }, resultUrlPath: 'result.url',
      inputVariants: [{ inputMode: 'firstLastFrame', inputConstraints: { images: { min: 2, max: 2 } } }],
    }],
  }, { requireProvider: true });
  assert.ok(errors.some((error) => error.includes('缺少 inputSlots')));
});

test('自定义图片值格式会进入运行时能力契约', () => {
  setExternalCatalogModels([{
    id: 'http-image-input', name: 'HTTP Image Input', provider: 'custom', type: 'imageGeneration',
    defaultMode: 'edit', enabled: true,
    modes: [{
      id: 'edit', endpoint: { path: '/edit', method: 'POST', scope: 'root' },
      requestTemplate: { image: '{{imageUrl}}' }, resultUrlPath: 'result.url',
      imageValueFormat: 'http-url', referenceImageFormat: 'url',
      inputConstraints: { images: { min: 1, max: 1, roles: ['referenceImage'] } },
    }],
  }]);
  const capability = getModelInputCapability('imageGeneration', 'http-image-input', 'edit');
  assert.equal(capability.imageValueFormat, 'http-url');
  assert.equal(capability.referenceImageFormat, 'url');
});

test('角色误写到输入槽位时规范化协议而不回退到同名内置模型', () => {
  setExternalCatalogModels([{
    id: 'gpt-image-2', name: 'GPT Image 2 via Router', provider: 'startrouter',
    type: 'imageGeneration', defaultMode: 'reference-to-image', enabled: true,
    overridesBuiltIn: true,
    modes: [{
      id: 'reference-to-image', inputMode: 'reference', inputSlots: ['referenceImage'],
      endpoint: { path: '/v1/images/edits', method: 'POST', scope: 'root' },
      requestTemplate: { image: '{{imageUrl}}' }, resultUrlPath: 'data.*.url',
      inputConstraints: { images: { min: 1, roles: ['referenceImage'] } },
    }],
  }]);

  assert.equal(getModelInfo('gpt-image-2').provider, 'startrouter');
  const capability = getModelInputCapability('imageGeneration', 'gpt-image-2', 'reference-to-image');
  assert.equal(capability.maxInputImages, 1);
});

test('自定义 multipart 图片端点不依赖路径关键词且保留文件字段', async () => {
  let submitted;
  let chatCalled = false;
  desktopApi.model.imageGeneration = async (body) => {
    submitted = body;
    return { result: { url: 'https://example.com/result.png' } };
  };
  desktopApi.model.chatCompletion = async () => {
    chatCalled = true;
    throw new Error('不应路由到文本请求');
  };
  const model = {
    id: 'custom-edit', name: 'Custom Edit', provider: 'custom', type: 'imageGeneration',
    defaultMode: 'edit', enabled: true,
    modes: [{
      id: 'edit', endpoint: { path: '/v1/generate', method: 'POST', scope: 'root' },
      inputFormat: 'multipart', requestFields: { multipartImage: 'source' },
      requestTemplate: { prompt: '{{prompt}}' }, resultUrlPath: 'result.url',
      inputConstraints: { images: { min: 1, max: 1, roles: ['referenceImage'] } },
      outputConstraints: {}, params: [],
    }],
  };
  const contract = buildRuntimeContractForModel(model);
  const transport = getProviderTransport('custom');
  const request = transport.compileRequest({
    taskType: 'imageGeneration', model: model.id, prompt: 'edit', modelContract: contract,
    modelInputs: { images: [{ filePath: '/tmp/source.png', fileName: 'source.png', mimeType: 'image/png' }] },
  });

  const result = await transport.submit(request);

  assert.equal(chatCalled, false);
  assert.equal(submitted.__endpointPath, '/v1/generate');
  assert.equal(submitted.__multipart, true);
  assert.equal(submitted.__inputImages[0].fieldName, 'source');
  assert.equal(result.status, 'completed');
});
