import assert from 'node:assert/strict';

import test from 'node:test';
import { readGenerationNodeSource } from './helpers/generationNodeSource.mjs';
import { readLocalizedSource as readSource } from './helpers/sourceContract.mjs';
const source = readGenerationNodeSource();
const adapter = readSource('renderer/src/app/adapters/canvasAdapter.ts');
test('图片预览使用唯一媒体分支，不与空状态同时渲染', () => {
  assert.match(source, /activeKind === 'image' && previewUrl \? <img[\s\S]*?: activeKind === 'video'/);
});
test('图片节点从标题栏创建普通彩铅图片节点', () => {
  assert.match(source, /创建彩铅图片节点/); assert.match(source, /actions\.applyColoredPencil/);
  assert.match(adapter, /createColoredPencilImageNode/);
});
