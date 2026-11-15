import assert from 'node:assert/strict';
import test from 'node:test';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

test('all credit displays divide quota by 10000 without rounding away small consumption', async () => {
  const env = await createRendererEnv({ storage: new Map([['shotloom:locale', 'zh-CN']]) });
  try {
    const { formatCredits } = await env.load('utils/format');
    assert.equal(formatCredits(0), '0');
    assert.equal(formatCredits(1), '0.0001');
    assert.equal(formatCredits(10_000), '1');
    assert.equal(formatCredits(261_077), '26.1077');
    assert.equal(formatCredits(38_923), '3.8923');
    assert.equal(formatCredits(100_000_000), '10,000');
  } finally { await env.dispose(); }
});
