import assert from 'node:assert/strict';
import test from 'node:test';
import { captureRect, captureSize, CAPTURE_ASPECTS } from '../vendor/shotloom-director-desk/src/core/editor/viewport-capture.ts';

test('Auto保留完整视口，固定比例在中心取景且不超出画布', () => {
  assert.deepEqual(captureRect(1000, 600, 'auto'), { x: 0, y: 0, width: 1000, height: 600 });
  assert.deepEqual(captureRect(1000, 600, '1:1'), { x: 200, y: 0, width: 600, height: 600 });
  for (const aspect of CAPTURE_ASPECTS) {
    const rect = captureRect(760, 990, aspect);
    assert.ok(rect.x >= -1e-9 && rect.y >= -1e-9);
    assert.ok(rect.x + rect.width <= 760 + 1e-9 && rect.y + rect.height <= 990 + 1e-9);
    assert.ok(Math.abs(rect.x * 2 + rect.width - 760) < 1e-9);
    assert.ok(Math.abs(rect.y * 2 + rect.height - 990) < 1e-9);
  }
});

test('高清输出长边限制为1920且宽高为偶数，Auto支持互质视口尺寸', () => {
  assert.deepEqual(captureSize(1000, 600, '16:9', 1920), [1920, 1080]);
  for (const aspect of CAPTURE_ASPECTS) {
    const [width, height] = captureSize(1009, 683, aspect, 1920);
    assert.equal(Math.max(width, height), 1920);
    assert.equal(width % 2, 0);
    assert.equal(height % 2, 0);
  }
});
