import assert from 'node:assert/strict';
import test from 'node:test';
import { BoundedMediaCache } from '../renderer/src/services/boundedMediaCache.mjs';

const buffer = (bytes) => new ArrayBuffer(bytes);

function cacheWith(options = {}) {
  let nextUrl = 0;
  const revoked = [];
  const cache = new BoundedMediaCache({
    kindBudgets: { image: 10, video: 10, audio: 10 },
    totalBudget: 12,
    maxEntries: 4,
    maxEntryBytes: 10,
    createUrl: () => `blob:test-${++nextUrl}`,
    revokeUrl: (url) => revoked.push(url),
    ...options,
  });
  return { cache, revoked };
}

test('media cache coalesces concurrent reads and reference-counts every consumer', async () => {
  const { cache, revoked } = cacheWith();
  let resolveLoad;
  let loads = 0;
  const load = () => {
    loads += 1;
    return new Promise((resolve) => { resolveLoad = resolve; });
  };
  const firstPromise = cache.acquire('same', { kind: 'image', load });
  const secondPromise = cache.acquire('same', { kind: 'image', load });
  resolveLoad({ buffer: buffer(6), mime: 'image/jpeg' });
  const [first, second] = await Promise.all([firstPromise, secondPromise]);
  assert.equal(loads, 1);
  assert.equal(first.url, second.url);
  assert.equal(cache.diagnostics().pinnedBytes, 6);
  first.release();
  assert.equal(cache.diagnostics().pinnedBytes, 6);
  second.release();
  assert.equal(cache.diagnostics().pinnedBytes, 0);
  assert.deepEqual(revoked, []);
});

test('media cache evicts least-recently-used unpinned entries within byte budgets', async () => {
  const { cache, revoked } = cacheWith();
  const first = await cache.acquire('first', {
    kind: 'image', load: async () => ({ buffer: buffer(6), mime: 'image/jpeg' }),
  });
  first.release();
  const second = await cache.acquire('second', {
    kind: 'image', load: async () => ({ buffer: buffer(6), mime: 'image/jpeg' }),
  });
  assert.equal(cache.diagnostics().entries, 1);
  assert.deepEqual(revoked, [first.url]);
  assert.equal(cache.diagnostics().pinnedBytes, 6);
  second.release();
});

test('pinned media survives pressure and is evicted after release', async () => {
  const { cache, revoked } = cacheWith();
  const pinned = await cache.acquire('pinned', {
    kind: 'video', load: async () => ({ buffer: buffer(8), mime: 'video/mp4' }),
  });
  cache.relieve('critical');
  assert.equal(cache.diagnostics().entries, 1);
  assert.deepEqual(revoked, []);
  pinned.release();
  cache.relieve('critical');
  assert.equal(cache.diagnostics().entries, 0);
  assert.deepEqual(revoked, [pinned.url]);
});

test('oversized media is rejected before creating a cache URL', async () => {
  const { cache } = cacheWith();
  await assert.rejects(
    cache.acquire('oversized', {
      kind: 'video',
      maxEntryBytes: 4,
      load: async () => ({ buffer: buffer(3), costBytes: 5, mime: 'video/mp4' }),
    }),
    /exceeds cache entry budget/,
  );
  assert.equal(cache.diagnostics().entries, 0);
  assert.equal(cache.diagnostics().rejectedOversize, 1);
});
