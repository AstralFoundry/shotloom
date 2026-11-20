import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

const env = await createRendererEnv({ storage: new Map(), withWindow: true });
after(() => env.dispose());

test('批量创作表是独立画布节点，尺寸与默认数据可持久化', async () => {
  const { NodeType, CANVAS_NODE_TYPES, UTILITY_NODE_TYPES } = await env.load('domain/graph/NodeType');
  const { canvasNodeDimensions } = await env.load('domain/graph/CanvasNodeDimensions');
  assert.equal(NodeType.BatchTable, 'batchTable');
  assert.ok(CANVAS_NODE_TYPES.includes(NodeType.BatchTable));
  assert.ok(UTILITY_NODE_TYPES.includes(NodeType.BatchTable));
  assert.deepEqual(canvasNodeDimensions({ type: 'batchTable' }), { width: 1280, height: 560 });
});

test('创建批量创作表节点会写入初始行、参考列与画布尺寸', async () => {
  const { store } = await env.load('store/projectStore');
  const { createProject } = await env.load('store/projectNormalization');
  const { addNode } = await env.load('store/nodeStore');
  store.project = createProject('测试');
  const node = addNode('batchTable');
  assert.equal(node.type, 'batchTable');
  assert.equal(node.batchTable.rows.length, 0);
  assert.equal(node.batchTable.columns.length, 3);
  assert.equal(node.batchTable.operation, 'try_on');
  assert.equal(node.batchTable.concurrency, 5);
  assert.equal(node.canvasWidth, 1280);
  assert.equal(node.canvasHeight, 560);
});

test('画布菜单提供分镜脚本与批量创作表入口，姿势库可从工具栏打开', async () => {
  const { nodeTypes } = await env.load('app/constants/navigation');
  const ids = nodeTypes.map((item) => item.id);
  assert.ok(ids.includes('storyboardScript'));
  assert.ok(ids.includes('batchTable'));
  const menu = await env.load('app/canvas/CanvasContextMenu.tsx');
  assert.equal(typeof menu.CanvasContextMenu, 'function');
});
