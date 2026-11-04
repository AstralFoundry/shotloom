import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

let env, store, createProject, commands, controller, focused;
before(async () => {
  env = await createRendererEnv({ storage: new Map(), withWindow: true });
  ({ store } = await env.load('store/projectStore'));
  ({ createProject } = await env.load('store/projectNormalization'));
  ({ canvasCommands: commands, canvasController: controller } = await env.load('app/adapters/canvasAdapter'));
  controller.registerFocusNodes(ids => { focused = ids; });
});
beforeEach(() => {
  store.project = createProject();
  store.selectedNodeIds = [];
  focused = null;
});
after(async () => {
  controller?.registerFocusNodes(null);
  await env?.dispose();
});

const material = { id: 'cat', name: 'cat.png', path: '/project/cat.png', resourceType: 'image' };

test('current canvas locates an existing upload by path without adding a node', async () => {
  store.project.nodes = [{ id: 'upload', type: 'imageGeneration', title: 'renamed', uploadedFile: { path: material.path } }];
  await commands.applyMaterial(material, 'files');
  assert.equal(store.project.nodes.length, 1);
  assert.deepEqual([...store.selectedNodeIds], ['upload']);
  assert.deepEqual(focused, ['upload']);
});

test('current canvas selects the matching historical output before focusing its node', async () => {
  store.project.nodes = [{ id: 'generator', type: 'imageGeneration', selectedOutputNodeId: 'new', generatedOutputs: [
    { id: 'old', filePath: material.path }, { id: 'new', filePath: '/project/new.png' },
  ] }];
  await commands.applyMaterial(material, 'files');
  assert.equal(store.project.nodes.length, 1);
  assert.equal(store.project.nodes[0].selectedOutputNodeId, 'old');
  assert.deepEqual(focused, ['generator']);
});

test('missing and archived resources create one node, and repeated clicks reuse it', async () => {
  store.project.nodes = [{ id: 'archived', archived: true, type: 'imageGeneration', materialId: material.id }];
  await commands.applyMaterial(material, 'files');
  assert.equal(store.project.nodes.length, 2);
  const created = store.project.nodes[1];
  assert.deepEqual(focused, [created.id]);
  await commands.applyMaterial(material, 'files');
  assert.equal(store.project.nodes.length, 2);
  assert.deepEqual(focused, [created.id]);
});

test('same names do not reuse unrelated media and other asset scopes still insert nodes', async () => {
  store.project.nodes = [{ id: 'unrelated', title: material.name, type: 'imageGeneration', uploadedFile: { path: '/other/cat.png' } }];
  await commands.applyMaterial(material, 'files');
  assert.equal(store.project.nodes.length, 2);
  assert.notEqual(focused[0], 'unrelated');
  await commands.applyMaterial(material, 'library');
  assert.equal(store.project.nodes.length, 3);
});
