import assert from 'node:assert/strict';
import test from 'node:test';
import { createCanvasWheelPan } from '../renderer/src/app/canvas/canvasWheelPan.ts';

test('trackpad movement accumulates both axes once per frame without changing zoom', () => {
  const raf = globalThis.requestAnimationFrame, cancel = globalThis.cancelAnimationFrame;
  let callback, frames = 0;
  globalThis.requestAnimationFrame = fn => { callback = fn; return ++frames; };
  globalThis.cancelAnimationFrame = () => { callback = null; };
  let position = { x: 100, y: 200 };
  const updates = [];
  const pan = createCanvasWheelPan({ read: () => position, apply: next => { position = next; updates.push(next); } });
  try {
    for (let i = 0; i < 20; i++) pan.enqueue(2, -3, 0, 800);
    assert.equal(frames, 1);
    assert.equal(updates.length, 0);
    callback();
    assert.deepEqual(position, { x: 60, y: 260 });
    pan.enqueue(0, 1, 1, 800);
    callback();
    assert.deepEqual(position, { x: 60, y: 244 });
    pan.enqueue(1, 0, 2, 800);
    callback();
    assert.deepEqual(position, { x: -740, y: 244 });
    pan.enqueue(100, 100, 0, 800);
    pan.dispose();
    assert.equal(callback, null);
    assert.equal(updates.length, 3);
  } finally {
    pan.dispose();
    globalThis.requestAnimationFrame = raf;
    globalThis.cancelAnimationFrame = cancel;
  }
});
