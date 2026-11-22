import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { applyImageStylePreset, getImageStylePreset, listImageStylePresets, normalizeImageStyleLibrary } from '../renderer/src/utils/imageStylePresets.ts';
import { applyImageCompositionPreset, getImageCompositionPreset, IMAGE_COMPOSITION_PRESETS } from '../renderer/src/domain/graph/ImageCompositionPresets.ts';
import { compileGenerationNodeConfig } from '../renderer/src/domain/graph/GenerationNodeContract.ts';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

test('图片风格库使用参考项目的公开风格、提示词和本地封面', async () => {
  const styles = listImageStylePresets();
  assert.equal(styles.length, 45);
  assert.equal(new Set(styles.map(style => style.id)).size, styles.length);
  assert.equal(styles[0].id, 'period_idol');
  assert.match(styles[0].prompt, /古偶唯美柔光风格/);
  assert.ok(styles.every(style => style.label && style.category && style.prompt));
  assert.equal(styles.some(style => style.id === 'cinematic-narrative'), false);
  await Promise.all(styles.map(style => access(new URL(`../renderer/public/image-style-covers/${style.id}.webp`, import.meta.url))));
});

test('图片风格保留旧工程的提示词，未知 id 回退到原文', () => {
  assert.match(applyImageStylePreset('雨夜街道', 'cinematic-narrative'), /^雨夜街道\n\n制作预设：电影分镜关键帧/);
  assert.equal(applyImageStylePreset('雨夜街道', 'unknown'), '雨夜街道');
  assert.equal(getImageStylePreset('unknown').id, '');
});

test('自定义风格保留分类和可选封面，节点快照独立于本地风格库', () => {
  const style = { id: 'custom:evening', label: ' 暖调 ', prompt: ' 低对比逆光 ', category: 'city', cover: 'data:image/webp;base64,YQ==' };
  const library = normalizeImageStyleLibrary({ custom: [style, { ...style, prompt: '' }], favorites: ['period_idol'] });
  assert.deepEqual(library, { custom: [{ ...style, label: '暖调', prompt: '低对比逆光' }] });
  assert.equal(normalizeImageStyleLibrary({ custom: [{ ...style, category: null }] }).custom[0].category, 'other');
  assert.equal(applyImageStylePreset('旧街', style.id, style), '旧街\n\n低对比逆光');
  assert.equal(applyImageStylePreset('旧街', 'other', style), '旧街');
});

test('构图预设可与风格叠加，模型配置编译保留两种本地选项', () => {
  assert.equal(Object.keys(IMAGE_COMPOSITION_PRESETS).length, 12);
  assert.equal(getImageCompositionPreset('characterFourView').ratio, '16:9');
  const config = { imageCompositionPresetId: 'cameraGrid', stylePresetId: 'period_idol' };
  assert.deepEqual(compileGenerationNodeConfig(config), config);
  const prompt = applyImageStylePreset(applyImageCompositionPreset('雨夜街道', config.imageCompositionPresetId), config.stylePresetId);
  assert.match(prompt, /^雨夜街道\n\nProduce one 3x3 camera coverage sheet/);
  assert.match(prompt, /古偶唯美柔光风格/);
  assert.equal(applyImageCompositionPreset('原文', '__proto__'), '原文');
});

test('图片请求使用完整预设和风格指令，按当前模型选择尺寸，并允许手动覆盖', async (t) => {
  const env = await createRendererEnv({ includeStarrouter: true, storage: new Map(), withWindow: true });
  t.after(() => env.dispose());
  const { buildGenerationPayload } = await env.load('domain/graph/generationPayload');
  const style = { id: 'custom:night', label: '静夜', prompt: '低对比逆光', category: 'city' };
  const node = {
    id: 'image', type: 'imageGeneration', model: 'gpt-image-2.6-sunburst', prompt: '旧街',
    config: { size: '1024x1024', imageCompositionPresetId: 'characterFourView', stylePresetId: style.id, customImageStyle: style },
  };
  const payload = buildGenerationPayload(node, null);
  assert.equal(payload.prompt, `旧街\n\n${getImageCompositionPreset('characterFourView').prompt}\n\n低对比逆光`);
  assert.notEqual(payload.size, '1024x1024');
  const [width, height] = payload.size.split(/[:x]/).map(Number);
  assert.ok(width > height);
  assert.equal(buildGenerationPayload({ ...node, config: { ...node.config, imageSizeManuallySet: true } }, null).size, '1024x1024');
  assert.equal(buildGenerationPayload({ ...node, config: { size: node.config.size } }, null).size, '1024x1024');

  const originalRatio = { ...node, config: { size: node.config.size, imageCompositionPresetId: 'cameraGrid' } };
  const reference = {
    id: 'reference', type: 'imageGeneration', width: 240, height: 360,
    uploadedFile: { name: 'reference.png', path: '/project/reference.png', type: 'image/png' },
  };
  const project = {
    nodes: [reference, originalRatio],
    edges: [{ source: reference.id, target: originalRatio.id, data: { inputRole: 'referenceImage' } }],
  };
  const withReference = buildGenerationPayload(originalRatio, project);
  assert.equal(withReference.modelInputs.images[0].nodeId, reference.id);
  assert.equal(withReference.size, '1024x1536');
  assert.equal(buildGenerationPayload(originalRatio, null).size, '1024x1024');
});
