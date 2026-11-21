import assert from 'node:assert/strict';
import test from 'node:test';
import { createCanvasWheelOwnership, createCanvasWheelPan } from '../renderer/src/app/canvas/canvasWheelPan.ts';

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
    assert.deepEqual(position, { x: 80, y: 230 });
    callback();
    assert.deepEqual(position, { x: 60, y: 260 });
    pan.enqueue(0, 1, 1, 800);
    callback();
    assert.deepEqual(position, { x: 60, y: 244 });
    pan.enqueue(1, 0, 2, 800);
    callback();
    assert.deepEqual(position, { x: -740, y: 244 });
    pan.enqueue(1.25, -4.75, 0, 800);
    pan.flush();
    assert.deepEqual(position, { x: -741.25, y: 248.75 });
    assert.equal(callback, null);
    pan.enqueue(1, 0, 0, 800);
    pan.enqueue(-1, 0, 0, 800);
    callback();
    pan.enqueue(0, 0, 0, 800);
    assert.equal(updates.length, 5);
    pan.enqueue(100, 100, 0, 800);
    pan.dispose();
    assert.equal(callback, null);
    assert.equal(updates.length, 5);
  } finally {
    pan.dispose();
    globalThis.requestAnimationFrame = raf;
    globalThis.cancelAnimationFrame = cancel;
  }
});

test('a trackpad gesture keeps its original owner as nodes move underneath the pointer', () => {
  const ownership = createCanvasWheelOwnership();
  let scrollChecks = 0;
  const scrollable = () => { scrollChecks++; return true; };
  assert.equal(ownership.resolve(0, false, () => false), 'canvas');
  assert.equal(ownership.resolve(16, false, scrollable), 'canvas');
  assert.equal(ownership.resolve(120, false, scrollable), 'canvas');
  assert.equal(scrollChecks, 0);
  assert.equal(ownership.resolve(316, false, scrollable), 'canvas');
  assert.equal(scrollChecks, 0);
  assert.equal(ownership.resolve(567, false, scrollable), 'content');
  assert.equal(ownership.resolve(602, false, () => false), 'content');
  assert.equal(ownership.resolve(618, true, scrollable), 'canvas');
  ownership.reset();
  assert.equal(ownership.resolve(634, false, scrollable), 'content');
});

test('decelerating pixel input moves the viewport through frames between wheel samples', () => {
  const raf = globalThis.requestAnimationFrame, cancel = globalThis.cancelAnimationFrame;
  let callback;
  globalThis.requestAnimationFrame = fn => { callback = fn; return 1; };
  globalThis.cancelAnimationFrame = () => { callback = null; };
  let position = { x: 0, y: 0 };
  const pan = createCanvasWheelPan({ read: () => position, apply: next => { position = next; } });
  const runFrame = () => {
    const next = callback;
    callback = null;
    next?.();
    return position;
  };
  try {
    for (const [deltaX, deltaY, first, second] of [
      [8, -4, { x: -4, y: 2 }, { x: -8, y: 4 }],
      [4, -2, { x: -10, y: 5 }, { x: -12, y: 6 }],
      [2, -1, { x: -13, y: 6.5 }, { x: -14, y: 7 }],
    ]) {
      pan.enqueue(deltaX, deltaY, 0, 800);
      assert.deepEqual(runFrame(), first);
      assert.deepEqual(runFrame(), second);
    }
    assert.equal(callback, null);

    pan.enqueue(4, 6, 0, 800);
    runFrame();
    pan.enqueue(-2, 3, 0, 800);
    pan.flush();
    assert.deepEqual(position, { x: -16, y: -2 });
    assert.equal(callback, null);
  } finally {
    pan.dispose();
    globalThis.requestAnimationFrame = raf;
    globalThis.cancelAnimationFrame = cancel;
  }
});
