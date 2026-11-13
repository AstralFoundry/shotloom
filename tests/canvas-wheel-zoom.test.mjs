import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvasWheelZoom } from '../renderer/src/app/canvas/canvasWheelZoom.ts';

test('高频滚轮每帧只更新一次画布，保留全部缩放增量和最后的光标位置', () => {
  const original = globalThis.requestAnimationFrame;
  const cancel = globalThis.cancelAnimationFrame;
  let scheduled;
  let count = 0;
  globalThis.requestAnimationFrame = callback => { count++; scheduled = callback; return count; };
  globalThis.cancelAnimationFrame = () => { scheduled = null; };
  try {
    let zoom = 1;
    const updates = [];
    const wheel = createCanvasWheelZoom({ readZoom: () => zoom, applyZoom: (next, point) => { zoom = next; updates.push({ zoom, point }); }, min: 0.1, max: 4 });
    for (let i = 0; i < 20; i++) wheel.enqueue(2, { x: i, y: 10 });
    assert.equal(count, 1);
    assert.equal(updates.length, 0);
    scheduled();
    assert.equal(updates.length, 1);
    assert.ok(Math.abs(zoom - Math.exp(-40 * 0.002)) < 1e-10);
    assert.deepEqual(updates[0].point, { x: 19, y: 10 });
    wheel.enqueue(-10, { x: 20, y: 10 });
    scheduled();
    assert.ok(Math.abs(zoom - Math.exp(-30 * 0.002)) < 1e-10);
    wheel.enqueue(100000, { x: 0, y: 0 });
    scheduled();
    assert.equal(zoom, 0.1);
    wheel.enqueue(-100000, { x: 0, y: 0 });
    wheel.dispose();
    assert.equal(scheduled, null);
    assert.equal(updates.length, 3);
  } finally {
    globalThis.requestAnimationFrame = original;
    globalThis.cancelAnimationFrame = cancel;
  }
});
