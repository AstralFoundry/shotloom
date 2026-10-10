import assert from 'node:assert/strict';
import test from 'node:test';
import { inlineCropToolbarPosition } from '../renderer/src/utils/inlineCropToolbar.mjs';

const canvas = { width: 1000, height: 700 };
const node = { x: 300, y: 200, width: 400, height: 250 };
const viewport = { x: 0, y: 0, zoom: 1 };

test('画布裁剪工具条固定在节点下方且水平居中', () => {
  assert.deepEqual(inlineCropToolbarPosition({ node, viewport, canvas, mode: 'crop' }),
    { left: 382.5, top: 462, width: 235, visible: true });
});

test('底部空间不足时工具条移到节点上方，水平位置限制在画布内', () => {
  const result = inlineCropToolbarPosition({ node: { x: 850, y: 580, width: 300, height: 100 }, viewport, canvas, mode: 'grid' });
  assert.deepEqual(result, { left: 678, top: 526, width: 310, visible: true });
});

test('节点完全移出画布时隐藏工具条', () => {
  assert.equal(inlineCropToolbarPosition({ node: { ...node, x: -800 }, viewport, canvas, mode: 'crop' }).visible, false);
  assert.equal(inlineCropToolbarPosition({ node: { ...node, y: 800 }, viewport, canvas, mode: 'crop' }).visible, false);
});
