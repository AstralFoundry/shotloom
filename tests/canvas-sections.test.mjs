import test from 'node:test';
import assert from 'node:assert/strict';
import { canvasSectionBounds, canvasSectionMembers } from '../renderer/src/domain/graph/CanvasSections.ts';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

const media = (id, x, y) => ({ id, type: 'imageGeneration', x, y, canvasWidth: 180, canvasHeight: 120 });

test('sections wrap real node bounds and include only fully contained live content', () => {
  const nodes = [media('a', -240, -90), media('b', 40, 70)];
  const bounds = canvasSectionBounds(nodes, { x: 0, y: 0 });
  assert.deepEqual(bounds, { x: -272, y: -146, canvasWidth: 524, canvasHeight: 368 });
  const section = { id: 'section', type: 'canvasSection', ...bounds };
  assert.deepEqual(canvasSectionMembers(section, [
    ...nodes, media('outside', 500, 0), media('partial', 200, 0),
    { ...nodes[0], id: 'archived', archived: true }, section,
  ]).map(node => node.id), ['a', 'b']);
  assert.deepEqual(canvasSectionBounds([], { x: -10, y: 20 }), { x: -10, y: 20, canvasWidth: 800, canvasHeight: 560 });
});

test('section creation, resize, copying, undo and removal preserve the real canvas content', async t => {
  const env = await createRendererEnv({ storage: new Map(), withWindow: true });
  t.after(() => env.dispose());
  const { store } = await env.load('store/projectStore.ts');
  const { createProject, normalizeProject } = await env.load('store/projectNormalization.ts');
  const { canvasController, nodeActions } = await env.load('app/adapters/canvasAdapter.ts');
  const { undoCanvas, redoCanvas } = await env.load('store/canvasHistoryStore.ts');
  const { captureWorkflowSnapshot } = await env.load('store/clipboardStore.ts');
  store.project = createProject();
  store.project.nodes = [media('a', 100, 100), media('b', 340, 100)];
  store.project.edges = [{ id: 'edge', source: 'a', target: 'b' }];
  store.selectedNodeIds = ['a', 'b'];
  canvasController.createSection();
  const frame = store.project.nodes.find(node => node.type === 'canvasSection');
  assert.ok(frame);
  assert.deepEqual(store.selectedNodeIds, [frame.id]);
  const saved = normalizeProject(JSON.parse(JSON.stringify(store.project)));
  assert.equal(saved.nodes.find(node => node.id === frame.id).canvasWidth, frame.canvasWidth);
  const copied = await captureWorkflowSnapshot({ selectedOnly: true });
  assert.equal(copied.nodes.length, 3);
  assert.equal(copied.edges.length, 1);
  assert.equal(undoCanvas(), true);
  assert.deepEqual(store.project.nodes.map(node => node.id), ['a', 'b']);
  assert.equal(redoCanvas(), true);
  const restored = store.project.nodes.find(node => node.id === frame.id);
  nodeActions.update(frame.id, { title: 'Scene two', canvasWidth: 900 });
  assert.equal(restored.title, 'Scene two');
  undoCanvas();
  assert.equal(store.project.nodes.find(node => node.id === frame.id).title, frame.title);
  nodeActions.delete(frame.id);
  assert.deepEqual(store.project.nodes.map(node => node.id), ['a', 'b']);
  assert.equal(store.project.edges.length, 1);
});
