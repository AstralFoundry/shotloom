import assert from 'node:assert/strict';
import test from 'node:test';
import { alignCanvasSelection } from '../renderer/src/utils/canvasSelectionLayout.ts';
import { canvasInputIndex } from '../renderer/src/app/canvas/canvasInputIndex.ts';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

test('alignment commits through canvas controller and undo restores all affected positions', async t => {
  const env = await createRendererEnv({ storage: new Map(), withWindow: true });
  t.after(() => env.dispose());
  const { store } = await env.load('store/projectStore.ts');
  const { createProject } = await env.load('store/projectNormalization.ts');
  const { canvasController } = await env.load('app/adapters/canvasAdapter.ts');
  const { undoCanvas, redoCanvas } = await env.load('store/canvasHistoryStore.ts');
  store.project = createProject();
  const boxes = [{ id: 'a', x: -100, y: 20, width: 50, height: 60 }, { id: 'b', x: 100, y: 90, width: 70, height: 30 }];
  store.project.nodes = boxes.map(box => ({ ...box, type: 'imageGeneration', canvasWidth: box.width, canvasHeight: box.height }));
  canvasController.moveNodes(alignCanvasSelection(boxes, 'top'));
  assert.equal(store.project.nodes[1].y, 20);
  assert.equal(store.project.canvasHistory.length, 1);
  undoCanvas();
  assert.equal(store.project.nodes[1].y, 90);
  redoCanvas();
  assert.equal(store.project.nodes[1].y, 20);
});

test('unequal node widths distribute by gaps, preserve bounds and do not mutate input', () => {
  const boxes = [
    { id: 'a', x: -100, y: 20, width: 50, height: 60 },
    { id: 'b', x: 0, y: 40, width: 100, height: 80 },
    { id: 'c', x: 300, y: 90, width: 70, height: 30 },
  ];
  const original = structuredClone(boxes);
  assert.deepEqual(alignCanvasSelection(boxes, 'distributeX'), [{ id: 'b', x: 75, y: 40 }]);
  assert.deepEqual(alignCanvasSelection(boxes, 'right'), [
    { id: 'a', x: 320, y: 20 }, { id: 'b', x: 270, y: 40 },
  ]);
  assert.deepEqual(alignCanvasSelection(boxes, 'centerY'), [{ id: 'a', x: -100, y: 40 }, { id: 'b', x: 0, y: 30 }, { id: 'c', x: 300, y: 55 }]);
  assert.deepEqual(alignCanvasSelection(boxes.slice(0, 2), 'distributeX'), []);
  assert.deepEqual(boxes, original);
});

test('camera frames reuse input graph; source or edge snapshots invalidate it', () => {
  const nodes = [{ id: 'a', type: 'imageGeneration', title: 'source', updatedAt: '1', generatedOutputs: [{ id: 'output', title: 'result', selected: true }] }, { id: 'b', type: 'videoGeneration' }];
  const edges = [{ id: 'edge', source: 'a', target: 'b', data: { inputRole: 'reference' } }];
  const first = canvasInputIndex(nodes, edges, 'Node');
  assert.equal(canvasInputIndex(nodes, edges, 'Node'), first);
  assert.equal(first.get('b').inputs[0].name, 'result');
  const changed = canvasInputIndex([{ ...nodes[0], updatedAt: '2' }, nodes[1]], edges, 'Node');
  assert.notEqual(changed.get('b').revision, first.get('b').revision);
  const removed = canvasInputIndex(nodes, [], 'Node');
  assert.equal(removed.size, 0);
  assert.notEqual(canvasInputIndex(nodes, edges, 'Node'), removed);
});

test('missing upstream remains represented in revision without inventing an input', () => {
  const index = canvasInputIndex([{ id: 'b', type: 'videoGeneration' }], [{ id: 'edge', source: 'missing', target: 'b' }], 'Node');
  assert.match(index.get('b').revision, /missing/);
  assert.deepEqual(index.get('b').inputs, []);
});
