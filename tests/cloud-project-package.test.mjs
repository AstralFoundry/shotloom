import assert from 'node:assert/strict';
import test from 'node:test';
import { zipSync, strToU8 } from 'fflate';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

test('portable project ZIP carries deduplicated media and editor data without rewriting user prose', async () => {
  const env = await createRendererEnv({ storageMode: 'cloud' });
  try {
    const { exportProjectPackage, readProjectPackage, mapProjectMedia } = await env.load('services/cloudProjectPackage');
    const source = 'cloud://media/clip.mp4';
    const bundle = { project: { schema: 'shotloom-project', schemaVersion: 2, nodes: [
      { id: 'video', filePath: source, prompt: source },
    ] }, snapshots: [{ nodeId: 'editor', payload: { sourceFile: source } }], records: [{ nodeId: 'editor', key: 'state', payload: { path: source } }] };
    let reads = 0;
    const zip = await exportProjectPackage(bundle, async path => {
      reads++; assert.equal(path, source); return new Blob(['video-bytes'], { type: 'video/mp4' });
    });
    assert.equal(reads, 1);
    const restored = await readProjectPackage(zip);
    const media = restored.bundle.project.nodes[0].filePath;
    assert.match(media, /^package:\/\/media\/[a-f0-9-]+\.mp4$/);
    assert.equal(restored.bundle.project.nodes[0].prompt, source);
    assert.equal(restored.bundle.snapshots[0].payload.sourceFile, media);
    assert.equal(await restored.files.get(media.slice('package://'.length)).text(), 'video-bytes');
    const mapped = await mapProjectMedia(restored.bundle, async () => 'cloud://media/new.mp4');
    assert.equal(mapped.records[0].payload.path, 'cloud://media/new.mp4');
    assert.equal(bundle.project.nodes[0].filePath, source);
  } finally { await env.dispose(); }
});

test('portable import rejects unsafe entries, unsupported versions and malformed editor rows', async () => {
  const env = await createRendererEnv({ storageMode: 'cloud' });
  try {
    const { readProjectPackage, projectBundle } = await env.load('services/cloudProjectPackage');
    for (const name of ['../outside.png', 'media/../outside', 'media/..', '/absolute']) {
      await assert.rejects(readProjectPackage(new Blob([zipSync({ [name]: strToU8('no') })])), /不安全/);
    }
    await assert.rejects(readProjectPackage(new Blob([zipSync({ 'manifest.json': strToU8('{"schema":"shotloom-project-package","version":1}') })])), /版本不受支持/);
    assert.throws(() => projectBundle({ project: { schema: 'shotloom-project', schemaVersion: 2, nodes: [] }, snapshots: [null], records: [] }), /结构无效/);
  } finally { await env.dispose(); }
});

test('director model package filenames remain internal during portable export and import', async () => {
  const env = await createRendererEnv({ storageMode: 'cloud' });
  try {
    const { exportProjectPackage, readProjectPackage, mapProjectMedia } = await env.load('services/cloudProjectPackage');
    const model = { version: 1, format: 'gltf', entry: 'model.gltf', files: [{ path: 'model.gltf', data: 'e30=' }, { path: 'textures/albedo.png', data: 'aW1hZ2U=' }] };
    const bundle = { project: { schema: 'shotloom-project', schemaVersion: 2, nodes: [{ id: 'director', directorData: { project: { resources: [{ id: `model-${'a'.repeat(64)}`, package: model }] } } }] }, snapshots: [], records: [] };
    const rejectExternalRead = async path => { assert.fail(`Model-internal file must not be treated as project media: ${path}`); };
    const zip = await exportProjectPackage(bundle, rejectExternalRead);
    const restored = await readProjectPackage(zip);
    const mapped = await mapProjectMedia(restored.bundle, rejectExternalRead);
    assert.deepEqual(JSON.parse(JSON.stringify(mapped.project)), bundle.project);
  } finally { await env.dispose(); }
});
