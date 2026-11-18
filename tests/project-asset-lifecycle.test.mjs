import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

let env, store, createProject, api, library, graph, cleanup, history, snapshots, assetStore;
let trashed, copied;
before(async () => {
  env = await createRendererEnv({ storage: new Map(), withWindow: true });
  ({ store } = await env.load('store/projectStore'));
  ({ createProject } = await env.load('store/projectNormalization'));
  ({ desktopApi: api } = await env.load('services/desktopApi'));
  library = await env.load('store/localAssetLibraryStore');
  graph = await env.load('store/canvasGraphStore');
  cleanup = await env.load('services/projectAssetCleanup');
  history = await env.load('store/canvasHistoryStore');
  snapshots = await env.load('services/projectSnapshotService');
  assetStore = await env.load('store/assetStore');
});
after(async () => env?.dispose());
beforeEach(async () => {
  store.project = createProject();
  store.projectDir = '/project-a';
  store.project.library = { enabled: true, assetRootDir: '/legacy/shared/assets' };
  trashed = []; copied = [];
  api.file.pathExists = async () => true;
  api.file.copyToDirectory = async (source, directory, name) => {
    copied.push({ source, directory });
    return { path: directory + '/' + name };
  };
  api.file.trash = async path => { trashed.push(path); return { ok: true }; };
  api.project.snapshotList = async () => [];
  api.project.snapshotRead = async () => null;
  api.project.getEditorMediaState = async () => [];
  await api.localAssets.setCatalog({
    storageVersion: 1,
    materials: [{ id: 'global-m', path: '/global/hero.png', name: 'hero.png', storageScope: 'library' }],
    assets: [{ id: 'global-a', materialId: 'global-m' }], references: [],
  });
});
const card = { localLibraryAssetId: 'global-a' };
async function seedNode() {
  const { material, asset } = await library.useLocalAssetInProject(card);
  const node = { id: 'n1', type: 'imageGeneration', uploadedFile: { materialId: material.id, path: material.path } };
  store.project.nodes.push(node);
  return { material, asset, node };
}
async function clean() {
  await cleanup.cleanupProjectAssets(store.project, store.projectDir, () => true, () => {});
}

test('global originals are copied into each project; repeat use reuses its own copy', async () => {
  const a = await library.useLocalAssetInProject(card, { copy: false });
  const again = await library.useLocalAssetInProject(card);
  assert.equal(a.material.id, again.material.id);
  assert.equal(a.material.path, '/project-a/assets/hero.png');
  assert.equal(a.referenced, false);
  store.project = createProject(); store.projectDir = '/project-b';
  const b = await library.useLocalAssetInProject(card);
  assert.equal(b.material.path, '/project-b/assets/hero.png');
  assert.notEqual(a.material.id, b.material.id);
  assert.equal(copied.length, 2);
  assert.equal((await api.localAssets.getCatalog()).references.length, 0);
});

test('last node deletion detaches its copy and cleanup trashes only that project file', async () => {
  const { material } = await seedNode();
  assert.equal(graph.deleteCanvasNodeData('n1'), true);
  assert.equal(store.project.materials.length, 0);
  assert.equal(store.project.assets.length, 0);
  assert.equal(trashed.length, 0, 'filesystem cleanup waits for the save boundary');
  await clean();
  assert.deepEqual(trashed, [material.path]);
  assert.deepEqual(store.project.pendingAssetCleanup, []);
});

test('another node, editor or director reference retains the file until its last use disappears', async () => {
  const { material } = await seedNode();
  store.project.nodes.push({ id: 'n2', generatedOutputs: [{ materialId: material.id }] });
  graph.deleteCanvasNodeData('n1');
  await clean();
  assert.equal(trashed.length, 0);
  graph.deleteCanvasNodeData('n2');
  store.project.videoEditor = { assets: [{ sourceFile: material.path }] };
  cleanup.reconcilePendingProjectAssets(store.project);
  await clean();
  assert.equal(trashed.length, 0);
  store.project.videoEditor = {};
  store.project.directorDocument = { objects: [{ texture: 'file://' + material.path }] };
  cleanup.reconcilePendingProjectAssets(store.project);
  await clean();
  assert.equal(trashed.length, 0);
  store.project.directorDocument = {};
  cleanup.reconcilePendingProjectAssets(store.project);
  await clean();
  assert.deepEqual(trashed, [material.path]);
});

test('undo restores node and material without a missing file; history expiry permits cleanup', async () => {
  const { material } = await seedNode();
  history.recordCanvasHistory('delete');
  graph.deleteCanvasNodeData('n1');
  await clean();
  assert.equal(trashed.length, 0);
  history.undoCanvas();
  assert.equal(store.project.nodes[0].id, 'n1');
  assert.ok(store.project.materials.some(m => m.id === material.id));
  graph.deleteCanvasNodeData('n1');
  store.project.canvasHistory = []; store.project.canvasRedoStack = [];
  await clean();
  assert.deepEqual(trashed, [material.path]);
});

test('snapshot references, unreadable history and trash failures retain a retry record', async () => {
  const { material } = await seedNode();
  graph.deleteCanvasNodeData('n1');
  api.project.snapshotList = async () => [{ id: 's', mediaRefs: [material.id] }];
  await clean();
  assert.equal(trashed.length, 0);
  api.project.snapshotList = async () => [{ id: 's', mediaRefs: [] }];
  await clean(); // Missing payload cannot establish absence of a path reference.
  assert.equal(trashed.length, 0);
  api.project.snapshotList = async () => [];
  api.file.trash = async () => ({ ok: false });
  await clean();
  assert.equal(store.project.pendingAssetCleanup.length, 1);
});

test('legacy shared/external files have no automatic deletion ownership', async () => {
  store.project.materials = [{ id: 'old', path: '/legacy/shared/assets/a.png', storageScope: 'library' }];
  store.project.nodes = [{ id: 'n1', materialId: 'old' }];
  graph.deleteCanvasNodeData('n1');
  await clean();
  assert.equal(store.project.materials.length, 1);
  assert.equal(trashed.length, 0);
});

test('editor database and its history protect files even outside the project JSON', async () => {
  const { material } = await seedNode();
  graph.deleteCanvasNodeData('n1');
  api.project.getEditorMediaState = async () => [{ undo: [{ sourceFile: material.path }] }];
  await clean();
  assert.equal(trashed.length, 0);
  api.project.getEditorMediaState = async () => [];
  await clean();
  assert.deepEqual(trashed, [material.path]);
});

test('only candidates included in the completed save may be trashed', async () => {
  await seedNode(); graph.deleteCanvasNodeData('n1');
  await cleanup.cleanupProjectAssets(store.project, store.projectDir, () => true, () => {}, new Set());
  assert.equal(trashed.length, 0);
});

test('unflushed live editor changes protect files before any database write', async () => {
  const { material } = await seedNode();
  graph.deleteCanvasNodeData('n1');
  const { registerClipSnapshotReader } = await env.load('services/clipSnapshotStore');
  const unregister = registerClipSnapshotReader(store.projectDir, 'editor-1',
    async () => ({ assets: [{ sourceFile: material.path }] }));
  try {
    await clean();
    assert.equal(trashed.length, 0);
  } finally { unregister(); }
  await clean();
  assert.deepEqual(trashed, [material.path]);
});

test('manual material deletion protects path-only timeline uses and unreadable history', async () => {
  const { material } = await seedNode();
  store.project.nodes = [];
  store.project.videoEditor = { assets: [{ sourceFile: material.path }] };
  assert.equal((await assetStore.deleteMaterialFile(material.id)).ok, false);
  store.project.videoEditor = {};
  api.project.snapshotList = async () => { throw new Error('history unavailable'); };
  assert.equal((await assetStore.deleteMaterialFile(material.id)).ok, false);
  assert.equal(trashed.length, 0);
});

test('project switch during reference verification cancels cleanup', async () => {
  await seedNode();
  graph.deleteCanvasNodeData('n1');
  let current = true;
  api.project.snapshotList = async () => { current = false; return []; };
  await cleanup.cleanupProjectAssets(store.project, store.projectDir, () => current, () => {});
  assert.equal(trashed.length, 0);
});

test('snapshots do not carry cleanup jobs into restored historical projects', async () => {
  const { snapshotPayload } = await env.load('domain/snapshots/SnapshotPolicy');
  assert.equal('pendingAssetCleanup' in snapshotPayload({ nodes: [], pendingAssetCleanup: [{ id: 'm' }] }), false);
});

test('successful project save automatically runs queued cleanup', async () => {
  const { material } = await seedNode();
  graph.deleteCanvasNodeData('n1');
  const save = api.project.save;
  let savedBeforeTrash = false;
  api.project.save = async (directory, project) => {
    assert.equal(project.nodes.length, 0);
    assert.equal(project.materials.length, 0);
    assert.equal(project.pendingAssetCleanup[0].id, material.id);
    savedBeforeTrash = true;
    return { filePath: directory + '/project.sqlite', project };
  };
  api.file.trash = async path => {
    assert.equal(savedBeforeTrash, true);
    trashed.push(path); return { ok: true };
  };
  try {
    const { saveProject } = await env.load('store/projectStore');
    await saveProject();
    assert.deepEqual(trashed, [material.path]);
  } finally { api.project.save = save; }
});
