import assert from 'node:assert/strict';
import test from 'node:test';
import { cachedRead, invalidateReads } from '../src/lib/readCache';

test('successful reads coalesce, invalidation fences old loads, failures are not cached', async () => {
  let release!: (value: number) => void;
  const old = cachedRead('user:fixture:models', 1000, () => new Promise<number>(resolve => { release = resolve; }));
  const shared = cachedRead('user:fixture:models', 1000, async () => 99);
  invalidateReads('user:fixture:');
  assert.equal(await cachedRead('user:fixture:models', 1000, async () => 2), 2);
  release(1);
  assert.deepEqual(await Promise.all([old, shared]), [1, 1]);
  assert.equal(await cachedRead('user:fixture:models', 1000, async () => 99), 2);
  assert.equal(await cachedRead('user:other:models', 1000, async () => 3), 3);
  assert.equal(await cachedRead('user:fixture:models', 1000, async () => 4, true), 4);
  await assert.rejects(cachedRead('failure', 1000, async () => { throw new Error('offline'); }));
  assert.equal(await cachedRead('failure', 1000, async () => 5), 5);
  invalidateReads('');
});
