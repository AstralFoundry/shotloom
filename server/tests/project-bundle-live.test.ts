import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
process.env.NODE_ENV = 'test';

test('project bundle imports editor data atomically, isolates tenants and never overwrites existing projects', {
  skip: process.env.SHOTLOOM_LIVE_TESTS !== '1',
}, async () => {
  const { admin, upsertUser } = await import('../src/lib/supabase');
  const store = await import('../src/lib/store');
  const owner = await upsertUser(`bundle-${randomUUID()}`, { username: 'Bundle integration test' });
  const other = await upsertUser(`bundle-${randomUUID()}`, { username: 'Bundle tenant test' });
  const id = randomUUID();
  const failedId = randomUUID();
  const bundle = { project: { schema: 'shotloom-project', schemaVersion: 2, name: 'Portable', nodes: [{ id: 'clip' }] },
    snapshots: [{ nodeId: 'clip', payload: { tracks: [{ id: 'track' }] } }],
    records: Array.from({ length: 1105 }, (_, i) => ({ nodeId: 'clip', key: `item-${i}`, payload: { i } })),
  };
  try {
    const saved = await store.importProjectBundle(owner.id, id, bundle) as { id: string; storageRevision: number };
    assert.equal(saved.id, id); assert.equal(saved.storageRevision, 1);
    const loaded = await store.loadProjectBundle(owner.id, id) as { snapshots: unknown[]; records: unknown[] };
    assert.deepEqual(loaded.snapshots, bundle.snapshots); assert.equal(loaded.records.length, 1105);
    await assert.rejects(store.loadProjectBundle(other.id, id), /无权/);
    await assert.rejects(store.importProjectBundle(owner.id, id, bundle), /新的工程/);
    await assert.rejects(store.importProjectBundle(owner.id, failedId, { ...bundle, snapshots: [bundle.snapshots[0]!, bundle.snapshots[0]!] }), /重复/);
    assert.equal(await store.loadProject(owner.id, failedId), null);
    assert.equal((await admin.from('editor_snapshots').select('node_id').eq('project_id', failedId)).data?.length, 0);
  } finally {
    const cleanup = await admin.from('users').delete().in('id', [owner.id, other.id]);
    assert.equal(cleanup.error, null);
  }
});
