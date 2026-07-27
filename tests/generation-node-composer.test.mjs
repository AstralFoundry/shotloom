import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const source = readFileSync(new URL('../renderer/src/app/canvas/GenerationNode.tsx', import.meta.url), 'utf8');
test('发送按钮仅在节点运行时禁用并提供反馈', () => {
  assert.match(source, /disabled=\{busy\}/); assert.doesNotMatch(source, /modelStatus\.available/); assert.match(source, /actions\.run\(node\.id\)/);
});
test('点击发送与输入框回车复用运行入口', () => {
  assert.match(source, /onKeyDown=[\s\S]*?actions\.run\(node\.id\)/); assert.match(source, /onClick=\{\(\) => actions\.run\(node\.id\)\}/);
});
test('非文本节点使用模型目录类型与节点内配置面板', () => {
  assert.match(source, /getTypeMeta\(node\.type\)/); assert.match(source, /work-composer nodrag nopan nowheel/);
});
