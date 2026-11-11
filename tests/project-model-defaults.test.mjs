import assert from 'node:assert/strict';
import test from 'node:test';
import {
  projectDefaultModelKey,
  resolveProjectDefaultModel,
} from '../renderer/src/config/projectModelDefaults.ts';
import { DEFAULT_GENERATION_MODELS } from '../renderer/src/config/defaultGenerationModels.ts';
import { loadModelCatalog } from './helpers/modelCatalog.mjs';

test('项目按文本、图片、视频分别解析默认模型', () => {
  const settings = {
    defaultTextModel: 'text-model',
    defaultImageModel: 'image-model',
    defaultVideoModel: 'video-model',
  };
  assert.equal(projectDefaultModelKey('textGeneration'), 'defaultTextModel');
  assert.equal(projectDefaultModelKey('imageGeneration'), 'defaultImageModel');
  assert.equal(projectDefaultModelKey('videoGeneration'), 'defaultVideoModel');
  assert.equal(resolveProjectDefaultModel(settings, 'textGeneration'), 'text-model');
  assert.equal(resolveProjectDefaultModel(settings, 'imageGeneration'), 'image-model');
  assert.equal(resolveProjectDefaultModel(settings, 'videoGeneration'), 'video-model');
});

test('未配置默认模型时回落到目录里的新一代模型', () => {
  const legacySettings = { defaultModel: 'legacy-model' };
  const catalog = loadModelCatalog();
  for (const [nodeType, modelId] of Object.entries(DEFAULT_GENERATION_MODELS)) {
    assert.equal(resolveProjectDefaultModel(legacySettings, nodeType), modelId,
      `${nodeType} 的回落必须来自唯一默认模型来源`);
    const model = catalog.models.find((item) => item.id === modelId);
    assert.equal(model?.enabled, true, `${modelId} 必须在册且启用`);
    assert.equal(model?.type, nodeType, `${modelId} 必须是 ${nodeType}`);
  }
});

