import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS,
  IMAGE_PROVIDER_REQUEST_TIMEOUT_MS,
  providerRequestTimeoutMs,
} from '../renderer/src/utils/providerRequestTimeout.mjs';

test('图片同步请求使用完整的十五分钟生成额度', () => {
  assert.equal(providerRequestTimeoutMs('imageGeneration', 900_000), 900_000);
  assert.equal(providerRequestTimeoutMs('imageGeneration'), IMAGE_PROVIDER_REQUEST_TIMEOUT_MS);
});

test('显式的较短图片超时被保留，其他同步请求仍限制为两分钟', () => {
  assert.equal(providerRequestTimeoutMs('imageGeneration', 300_000), 300_000);
  assert.equal(providerRequestTimeoutMs('textGeneration', 900_000), DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS);
  assert.equal(providerRequestTimeoutMs('videoGeneration'), DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS);
});
