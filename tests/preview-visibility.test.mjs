import assert from 'node:assert/strict';
import test from 'node:test';
import { observeNearViewport } from '../renderer/src/app/canvas/previewLoadQueue.ts';

test('offscreen previews wait for intersection and cancelled previews never activate', () => {
  const original = globalThis.IntersectionObserver;
  let deliver, activated = 0;
  globalThis.IntersectionObserver = class {
    constructor(callback) { deliver = callback; }
    observe() {}
    unobserve() {}
  };
  try {
    const visible = {}, cancelled = {};
    observeNearViewport(visible, () => activated++);
    const stop = observeNearViewport(cancelled, () => assert.fail('unmounted preview activated'));
    deliver([{target: visible, isIntersecting: false}]);
    assert.equal(activated, 0);
    stop();
    deliver([{target: cancelled, isIntersecting: true}, {target: visible, isIntersecting: true}]);
    deliver([{target: visible, isIntersecting: true}]);
    assert.equal(activated, 1);
  } finally {
    if (original) globalThis.IntersectionObserver = original;
    else delete globalThis.IntersectionObserver;
  }
});
