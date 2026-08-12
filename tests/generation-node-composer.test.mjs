import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const source = readFileSync(new URL('../renderer/src/app/canvas/GenerationNode.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../renderer/styles/react-migration.css', import.meta.url), 'utf8');
const editorStyles = readFileSync(new URL('../renderer/src/app/editor/VideoEditorWorkspace.css', import.meta.url), 'utf8');
test('发送按钮仅在节点运行时禁用并提供反馈', () => {
  assert.match(source, /disabled=\{busy\}/); assert.doesNotMatch(source, /modelStatus\.available/); assert.match(source, /actions\.run\(node\.id\)/);
});
test('点击发送与输入框回车复用运行入口', () => {
  assert.match(source, /onKeyDown=[\s\S]*?actions\.run\(node\.id\)/); assert.match(source, /onClick=\{\(\) => actions\.run\(node\.id\)\}/);
});
test('非文本节点使用模型目录类型与节点内配置面板', () => {
  assert.match(source, /getTypeMeta\(node\.type\)/); assert.match(source, /work-composer nodrag nopan nowheel/);
});
test('节点输入面板固定在屏幕空间，不跟随画布倍率缩放', () => {
  assert.match(source, /ScreenSpaceComposer/);
  assert.match(source, /createPortal/);
  assert.match(source, /CanvasOverlayRootContext/);
  assert.match(source, /viewportX \+ .* \* zoom/);
  assert.match(styles, /\.work-composer \{[\s\S]*?position:\s*relative/);
  assert.match(styles, /\.work-composer-anchor \{[\s\S]*?z-index:\s*120/);
  assert.doesNotMatch(styles, /\.work-composer \{[\s\S]*?top:\s*calc\(100% \+ 10px\)/);
});

test('节点输入面板层级被限制在画布内且不会盖住剪辑工作区', () => {
  assert.match(styles, /\.react-workflow-canvas \{[\s\S]*?isolation:\s*isolate/);
  assert.doesNotMatch(styles, /\.work-composer-anchor \{[\s\S]*?z-index:\s*10000/);
  assert.match(editorStyles, /\.ov-editor \{[\s\S]*?z-index:\s*1500/);
});
