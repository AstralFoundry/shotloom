import assert from 'node:assert/strict';
import test from 'node:test';
import { imageGridCellRect } from '../renderer/src/utils/imageGridCrop.mjs';

test('宫格按可移动裁剪区域切分，邻格共享边界', () => {
  const selection = { x: .1, y: .2, width: .6, height: .5 };
  const first = imageGridCellRect(selection, 2, 3, 0);
  const next = imageGridCellRect(selection, 2, 3, 1);
  const last = imageGridCellRect(selection, 2, 3, 5);
  const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10);
  close(first.x, .1);
  close(first.y, .2);
  close(first.width, .2);
  close(first.height, .25);
  close(first.x + first.width, next.x);
  close(last.x + last.width, selection.x + selection.width);
  close(last.y + last.height, selection.y + selection.height);
});
