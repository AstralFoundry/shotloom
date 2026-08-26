import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  applyCanvasTransaction,
  captureCanvasTransaction,
  filterChangedCanvasTransaction,
} from '../renderer/src/utils/canvasTransaction.mjs';

test('画布事务只保存受影响节点和连线并可双向恢复', () => {
  const project = {
    nodes: [
      { id: 'stable', title: '不受影响' },
      { id: 'changed', title: '修改前', x: 0 },
    ],
    edges: [{ id: 'edge-old', source: 'stable', target: 'changed' }],
  };
  const before = captureCanvasTransaction(project, ['changed', 'created'], ['edge-old', 'edge-new']);
  project.nodes[1] = { ...project.nodes[1], title: '修改后', x: 200 };
  project.nodes.push({ id: 'created', title: '新节点' });
  project.edges = [{ id: 'edge-new', source: 'changed', target: 'created' }];

  const transaction = filterChangedCanvasTransaction(project, before);
  assert.deepEqual(transaction.nodes.map((item) => item.id), ['changed', 'created']);
  assert.deepEqual(transaction.edges.map((item) => item.id), ['edge-old', 'edge-new']);

  const redo = captureCanvasTransaction(project, ['changed', 'created'], ['edge-old', 'edge-new']);
  applyCanvasTransaction(project, transaction);
  assert.deepEqual(project.nodes, [
    { id: 'stable', title: '不受影响' },
    { id: 'changed', title: '修改前', x: 0 },
  ]);
  assert.deepEqual(project.edges, [{ id: 'edge-old', source: 'stable', target: 'changed' }]);

  applyCanvasTransaction(project, redo);
  assert.equal(project.nodes.find((item) => item.id === 'changed').title, '修改后');
  assert.ok(project.nodes.some((item) => item.id === 'created'));
  assert.deepEqual(project.edges, [{ id: 'edge-new', source: 'changed', target: 'created' }]);
});

test('Agent 执行器不再为每个批次复制完整前后画布', () => {
  const executor = readFileSync(
    new URL('../renderer/src/services/agent/agentCanvasExecutor.ts', import.meta.url),
    'utf8',
  );
  const batches = readFileSync(
    new URL('../renderer/src/store/agentBatchStore.ts', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(executor, /const beforeNodes = JSON\.parse|afterNodes: JSON\.parse|beforeEdges: JSON\.parse|afterEdges: JSON\.parse/);
  assert.match(executor, /createTransactionJournal\(\)/);
  assert.match(executor, /recordCanvasTransactionHistory/);
  assert.match(executor, /recordPerformanceMetric\('agent\.canvas\.transaction'/);
  assert.doesNotMatch(batches, /beforeNodes|afterNodes|beforeEdges|afterEdges|batchSnapshots/);
});
