import assert from 'node:assert/strict';
import test from 'node:test';
import { cropPixels } from '../renderer/src/services/browserMedia.ts';

test('client crop matches normalized native bounds and rejects empty or invalid regions', () => {
  assert.deepEqual(cropPixels(1920, 1080, { x: .25, y: .25, width: .5, height: .5 }), { x: 480, y: 270, width: 960, height: 540 });
  assert.deepEqual(cropPixels(100, 100, { x: -.1, y: 0, width: .5, height: 2 }), { x: 0, y: 0, width: 40, height: 100 });
  for (const crop of [{ x: 2, y: 0, width: 1, height: 1 }, { x: NaN, y: 0, width: 1, height: 1 }, { x: 0, y: 0, width: 0, height: 1 }]) assert.throws(() => cropPixels(100, 100, crop));
});
