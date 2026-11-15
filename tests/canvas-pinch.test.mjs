import test from 'node:test';
import assert from 'node:assert/strict';
import { installCanvasPinch } from '../renderer/src/app/canvas/canvasPinch.ts';

test('two fingers use semantic zoom at their midpoint and release without hijacking one-finger gestures', () => {
  const root = new EventTarget();
  root.closest = () => null;
  const updates = [];
  const dispose = installCanvasPinch(root, () => 0.5, (zoom, point) => updates.push({ zoom, point }));
  const touch = (type, points) => {
    const event = new Event(type, { cancelable: true });
    Object.defineProperty(event, 'touches', { value: points.map(([clientX, clientY]) => ({ clientX, clientY })) });
    root.dispatchEvent(event);
    return event.defaultPrevented;
  };
  assert.equal(touch('touchstart', [[100, 100]]), false);
  assert.equal(touch('touchmove', [[110, 100]]), false);
  assert.equal(touch('touchstart', [[100, 100], [200, 100]]), true);
  assert.equal(touch('touchmove', [[50, 100], [250, 100]]), true);
  assert.deepEqual(updates, [{ zoom: 1, point: { x: 150, y: 100 } }]);
  touch('touchend', [[50, 100]]);
  assert.equal(touch('touchmove', [[60, 100]]), true);
  touch('touchend', []);
  assert.equal(touch('touchmove', [[70, 100]]), false);
  root.closest = () => true;
  assert.equal(touch('touchstart', [[100, 100], [200, 100]]), false);
  dispose();
  root.closest = () => null;
  assert.equal(touch('touchstart', [[100, 100], [200, 100]]), false);
});
