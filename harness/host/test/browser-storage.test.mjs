import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { browserPersistence } from '../browser/persistence.mjs';
import { createDurableVfsSink } from '../browser/durable-vfs.mjs';

test('durable sink copies changed bytes and prevents side effects after a failed commit', async () => {
  const batches = [];
  let fail = false, failures = 0;
  const sink = createDurableVfsSink({ commit: async rows => { if (fail) throw new Error('quota'); batches.push(rows); }, onFailure: () => failures++ });
  const bytes = new Uint8Array([1, 2]);
  sink.record({ kind: 'write', path: '/dsh/state/first', bytes }); bytes[0] = 9;
  await sink.barrier();
  assert.deepEqual([...batches[0][0].data], [1, 2]);
  sink.record({ kind: 'write', path: '/dsh/state/second', bytes });
  await sink.barrier();
  assert.equal(batches[1].length, 1);
  fail = true; sink.record({ kind: 'remove', path: '/dsh/state/first' });
  await assert.rejects(sink.barrier(), /quota/);
  fail = false;
  await assert.rejects(sink.barrier(), /quota/);
  assert.equal(failures, 1);
});

test('Worker persistence serializes concurrent records and never reclaims an uncertain mutation', async t => {
  const root = await mkdtemp(join(tmpdir(), 'shotloom-worker-store-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const original = globalThis.shotloomBrowserHost;
  globalThis.shotloomBrowserHost = { barrier: async () => {} };
  t.after(() => { globalThis.shotloomBrowserHost = original; });
  let store = browserPersistence(root);
  await store.domain.create({ name: 'workspace', tables: ['sessions'], version: 1 });
  await Promise.all(Array.from({ length: 12 }, (_, index) => store.domain.put('workspace', 'sessions', String(index), { index })));
  assert.equal((await store.domain.records('workspace')).length, 12);
  assert.equal(await store.host.claimReceipt('write-once'), true);
  store = browserPersistence(root);
  assert.equal(await store.host.claimReceipt('write-once'), false);
  assert.equal((await store.host.receipt('write-once')).status, 'dispatching');
  await store.host.settleReceipt('write-once', { success: true });
  assert.deepEqual((await browserPersistence(root).host.receipt('write-once')).payload, { success: true });
  const header = { id: 'session-a' };
  await store.sessions.create(header, 0);
  await store.sessions.append(header.id, [{ seq: 0, type: 'first' }, { seq: 1, type: 'second' }], 0);
  assert.deepEqual(await browserPersistence(root).sessions.read(header.id, 1, 1), [{ seq: 1, type: 'second' }]);
  await assert.rejects(store.sessions.append(header.id, [], 0), /revision conflict/);
});
