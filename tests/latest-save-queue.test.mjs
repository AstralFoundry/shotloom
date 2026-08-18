import assert from 'node:assert/strict';
import test from 'node:test';
import { LatestSaveQueue } from '../renderer/src/services/latestSaveQueue.mjs';

test('latest save queue serializes writes and supersedes intermediate snapshots', async () => {
  const saves = [];
  const releases = [];
  const queue = new LatestSaveQueue((value) => new Promise((resolve) => {
    saves.push(value);
    releases.push(() => resolve({ value }));
  }), { maxRetryAttempts: 0 });

  const first = queue.enqueue('first', { key: '1', scope: 'project' });
  const second = queue.enqueue('second', { key: '2', scope: 'project' });
  const third = queue.enqueue('third', { key: '3', scope: 'project' });
  assert.deepEqual(saves, ['first']);
  releases.shift()();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(saves, ['first', 'third']);
  releases.shift()();
  await Promise.all([first, second, third]);
  await queue.waitForIdle();
  assert.deepEqual(queue.diagnostics(), {
    sequence: 3,
    lastSuccessfulSequence: 3,
    inFlight: 0,
    pending: 0,
    parallelInFlight: 0,
  });
});

test('latest save queue retries the newest failed snapshot once', async () => {
  let attempts = 0;
  const queue = new LatestSaveQueue(async (value) => {
    attempts += 1;
    if (attempts === 1) throw new Error('temporary');
    return { value };
  }, { maxRetryAttempts: 1 });
  const result = await queue.enqueue('current', { key: 'current', scope: 'project' });
  assert.equal(result.value, 'current');
  assert.equal(attempts, 2);
});
