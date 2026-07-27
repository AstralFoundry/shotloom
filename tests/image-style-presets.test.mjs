import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyImageStylePreset,
  getImageStylePreset,
  IMAGE_STYLE_PRESETS,
} from '../renderer/src/utils/imageStylePresets.mjs';

test('图片风格预设使用唯一 id 且不依赖艺术家名称', () => {
  const ids = IMAGE_STYLE_PRESETS.map((preset) => preset.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(IMAGE_STYLE_PRESETS.length >= 8);
  for (const preset of IMAGE_STYLE_PRESETS) {
    assert.ok(preset.label);
    assert.ok(preset.description);
    assert.ok(preset.icon);
    assert.equal(/style of|in the style|模仿|艺术家/i.test(preset.prompt), false);
  }
});

test('图片风格在运行时追加到用户提示词且未知预设安全回退', () => {
  const prompt = applyImageStylePreset('雨夜街道', 'cinematic-narrative');
  assert.match(prompt, /^雨夜街道/);
  assert.match(prompt, /制作预设：/);
  assert.equal(applyImageStylePreset('雨夜街道', 'unknown'), '雨夜街道');
  assert.equal(getImageStylePreset('unknown').id, '');
});
