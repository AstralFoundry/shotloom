import test from 'node:test';
import assert from 'node:assert/strict';
import {
  constrainTransformToCanvas,
  resizeEditorTransform,
} from '../renderer/src/app/editor/videoEditorModel.ts';

const START = { x: 100, y: 50, width: 400, height: 200, angle: 0, opacity: 1 };

test('拖角时对角固定：四个角的锚点都正确', () => {
  // 右下角固定左上角。
  assert.deepEqual(
    pick(resizeEditorTransform(START, 'se', 100, 50)),
    { x: 100, y: 50, width: 500, height: 250 },
  );
  // 左上角固定右下角（500, 250）。
  assert.deepEqual(
    pick(resizeEditorTransform(START, 'nw', 100, 50)),
    { x: 200, y: 100, width: 300, height: 150 },
  );
  // 右上角固定左下角（100, 250）。
  assert.deepEqual(
    pick(resizeEditorTransform(START, 'ne', 100, 50)),
    { x: 100, y: 100, width: 500, height: 150 },
  );
  // 左下角固定右上角（500, 50）。
  assert.deepEqual(
    pick(resizeEditorTransform(START, 'sw', 100, 50)),
    { x: 200, y: 50, width: 300, height: 250 },
  );
});

test('默认自由调整宽高，按住 Shift 才等比', () => {
  // 只往右拖：宽变、高不变，比例被改掉 —— 这才是"拖拽裁剪大小"。
  const free = resizeEditorTransform(START, 'se', 100, 0);
  assert.equal(free.width, 500);
  assert.equal(free.height, 200);

  const locked = resizeEditorTransform(START, 'se', 100, 0, { lockRatio: true });
  assert.equal(locked.width, 500);
  assert.equal(locked.height, 250, '锁比时高度按起始比例跟着变');
  assert.equal(locked.width / locked.height, START.width / START.height);
});

test('最小尺寸被钳住，其余字段原样保留', () => {
  const tiny = resizeEditorTransform(START, 'se', -10000, -10000);
  assert.equal(tiny.width, 24);
  assert.equal(tiny.height, 24);

  const withFit = resizeEditorTransform({ ...START, fit: 'fill' }, 'se', 10, 10);
  assert.equal(withFit.fit, 'fill', 'fit 等既有字段必须原样带过去');
  assert.equal(withFit.angle, 0);
  assert.equal(withFit.opacity, 1);
});

test('resize 结果交给画布钳位后仍在画布内', () => {
  const resized = resizeEditorTransform({ ...START, x: 0, y: 0 }, 'nw', 500, 300);
  const clamped = constrainTransformToCanvas(resized, 1920, 1080);
  assert.ok(clamped.x >= 0 && clamped.y >= 0);
  assert.ok(clamped.x + clamped.width <= 1920);
  assert.ok(clamped.y + clamped.height <= 1080);
});

function pick({ x, y, width, height }) {
  return { x, y, width, height };
}
