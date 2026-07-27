import assert from 'node:assert/strict';
import test from 'node:test';
import { compactAgentModelCatalog } from '../renderer/src/utils/agentModelCatalog.mjs';

test('Agent 模型目录保留选型契约但不重复发送执行层协议', () => {
  const result = compactAgentModelCatalog([{
    type: 'imageGeneration',
    label: '图片生成',
    defaultModel: 'image-model',
    models: [{
      id: 'image-model',
      name: 'Image Model',
      provider: 'provider',
      defaultMode: 'text-to-image',
      modes: [{
        id: 'text-to-image',
        label: '文生图',
        endpoint: { path: '/secret-runtime-path' },
        requestTemplate: { prompt: '{{prompt}}' },
        auth: { type: 'bearer' },
        inputConstraints: { images: { min: 0, max: 0 } },
        outputConstraints: { maxCount: 4 },
        capabilities: ['text-to-image'],
        params: [
          { key: 'prompt', type: 'string' },
          { key: 'model', type: 'string' },
          { key: 'size', type: 'string', options: ['1:1'] },
        ],
      }],
    }],
  }]);

  const model = result.types[0].models[0];
  assert.equal(model.modes[0].params.some((param) => param.key === 'prompt'), false);
  assert.equal(model.modes[0].params.some((param) => param.key === 'model'), false);
  assert.deepEqual(model.modes[0].params.map((param) => param.key), ['size']);
  assert.equal(Object.hasOwn(model.modes[0], 'endpoint'), false);
  assert.equal(Object.hasOwn(model.modes[0], 'requestTemplate'), false);
  assert.equal(Object.hasOwn(model.modes[0], 'auth'), false);
  assert.deepEqual(result.models, [{
    id: 'image-model', name: 'Image Model', provider: 'provider', type: 'imageGeneration', defaultMode: 'text-to-image',
  }]);
});
