import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const source = readFileSync(new URL('../renderer/src/app/canvas/GenerationNode.tsx', import.meta.url), 'utf8');
const adapter = readFileSync(new URL('../renderer/src/app/adapters/canvasAdapter.ts', import.meta.url), 'utf8');
test('图片预览使用唯一媒体分支，不与空状态同时渲染', () => {
  assert.match(source, /activeKind === 'image' && previewUrl \? <img[\s\S]*?: activeKind === 'video'/);
});
test('图片节点从标题栏创建普通彩铅图片节点', () => {
  assert.match(source, /创建彩铅图片节点/); assert.match(source, /actions\.applyColoredPencil/);
  assert.match(adapter, /createColoredPencilImageNode/);
});
