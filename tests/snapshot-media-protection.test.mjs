/**
 * 快照媒体引用保护：历史版本引用的素材，删除前必须拦住。
 *
 * 快照只存引用不复制文件，所以「删除素材」会顺带毁掉旧版本的可恢复性。
 * 保护依赖快照元数据里的 `mediaRefs`，删除时不必逐个反序列化 payload。
 */
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

let env;
let policy;
let service;
let assetStore;
let store;

const storage = new Map();
const DIRECTORY = 'browser/projects/snapshot-media-test';

before(async () => {
  env = await createRendererEnv({ storage, withWindow: true });
  policy = await env.load('domain/snapshots/SnapshotPolicy');
  service = await env.load('services/projectSnapshotService');
  assetStore = await env.load('store/assetStore');
  ({ store } = await env.load('store/projectStore'));
});

beforeEach(() => {
  service.resetProjectSnapshotCache();
  storage.clear();
});

after(async () => {
  await env?.dispose();
});

function seedProject(materials = [{ id: 'm1', name: '参考图', path: '/tmp/a.png' }]) {
  store.projectDir = DIRECTORY;
  store.project = {
    ...store.project,
    id: 'project-media',
    materials,
    assets: [],
    nodes: [],
    edges: [],
    tasks: [],
  };
}

test('mediaRefs 收集素材表与节点引用，并去重', () => {
  const refs = policy.snapshotMediaRefs({
    materials: [{ id: 'm1' }, { id: 'm2' }, { id: 'm1' }],
    nodes: [
      { id: 'n1', materialId: 'm2' },
      { id: 'n2', uploadedFile: { materialId: 'm3' } },
      { id: 'n3', generatedOutputs: [{ materialId: 'm4' }, { materialId: 'm3' }] },
      { id: 'n4' },
    ],
  });
  assert.deepEqual(refs.sort(), ['m1', 'm2', 'm3', 'm4']);
});

test('快照元数据带上 mediaRefs，列表不需要 payload 就能判断引用', async () => {
  const record = await service.captureProjectSnapshot(
    DIRECTORY,
    { name: '带素材的项目', materials: [{ id: 'm1' }], nodes: [], edges: [], tasks: [] },
    { reason: 'manual', force: true },
  );
  assert.deepEqual(record.mediaRefs, ['m1']);

  const [meta] = await service.listProjectSnapshots(DIRECTORY);
  assert.deepEqual(meta.mediaRefs, ['m1']);
  assert.equal(await service.materialReferencedBySnapshots(DIRECTORY, 'm1'), true);
  assert.equal(await service.materialReferencedBySnapshots(DIRECTORY, 'm-other'), false);
});

test('删除被历史版本引用的素材：拒绝并保留记录', async () => {
  seedProject([{ id: 'm1', name: '参考图', path: '/tmp/a.png' }]);
  await service.captureProjectSnapshot(
    DIRECTORY,
    { name: '旧版本', materials: [{ id: 'm1', path: '/tmp/a.png' }], nodes: [], edges: [], tasks: [] },
    { reason: 'manual', force: true },
  );

  const result = await assetStore.deleteMaterialFile('m1');

  assert.equal(result.ok, false);
  assert.match(String(result.error), /历史版本/);
  assert.equal(store.project.materials.some((material) => material.id === 'm1'), true);
});

test('未被历史版本引用的素材仍可删除', async () => {
  seedProject([
    { id: 'm1', name: '参考图', path: '/tmp/a.png' },
    { id: 'm2', name: '临时图', path: '/tmp/b.png' },
  ]);
  await service.captureProjectSnapshot(
    DIRECTORY,
    { name: '旧版本', materials: [{ id: 'm1', path: '/tmp/a.png' }], nodes: [], edges: [], tasks: [] },
    { reason: 'manual', force: true },
  );

  const result = await assetStore.deleteMaterialFile('m2');

  assert.equal(result.ok, true);
  assert.equal(store.project.materials.some((material) => material.id === 'm2'), false);
});
