import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../browser/model.mjs';

test('Worker accepts an empty catalog and omits unknown context limits', async () => {
  let adapter;
  const ctx = { effect: effect => effect(), llm: { registerAdapter(providers, value) {
    assert.deepEqual(providers, ['relay']);
    adapter = value;
  } } };
  apply(ctx, { providers: {} });
  assert.equal(adapter, undefined);
  apply(ctx, { providers: { relay: { models: [
    { id: 'unknown-limit', input: ['text'] },
    { id: 'known-limit', input: ['text'], contextWindow: 32000 },
  ] } } });
  assert.equal((await adapter.resolveModel('relay', 'unknown-limit')).context, undefined);
  assert.deepEqual((await adapter.resolveModel('relay', 'known-limit')).context, { contextWindow: 32000 });
});
