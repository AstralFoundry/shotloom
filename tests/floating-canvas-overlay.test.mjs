import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveCrispCanvasViewport, resolveFloatingOverlayPosition } from '../renderer/src/utils/floatingCanvasOverlay.mjs';

test('画布浮层使用取整后的屏幕坐标并水平居中', () => {
  assert.deepEqual(resolveFloatingOverlayPosition({
    anchorRect: { left: 400.4, right: 700.4, top: 120.2, bottom: 420.2, width: 300 },
    overlayRect: { width: 600, height: 160 },
    viewportWidth: 1200,
    viewportHeight: 900,
  }), { left: 250, top: 428, visible: true });
});

test('画布浮层在底部空间不足时放到节点上方并限制在视口内', () => {
  assert.deepEqual(resolveFloatingOverlayPosition({
    anchorRect: { left: 900, right: 1180, top: 610, bottom: 850, width: 280 },
    overlayRect: { width: 600, height: 180 },
    viewportWidth: 1200,
    viewportHeight: 900,
  }), { left: 588, top: 422, visible: true });
});

test('节点完全移出视口时隐藏画布浮层', () => {
  assert.deepEqual(resolveFloatingOverlayPosition({
    anchorRect: { left: -500, right: -100, top: 100, bottom: 300, width: 400 },
    overlayRect: { width: 600, height: 160 },
    viewportWidth: 1200,
    viewportHeight: 900,
  }), { left: 0, top: 0, visible: false });
});

test('画布浮层限制在画布区域内，不覆盖左侧栏或右侧面板', () => {
  assert.deepEqual(resolveFloatingOverlayPosition({
    anchorRect: { left: 205, right: 575, top: 120, bottom: 390, width: 370 },
    overlayRect: { width: 370, height: 160 },
    viewportWidth: 1400,
    viewportHeight: 900,
    boundaryRect: { left: 216, right: 1040, top: 48, bottom: 900 },
  }), { left: 228, top: 398, visible: true });
});

test('画布浮层避开其他可见节点并选择遮挡面积最小的方向', () => {
  assert.deepEqual(resolveFloatingOverlayPosition({
    anchorRect: { left: 500, right: 800, top: 300, bottom: 540, width: 300, height: 240 },
    overlayRect: { width: 620, height: 205 },
    viewportWidth: 1400,
    viewportHeight: 900,
    obstacleRects: [
      { left: 330, right: 970, top: 548, bottom: 810, width: 640, height: 262 },
    ],
  }), { left: 340, top: 87, visible: true });
});

test('画布浮层把展开侧栏形成的可用边界作为硬约束', () => {
  const result = resolveFloatingOverlayPosition({
    anchorRect: { left: 300, right: 600, top: 160, bottom: 400, width: 300, height: 240 },
    overlayRect: { width: 620, height: 205 },
    viewportWidth: 1200,
    viewportHeight: 800,
    boundaryRect: { left: 280, right: 1200, top: 0, bottom: 800 },
  });
  assert.ok(result.left >= 292);
  assert.equal(result.visible, true);
});

test('画布显示接近 100% 时吸附到精确 1x 和整数位移', () => {
  assert.deepEqual(resolveCrispCanvasViewport({
    viewport: { x: 20.25, y: -15.5, zoom: 0.997 },
    canvasWidth: 1200,
    canvasHeight: 800,
  }), { x: 19, y: -17, zoom: 1 });
  assert.equal(resolveCrispCanvasViewport({
    viewport: { x: 20, y: -15, zoom: 0.9 },
    canvasWidth: 1200,
    canvasHeight: 800,
  }), null);
  assert.deepEqual(resolveCrispCanvasViewport({
    viewport: { x: 12.4, y: 8.7, zoom: 0.96 },
    canvasWidth: 1200,
    canvasHeight: 800,
  }), { x: -12, y: -8, zoom: 1 });
});
