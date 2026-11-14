import test from 'node:test';
import assert from 'node:assert/strict';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

test('交付镜头表限定实际导出区间，保留源时码与视频相对时码，指定机位时不伪报切镜', async () => {
  const env = await createRendererEnv();
  try {
    const { deliveryShots } = await env.loadVendor('shotloom-director-desk/src/core/exporting/delivery-package.ts');
    const project = { duration: 15, entities: [{ id: 'a', name: 'A', camera: {} }, { id: 'b', name: 'B', camera: {} }], cuts: [{ time: 0, cameraId: 'a' }, { time: 5, cameraId: 'b' }, { time: 10, cameraId: 'a' }] };
    const shots = deliveryShots(project, { start: 3, end: 8, cameraId: 'program' });
    assert.deepEqual(shots.map(s => [s.startSec, s.endSec, s.videoStartSec, s.videoEndSec]), [[3, 5, 0, 2], [5, 8, 2, 5]]);
    const fixed = deliveryShots(project, { start: 3, end: 8, cameraId: 'b' });
    assert.equal(fixed.length, 1); assert.equal(fixed[0].cameraId, 'b'); assert.equal(fixed[0].videoEndSec, 5);
  } finally { await env.dispose(); }
});

test('浏览器存储不可用时保留可读取的产物并明确警告，清理内存产物不依赖存储', async () => {
  const env = await createRendererEnv();
  try {
    const { ExportArtifacts } = await env.loadVendor('shotloom-director-desk/src/core/exporting/artifacts.ts');
    const artifacts = new ExportArtifacts();
    const saved = await artifacts.retain('project', new Blob(['video']), 'test.mp4', 'video', { document: { private: true }, width: 640 });
    assert.equal(saved.persistence, 'memory'); assert.match(saved.storageWarning, /关闭页面前/);
    assert.equal(saved.metadata.document, undefined);
    assert.equal((await artifacts.read('project', saved.id)).bytes, 5);
    await assert.rejects(artifacts.read('other', saved.id), /当前工程/);
    assert.equal((await artifacts.remove('project', saved.id)).removed, true);
    assert.deepEqual(await artifacts.list('project'), []);
  } finally { await env.dispose(); }
});
