import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';

process.env.NODE_ENV = 'test';

test('live Supabase graph commits, conflicts, ownership and Storage signatures', { skip: process.env.SHOTLOOM_LIVE_TESTS !== '1' }, async () => {
  const { admin, upsertUser, resolveBucket, scopedKey, createSignedUploadUrl, createSignedUrl, createSession } = await import('../src/lib/supabase');
  const store = await import('../src/lib/store');
  const owner = await upsertUser(`test-${randomUUID()}`, { username: 'Shotloom integration test' });
  const other = await upsertUser(`test-${randomUUID()}`, { username: 'Shotloom isolation test' });
  const projectId = randomUUID();
  const objectPath = scopedKey(owner.id, `test-${randomUUID()}.png`);
  const bucket = resolveBucket('media');
  try {
    const { app } = await import('../src/index');
    const session = await createSession(owner.id, { accessToken: 'test-not-sent-to-gateway', expiresAt: Date.now() + 3600_000 });
    const mismatch = await app.request('/api/settings', { method: 'PUT', headers: {
      origin: process.env.FRONTEND_URL!, cookie: `${process.env.COOKIE_NAME || 'shotloom_session'}=${session}`,
      'x-shotloom-user': other.id, 'content-type': 'application/json',
    }, body: '{}' });
    assert.equal(mismatch.status, 409);
    assert.equal((await mismatch.json()).code, 'ACCOUNT_CHANGED');
    const nativeMismatch = await app.request('/api/relay/chat/completions', { method: 'POST', headers: {
      authorization: `Bearer ${session}`, 'x-shotloom-user': other.id, 'content-type': 'application/json',
    }, body: '{}' });
    assert.equal(nativeMismatch.status, 409);
    assert.equal((await nativeMismatch.json()).code, 'ACCOUNT_CHANGED');
    assert.equal((await app.request('/api/settings', { method: 'PUT', headers: { authorization: `Bearer ${session}` }, body: '{}' })).status, 403);
    const first = await store.saveProject(owner.id, projectId, { name: 'Integration test', nodes: [{ id: 'first' }], storageRevision: 0 });
    assert.equal((first as { storageRevision: number }).storageRevision, 1);
    assert.deepEqual((await store.loadProject(owner.id, projectId) as { nodes: unknown[] }).nodes, [{ id: 'first' }]);
    assert.equal(await store.loadProject(other.id, projectId), null);
    await assert.rejects(store.saveProject(other.id, projectId, { nodes: [], storageRevision: 1 }), /无权/);
    await assert.rejects(store.saveProject(owner.id, projectId, { nodes: [{ id: 'stale' }], storageRevision: 0 }), /修改/);
    await assert.rejects(store.saveProject(owner.id, projectId, { nodes: [{ id: 'duplicate' }, { id: 'duplicate' }], storageRevision: 1 }));
    const unchanged = await store.loadProject(owner.id, projectId) as { nodes: unknown[]; storageRevision: number };
    assert.deepEqual(unchanged.nodes, [{ id: 'first' }]);
    assert.equal(unchanged.storageRevision, 1);
    const race = await Promise.allSettled([
      store.saveProject(owner.id, projectId, { name: 'A', nodes: [{ id: 'A' }], storageRevision: 1 }),
      store.saveProject(owner.id, projectId, { name: 'B', nodes: [{ id: 'B' }], storageRevision: 1 }),
    ]);
    assert.equal(race.filter(value => value.status === 'fulfilled').length, 1);
    assert.equal(race.filter(value => value.status === 'rejected').length, 1);
    await Promise.all(Array.from({ length: 8 }, (_, revision) => store.saveSnapshot(projectId, 'editor', { revision })));
    const snapshot = await admin.from('editor_snapshots').select('revision').eq('project_id', projectId).eq('node_id', 'editor').single();
    assert.equal(snapshot.error, null);
    assert.equal(snapshot.data!.revision, 8);
    const many = Array.from({ length: 1105 }, (_, i) => ({ id: `asset-${i}` }));
    await store.saveCatalog(owner.id, 'assets', { storageVersion: 1, references: ['kept'], assets: many, materials: [{ id: 'material' }] });
    assert.deepEqual(await store.loadCatalog(owner.id, 'assets', {}), {
      storageVersion: 1, references: ['kept'], assets: many, materials: [{ id: 'material' }],
    });
    await assert.rejects(store.saveCatalog(owner.id, 'assets', { assets: [], materials: [{ id: 'same' }, { id: 'same' }] }));
    assert.equal(((await store.loadCatalog(owner.id, 'assets', {})) as { assets: unknown[] }).assets.length, 1105);
    assert.deepEqual(await store.loadCatalog(other.id, 'assets', { empty: true }), { empty: true });
    await store.saveProject(owner.id, projectId, { nodes: many, storageRevision: 2 });
    assert.equal(((await store.loadProject(owner.id, projectId)) as { nodes: unknown[] }).nodes.length, 1105);
    const folder = await admin.from('library_folders').insert({ user_id: owner.id, name: 'Test folder' }).select('id').single();
    assert.equal(folder.error, null);
    const childId = randomUUID();
    await store.saveProject(owner.id, childId, { cloudFolderId: folder.data!.id, nodes: [] });
    await assert.rejects(store.saveProject(other.id, randomUUID(), { cloudFolderId: folder.data!.id, nodes: [] }));
    const deleted = await admin.from('library_folders').delete().eq('id', folder.data!.id);
    assert.equal(deleted.error, null);
    assert.equal(await store.loadProject(owner.id, childId), null);
    const url = await createSignedUploadUrl(bucket, objectPath);
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+y7bcAAAAASUVORK5CYII=', 'base64');
    const upload = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: bytes });
    assert.equal(upload.ok, true, `Storage upload status ${upload.status}`);
    const read = await fetch(await createSignedUrl(bucket, objectPath, 60));
    assert.equal(read.status, 200);
    assert.equal((await read.arrayBuffer()).byteLength, bytes.length);
    const publicRead = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/public/${bucket}/${objectPath}`);
    assert.notEqual(publicRead.status, 200);
    const { data: leaked } = await admin.from('projects').select('id, client_id').eq('id', projectId).single();
    assert.equal(leaked?.client_id, process.env.GATEWAY_CLIENT_ID);
  } finally {
    const results = await Promise.all([
      admin.storage.from(bucket).remove([objectPath]),
      admin.from('users').delete().in('id', [owner.id, other.id]),
    ]);
    for (const result of results) assert.equal(result.error, null, 'Integration test cleanup failed');
  }
});
