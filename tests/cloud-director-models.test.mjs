import assert from 'node:assert/strict';
import test from 'node:test';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

test('director model objects survive a fresh client, retain portable exports and reuse immutable uploads', async () => {
  const env = await createRendererEnv();
  try {
    const { createCloudDirectorModels } = await env.load('services/cloudDirectorModels');
    const objects = new Map();
    let writes = 0;
    const upload = async blob => { const filePath = `cloud://media/${++writes}.json`; objects.set(filePath, blob); return { filePath }; };
    const read = async path => { assert(objects.has(path)); return objects.get(path); };
    const resource = { id: `model-${'a'.repeat(64)}`, name: 'Triangle', package: { version: 1, format: 'gltf', entry: 'triangle.gltf', files: [{ path: 'triangle.gltf', data: 'e30=' }] } };
    const project = { nodes: [{ directorData: { project: { format: 'director-desk', version: 3, scenes: [{ state: { resources: [resource] } }] } } }], directorWorkspaceProject: { resources: [resource] } };
    const original = structuredClone(project);
    const first = createCloudDirectorModels(upload, read);
    const stored = await first.save(project);
    assert.equal(writes, 1, 'the same package in workspace and node is uploaded once');
    assert.equal(stored.directorWorkspaceProject.resources[0].package.storage, 'shotloom-director-model');
    assert.equal(JSON.stringify(stored).includes('e30='), false);
    assert.deepEqual(project, original, 'serialization never replaces the live runtime package');

    const nextClient = createCloudDirectorModels(upload, read);
    const restored = await nextClient.load(structuredClone(stored));
    assert.deepEqual(restored, original, 'a new client restores all package bytes for scene loading and portable export');
    assert.deepEqual(await nextClient.save(restored), stored);
    assert.equal(writes, 1, 'loading then editing scene metadata must not upload an unchanged model again');

    const reference = stored.directorWorkspaceProject.resources[0].package;
    await assert.rejects(createCloudDirectorModels(upload, async () => new Blob(['corrupt'])).load(stored), /校验失败/);
    const foreign = structuredClone(stored);
    foreign.directorWorkspaceProject.resources[0].package.path = 'https://untrusted.example/model.json';
    await assert.rejects(nextClient.load(foreign), /存储引用无效/);
    assert(reference.sha256.length === 64);
  } finally { await env.dispose(); }
});

test('failed model uploads can be retried without saving a dangling reference', async () => {
  const env = await createRendererEnv();
  try {
    const { createCloudDirectorModels } = await env.load('services/cloudDirectorModels');
    let attempts = 0;
    const codec = createCloudDirectorModels(async () => {
      if (++attempts === 1) throw new Error('upload failed');
      return { filePath: 'cloud://media/retried.json' };
    }, async () => { throw new Error('unexpected read'); });
    const resource = { id: `model-${'b'.repeat(64)}`, package: { version: 1, format: 'obj', entry: 'model.obj', files: [] } };
    await assert.rejects(codec.save(resource), /upload failed/);
    assert.equal((await codec.save(resource)).package.path, 'cloud://media/retried.json');
    assert.equal(attempts, 2);
  } finally { await env.dispose(); }
});
