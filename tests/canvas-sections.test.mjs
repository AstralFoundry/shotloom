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

test('membership is stable across content size changes and overlapping sections have one owner', async () => {
  const { retainCanvasSectionMembership, fitCanvasSectionsToMembers, moveCanvasSectionNodes } = await import('../renderer/src/domain/graph/CanvasSections.ts');
  const outer = { id: 'outer', type: 'canvasSection', x: 0, y: 0, canvasWidth: 1000, canvasHeight: 800 };
  const inner = { id: 'inner', type: 'canvasSection', x: 50, y: 50, canvasWidth: 400, canvasHeight: 300 };
  const content = media('a', 100, 120);
  const nodes = [outer, inner, content];
  retainCanvasSectionMembership(nodes);
  assert.equal(content.canvasSectionId, 'inner');
  assert.deepEqual(canvasSectionMembers(outer, nodes), []);
  content.canvasWidth = 600;
  fitCanvasSectionsToMembers(nodes);
  assert.equal(content.canvasSectionId, 'inner');
  assert.ok(inner.x + inner.canvasWidth >= content.x + content.canvasWidth);
  moveCanvasSectionNodes(nodes, [{ id: 'inner', x: 250, y: 350 }]);
  assert.equal(content.x, 300);
  assert.equal(content.y, 420);
  assert.equal(content.canvasSectionId, 'inner');
});

test('dropping nodes joins or leaves a section and section moves never move a selected member twice', async () => {
  const { moveCanvasSectionNodes } = await import('../renderer/src/domain/graph/CanvasSections.ts');
  const frame = { id: 'frame', type: 'canvasSection', x: 0, y: 0, canvasWidth: 500, canvasHeight: 400 };
  const content = media('a', 800, 800);
  const nodes = [frame, content];
  moveCanvasSectionNodes(nodes, [{ id: 'a', x: 100, y: 100 }]);
  assert.equal(content.canvasSectionId, 'frame');
  moveCanvasSectionNodes(nodes, [{ id: 'frame', x: 50, y: 50 }, { id: 'a', x: 150, y: 150 }]);
  assert.deepEqual([content.x, content.y], [150, 150]);
  moveCanvasSectionNodes(nodes, [{ id: 'a', x: 900, y: 900 }]);
  assert.equal(content.canvasSectionId, null);
  moveCanvasSectionNodes(nodes, [{ id: 'frame', x: 100, y: 100 }]);
  assert.deepEqual([content.x, content.y], [900, 900]);
});

test('section ownership survives save, copy, resize, movement undo and frame deletion', async t => {
  const env = await createRendererEnv({ storage: new Map(), withWindow: true });
  t.after(() => env.dispose());
  const { store } = await env.load('store/projectStore.ts');
  const { createProject, normalizeProject } = await env.load('store/projectNormalization.ts');
  const { canvasController, nodeActions } = await env.load('app/adapters/canvasAdapter.ts');
  const { undoCanvas, redoCanvas } = await env.load('store/canvasHistoryStore.ts');
  const { captureWorkflowSnapshot } = await env.load('store/clipboardStore.ts');
  const { remapImportedNodeReferences } = await env.load('store/canvasGraphStore.ts');
  store.project = createProject();
  store.project.nodes = [media('a', 100, 100), media('b', 900, 900)];
  store.selectedNodeIds = ['a'];
  canvasController.createSection();
  const frame = store.project.nodes.find(node => node.type === 'canvasSection');
  assert.equal(store.project.nodes[0].canvasSectionId, frame.id);
  canvasController.moveNodes([{ id: 'b', x: 100, y: 100 }]);
  assert.equal(store.project.nodes[1].canvasSectionId, frame.id);
  undoCanvas();
  assert.equal(store.project.nodes[1].canvasSectionId, null);
  redoCanvas();
  assert.equal(store.project.nodes[1].canvasSectionId, frame.id);
  nodeActions.update(frame.id, { canvasWidth: 240, canvasHeight: 160 });
  const resized = store.project.nodes.find(node => node.id === frame.id);
  assert.ok(resized.x + resized.canvasWidth >= 280);
  assert.ok(resized.y + resized.canvasHeight >= 220);
  canvasController.moveNodes([{ id: frame.id, x: 400, y: 400 }]);
  assert.equal(store.project.nodes[0].x, 432);
  undoCanvas();
  assert.equal(store.project.nodes[0].x, 100);
  assert.equal(store.project.nodes[0].canvasSectionId, frame.id);
  const saved = normalizeProject(JSON.parse(JSON.stringify(store.project)));
  assert.equal(saved.nodes[0].canvasSectionId, frame.id);
  store.selectedNodeIds = [frame.id];
  const copied = await captureWorkflowSnapshot({ selectedOnly: true });
  remapImportedNodeReferences(copied.nodes, new Map([[frame.id, 'copy-frame']]));
  assert.equal(copied.nodes.find(node => node.id === 'a').canvasSectionId, 'copy-frame');
  const single = [{ ...store.project.nodes[0] }];
  remapImportedNodeReferences(single, new Map([['a', 'copy-a']]));
  assert.equal(single[0].canvasSectionId, null);
  nodeActions.delete(frame.id);
  assert.deepEqual(store.project.nodes.map(node => node.canvasSectionId), [null, null]);
  undoCanvas();
  assert.equal(store.project.nodes[0].canvasSectionId, frame.id);
});

test('tidying wraps mixed node sizes within the frame without touching other sections or connections', async () => {
  const { arrangeCanvasSection } = await import('../renderer/src/domain/graph/CanvasSections.ts');
  const frame = { id: 'frame', type: 'canvasSection', x: 20, y: 30, canvasWidth: 500, canvasHeight: 500 };
  const a = { ...media('a', 100, 100), canvasSectionId: 'frame' };
  const b = { ...media('b', 100, 100), canvasSectionId: 'frame', canvasHeight: 180 };
  const c = { ...media('c', 100, 100), canvasSectionId: 'frame', canvasWidth: 300 };
  const outside = media('outside', 900, 900);
  const nodes = [frame, a, b, c, outside];
  arrangeCanvasSection(frame, nodes);
  assert.deepEqual([a.x, a.y, b.x, b.y, c.x, c.y], [52, 86, 264, 86, 52, 298]);
  assert.equal(frame.canvasHeight, 420);
  assert.deepEqual([outside.x, outside.y], [900, 900]);
  frame.canvasWidth = 360;
  arrangeCanvasSection(frame, nodes);
  assert.equal(b.x, a.x);
  assert.ok(b.y >= a.y + a.canvasHeight + 32);
  assert.ok(c.y >= b.y + b.canvasHeight + 32);
});

test('auto arrangement handles additions, deletion, size changes, resize, toggle and undo', async t => {
  const env = await createRendererEnv({ storage: new Map(), withWindow: true });
  t.after(() => env.dispose());
  const { store, touchProject } = await env.load('store/projectStore.ts');
  const { createProject } = await env.load('store/projectNormalization.ts');
  const { canvasController, nodeActions } = await env.load('app/adapters/canvasAdapter.ts');
  const { undoCanvas, redoCanvas } = await env.load('store/canvasHistoryStore.ts');
  store.project = createProject();
  store.project.nodes = [{ id: 'frame', type: 'canvasSection', x: 0, y: 0, canvasWidth: 500, canvasHeight: 500 },
    { ...media('a', 100, 100), canvasSectionId: 'frame' }, { ...media('b', 110, 110), canvasSectionId: 'frame' }];
  nodeActions.arrangeSection('frame');
  assert.deepEqual(store.project.nodes.slice(1).map(n => [n.x, n.y]), [[32, 56], [244, 56]]);
  undoCanvas();
  assert.deepEqual(store.project.nodes.slice(1).map(n => [n.x, n.y]), [[100, 100], [110, 110]]);
  nodeActions.update('frame', { canvasSectionAutoLayout: true });
  assert.equal(store.project.nodes[1].x, 32);
  nodeActions.update('frame', { canvasWidth: 300 });
  assert.equal(store.project.nodes[2].x, 32);
  assert.equal(store.project.nodes[2].y, 208);
  store.project.nodes[1].canvasHeight = 200;
  touchProject();
  assert.equal(store.project.nodes[2].y, 288);
  nodeActions.delete('a');
  assert.equal(store.project.nodes[1].id, 'b');
  assert.equal(store.project.nodes[1].y, 56);
  undoCanvas();
  assert.equal(store.project.nodes[2].y, 288);
  nodeActions.update('frame', { canvasSectionAutoLayout: false });
  canvasController.moveNodes([{ id: 'b', x: 40, y: 260 }]);
  assert.equal(store.project.nodes[2].y, 260);
  nodeActions.update('frame', { canvasSectionAutoLayout: true });
  assert.equal(store.project.nodes[2].y, 288);
  undoCanvas();
  assert.equal(store.project.nodes[0].canvasSectionAutoLayout, false);
  assert.equal(store.project.nodes[2].y, 260);
  redoCanvas();
  assert.equal(store.project.nodes[2].y, 288);
  nodeActions.update('frame', { canvasWidth: 800 });
  await canvasController.createNodeAt('audioGeneration', { x: 70, y: 60 });
  const added = store.project.nodes.at(-1);
  assert.equal(added.canvasSectionId, 'frame');
  assert.ok(added.y >= 56);
  assert.ok(store.project.nodes[0].canvasHeight >= added.y + added.canvasHeight + 32);
});
