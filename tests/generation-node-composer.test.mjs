import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const source = readFileSync(new URL('../renderer/src/app/canvas/GenerationNode.tsx', import.meta.url), 'utf8');
const overlaySource = readFileSync(new URL('../renderer/src/app/canvas/ScreenSpaceNodeOverlay.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../renderer/styles/react-migration.css', import.meta.url), 'utf8');
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
  assert.match(source, /ScreenSpaceNodeOverlay/);
  assert.match(overlaySource, /createPortal/);
  assert.match(overlaySource, /CanvasOverlayRootContext/);
  assert.match(overlaySource, /viewportX \+ .* \* zoom/);
  assert.match(styles, /\.work-composer \{[\s\S]*?position:\s*relative/);
  assert.match(styles, /\.work-composer-anchor \{[\s\S]*?z-index:\s*10000/);
  assert.doesNotMatch(styles, /\.work-composer \{[\s\S]*?top:\s*calc\(100% \+ 10px\)/);
});

test('节点输入面板统一避让侧栏、画布控件和其他可见节点', () => {
  assert.match(overlaySource, /resolveFloatingOverlayPosition/);
  assert.match(overlaySource, /state\.nodeLookup\.values\(\)/);
  assert.match(overlaySource, /obstacleRects:\s*\[\.\.\.geometry\.obstacleRects,\s*\.\.\.surface\.obstacleRects\]/);
  assert.match(overlaySource, /\.sidebar-overlay-shell \.sidebar-shell/);
  assert.match(overlaySource, /\.bottom-mode-switch, \.canvas-corner-controls, \.canvas-minimap/);
  assert.doesNotMatch(styles, /\.work-composer-anchor \{[^}]*translateX\(-50%\)/);
});
