import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

let env, store, createProject, categories, saveToAssets, collections, library, api, applyMaterialToCanvas, written;
before(async () => {
  env = await createRendererEnv({ storage: new Map(), withWindow: true });
  ({ store } = await env.load('store/projectStore'));
  ({ createProject } = await env.load('store/projectNormalization'));
  categories = await env.load('domain/asset/assetCategories');
  ({ saveToAssets } = await env.load('app/adapters/canvas/canvasMediaActions'));
  ({ nodeAssetCollections: collections } = await env.load('app/adapters/canvas/canvasMediaSelection'));
  library = await env.load('store/localAssetLibraryStore');
  ({ desktopApi: api } = await env.load('services/desktopApi'));
  ({ applyMaterialToCanvas } = await env.load('store/assetStore'));
  api.file.pathExists = async () => true;
  api.file.checksum = async path => ({ checksum: Buffer.from(path).toString('hex').padEnd(64, '0'), size: 12 });
  api.file.getGlobalAssetRoot = async () => '/global/assets';
  api.file.saveDataUrlToProject = async data => {
    written.push(Buffer.from(data.split(',')[1], 'base64').toString('utf8'));
    return { path: `/proj/assets/text-${written.length}.txt`, name: 'text.txt' };
  };
});
after(async () => env?.dispose());
function reset(node) {
  store.project = createProject();
  store.project.library = { assetRootDir: '/proj/assets' };
  store.projectDir = '/proj';
  store.project.nodes = [node];
  localStorage.removeItem('shotloom-local-assets');
  library.localAssetLibrary.loaded = false;
  library.localAssetLibrary.catalog = { materials: [], assets: [], references: [] };
  written = [];
  return store.project.nodes[0];
}
function audio() {
  return { id: 'audio', type: 'audioGeneration', artifactType: 'voice', title: '角色对白', selectedOutputNodeId: 'v1',
    generatedOutputs: [{ id: 'v1', filePath: '/proj/assets/v1.wav', resourceType: 'audio' }, { id: 'v2', filePath: '/proj/assets/v2.wav', resourceType: 'audio' }] };
}

test('one purpose catalog preserves old category aliases and includes audio uses without guessing from media type', async () => {
  const { CANVAS_ARTIFACT_TYPES, canvasArtifactType } = await env.load('services/agentTypes');
  assert.deepEqual(categories.assetCategories.map(c => c.purpose), [...CANVAS_ARTIFACT_TYPES]);
  const { default: contract } = await env.load('config/agent-action-contract.json');
  assert.deepEqual(contract.commonProperties.artifactType.enum, [...CANVAS_ARTIFACT_TYPES]);
  for (const value of ['voice', 'music', 'soundEffect']) assert.equal(canvasArtifactType(value), value);
  assert.equal(categories.assetCategoryFor('actors').id, 'characters');
  assert.equal(categories.assetCategoryFor('costumes').id, 'other');
  assert.equal(categories.assetCategoryFor(undefined).id, 'other');
  assert.equal(canvasArtifactType('style'), 'other');
  assert.equal(categories.assetCategoryFor('styles').id, 'other');
  assert.ok(!categories.assetCategories.some(category => category.id === 'styles'));
  assert.equal(canvasArtifactType('not-a-purpose'), 'other');
});

test('collection inherits purpose, edits only the chosen asset, and a new selected result gets a separate collection', async () => {
  const node = reset(audio());
  await saveToAssets(node.id, 'project', '');
  assert.equal(store.project.assets.length, 1);
  const first = store.project.assets[0];
  assert.equal(first.category, 'voice');
  assert.equal(collections(store.project, node, library.localAssetLibrary.catalog).project.id, first.id);
  node.artifactType = 'music';
  assert.equal(first.category, 'voice');
  await saveToAssets(node.id, 'project', 'soundEffects');
  assert.equal(store.project.assets.length, 1);
  assert.equal(first.category, 'soundEffects');
  assert.equal(node.artifactType, 'music');
  node.selectedOutputNodeId = 'v2';
  assert.equal(collections(store.project, node, library.localAssetLibrary.catalog).project, null);
  await saveToAssets(node.id, 'project', '');
  assert.equal(store.project.assets.length, 2);
  assert.equal(first.category, 'soundEffects');
  const firstMaterial = store.project.materials.find(m => m.id === first.materialId);
  assert.equal(firstMaterial.path, '/proj/assets/v1.wav');
});

test('project and global collections are independent; global classification edits persist without duplicates', async () => {
  const node = reset(audio());
  await saveToAssets(node.id, 'project', 'voice');
  await saveToAssets(node.id, 'global', 'music');
  let found = collections(store.project, node, library.localAssetLibrary.catalog);
  assert.equal(found.project.category, 'voice');
  assert.equal(found.global.category, 'music');
  await saveToAssets(node.id, 'global', 'soundEffects');
  await library.loadLocalAssetLibrary(true);
  found = collections(store.project, node, library.localAssetLibrary.catalog);
  assert.equal(found.global.category, 'soundEffects');
  assert.equal(found.project.category, 'voice');
  assert.equal(library.localAssetLibrary.catalog.assets.length, 1);
  node.selectedOutputNodeId = 'v2';
  assert.equal(collections(store.project, node, library.localAssetLibrary.catalog).global, null);
});

test('text collection writes an immutable UTF-8 version, and applying assets carries purpose to a new node', async () => {
  const node = reset({ id: 'text', type: 'textGeneration', artifactType: 'storyboard', title: '剧本', textContent: '第一场：你好，世界。' });
  await saveToAssets(node.id, 'project', '');
  const first = store.project.assets[0];
  assert.ok(first);
  assert.equal(first.category, 'shots');
  assert.deepEqual(written, ['第一场：你好，世界。']);
  await saveToAssets(node.id, 'project', 'shots');
  assert.equal(written.length, 1);
  node.textContent = '第二场：再见。';
  assert.equal(collections(store.project, node, library.localAssetLibrary.catalog).project, null);
  await saveToAssets(node.id, 'project', '');
  assert.equal(store.project.assets.length, 2);
  assert.deepEqual(written, ['第一场：你好，世界。', '第二场：再见。']);
  const material = store.project.materials.find(m => m.id === first.materialId);
  const restored = applyMaterialToCanvas({ ...material, category: first.category });
  assert.equal(restored.artifactType, 'storyboard');
  assert.equal(restored.textContent, '第一场：你好，世界。');
});


test('failed text persistence does not create a phantom material or collection', async () => {
  const node = reset({ id: 'text', type: 'textGeneration', artifactType: 'voice', textContent: '不可丢失的正文' });
  const original = api.file.saveDataUrlToProject;
  api.file.saveDataUrlToProject = async () => ({ path: '', filePath: '' });
  try { await saveToAssets(node.id, 'project', 'voice'); }
  finally { api.file.saveDataUrlToProject = original; }
  assert.equal(store.project.assets.length, 0);
  assert.equal(store.project.materials.length, 0);
  assert.equal(collections(store.project, node, library.localAssetLibrary.catalog).project, null);
});
