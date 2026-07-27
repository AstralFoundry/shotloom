import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeInputRole } from '../renderer/src/utils/generationInputRole.mjs';

test('生成请求保留当前输入角色', () => {
  assert.equal(normalizeInputRole('textContext'), 'textContext');
  assert.equal(normalizeInputRole('referenceImage'), 'referenceImage');
  assert.equal(normalizeInputRole('inputVideo'), 'inputVideo');
  assert.equal(normalizeInputRole('auto'), 'auto');
});

test('生成请求拒绝非当前契约输入角色', () => {
  assert.equal(normalizeInputRole('referenceCandidate'), 'auto');
  assert.equal(normalizeInputRole('firstFrame'), 'auto');
  assert.equal(normalizeInputRole('lastFrame'), 'auto');
  assert.equal(normalizeInputRole('unexpected-role'), 'auto');
  assert.equal(normalizeInputRole(), 'auto');
});
