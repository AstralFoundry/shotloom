import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aspectRatioStyle,
  isAspectRatioParam,
  modelTypeLabel,
  optionLabel,
} from '../renderer/src/utils/modelPresentation.js';

test('模型类型使用面向用户的中文名称', () => {
  assert.equal(modelTypeLabel('textGeneration'), '文本生成');
  assert.equal(modelTypeLabel('imageGeneration'), '图片生成');
  assert.equal(modelTypeLabel('videoGeneration'), '视频生成');
  assert.equal(modelTypeLabel('audioGeneration'), '音频生成');
  assert.equal(modelTypeLabel('customGeneration'), 'customGeneration');
});

test('供应商 size 参数可以按统一比例控件展示', () => {
  const param = {
    key: 'size', label: '比例', presentation: 'aspectRatio',
    options: ['1024x1024', '1536x864'],
    optionLabels: { '1024x1024': '1:1', '1536x864': '16:9' },
  };
  assert.equal(isAspectRatioParam(param), true);
  assert.equal(optionLabel(param, '1536x864'), '16:9');
  assert.deepEqual(aspectRatioStyle(optionLabel(param, '1536x864')), { width: '18px', height: '10px' });
});
