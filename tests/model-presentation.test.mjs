import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aspectRatioStyle,
  isAspectRatioParam,
  modelTraitNote,
  modelTypeLabel,
  optionLabel,
} from '../renderer/src/utils/modelPresentation.ts';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

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
  assert.deepEqual(aspectRatioStyle('1536x864'), { width: '18px', height: '10px' });
  assert.deepEqual(aspectRatioStyle('9:16'), { width: '10px', height: '18px' });
  assert.deepEqual(aspectRatioStyle('4 / 3'), { width: '18px', height: '14px' });
  assert.deepEqual(aspectRatioStyle('3×2'), { width: '18px', height: '12px' });
});

test('模型说明的厂商与接口逐字段取自目录，只有观感文案是手写', async () => {
  const env = await createRendererEnv({ storage: new Map(), withWindow: true });
  try {
    const { generationModelDescription } = await env.load('app/canvas/generationNodeState');
    // openai.json 里的 gpt-image 系列曾被按模型 ID 猜厂商的关键字表说成 StarRouter
    const sunburst = generationModelDescription('gpt-image-2.5-sunburst', 'imageGeneration');
    assert.equal(sunburst, 'OpenAI /images/generations');
    assert.equal(generationModelDescription('kling-3.0', 'videoGeneration'),
      'Kling AI（可灵） /text-to-video/kling-3.0 · 图生视频与镜头运动表现好');
    // 中转站的同名模型走的是它自己的登记，不会因为 ID 里有 gpt-image 就串到官方条目上
    assert.equal(generationModelDescription('starrouter-gpt-image-2.5-sunburst', 'imageGeneration'),
      'StarRouter /images/generations');
    assert.equal(generationModelDescription('not-in-catalog', 'imageGeneration'), '图片生成模型');
    assert.equal(modelTraitNote('not-in-catalog'), '');
  } finally {
    await env.dispose();
  }
});
