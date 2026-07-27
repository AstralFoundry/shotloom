import assert from 'node:assert/strict';
import test from 'node:test';
import {
  projectDefaultModelKey,
  resolveProjectDefaultModel,
} from '../renderer/src/utils/projectModelDefaults.mjs';

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

test('旧的单一 defaultModel 字段不再参与默认模型解析', () => {
  const legacySettings = { defaultModel: 'legacy-model' };
  assert.equal(resolveProjectDefaultModel(legacySettings, 'textGeneration'), 'gpt-5.4');
  assert.equal(resolveProjectDefaultModel(legacySettings, 'imageGeneration'), 'gpt-image-2');
  assert.equal(resolveProjectDefaultModel(legacySettings, 'videoGeneration'), 'grok-imagine-video');
});

