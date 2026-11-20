import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

const env = await createRendererEnv();
after(() => env.dispose());

test('批量创作表默认三组参考、零任务行，追加沿用上一行参考并带默认提示词', async () => {
  const {
    defaultBatchTable, addBatchRow, removeBatchRow, updateBatchRow, MAX_BATCH_ROWS, TRY_ON_BATCH_PROMPT,
  } = await env.load('domain/graph/BatchTable');
  let table = defaultBatchTable();
  assert.equal(table.rows.length, 0);
  assert.equal(table.columns.length, 3);
  assert.equal(table.operation, 'try_on');
  assert.equal(table.concurrency, 5);
  const added = addBatchRow(table);
  assert.ok(added.row);
  table = added.table;
  assert.equal(table.rows.length, 1);
  assert.equal(table.rows[0].prompt, TRY_ON_BATCH_PROMPT);
  table = updateBatchRow(table, table.rows[0].id, { referenceNodeIds: ['img-a', 'img-b'] });
  const second = addBatchRow(table);
  assert.deepEqual(second.row.referenceNodeIds, ['img-a', 'img-b']);
  table = second.table;
  table = removeBatchRow(table, table.rows[0].id);
  table = removeBatchRow(table, table.rows[0].id);
  assert.equal(table.rows.length, 0, '删空后保留空表，由空状态引导添加第一条任务');
  const huge = { ...table, rows: Array.from({ length: MAX_BATCH_ROWS }, (_, index) => ({ id: `r${index}`, enabled: true, prompt: 'p', referenceNodeIds: [], outputNodeId: '' })) };
  assert.equal(addBatchRow(huge).row, null);
});

test('参考列上限、行级覆盖与表格连线参考的优先级稳定', async () => {
  const {
    defaultBatchTable, addBatchColumn, removeBatchColumn, batchColumnReferences, batchRowReferences, MAX_BATCH_REFERENCE_COLUMNS,
  } = await env.load('domain/graph/BatchTable');
  let table = defaultBatchTable();
  for (let index = 0; index < 20; index += 1) table = addBatchColumn(table);
  assert.equal(table.columns.length, MAX_BATCH_REFERENCE_COLUMNS);
  while (table.columns.length > 1) table = removeBatchColumn(table);
  assert.equal(table.columns.length, 1);
  table = { ...table, columns: [{ id: 'c1', label: '参考 1' }, { id: 'c2', label: '参考 2' }] };
  const defaults = batchColumnReferences(table, [
    { source: 'img-b', target: 'table-1', data: {} },
    { source: 'img-a', target: 'table-1', data: {} },
    { source: 'text-a', target: 'table-1', data: {} },
  ], 'table-1', (id) => id.startsWith('img-'));
  assert.deepEqual(defaults, ['img-b', 'img-a']);
  const row = { id: 'r1', enabled: true, prompt: '', referenceNodeIds: ['img-c', ''], outputNodeId: '' };
  assert.deepEqual(batchRowReferences(row, defaults), ['img-c', 'img-a']);
});

test('每列端口连线按 batchColumnId 归位，普通连线按顺序补齐空列', async () => {
  const { defaultBatchTable, batchColumnInputs, batchColumnReferences } = await env.load('domain/graph/BatchTable');
  const table = defaultBatchTable();
  const edges = [
    { source: 'a1', target: 'table', data: { batchColumnId: table.columns[1].id } },
    { source: 'a2', target: 'table', data: { batchColumnId: table.columns[1].id } },
    { source: 'b1', target: 'table', data: {} },
    { source: 'c1', target: 'table', data: { batchColumnId: table.columns[2].id } },
  ];
  const columns = batchColumnInputs(table, edges, 'table', () => true);
  assert.deepEqual(columns[1], ['a1', 'a2']);
  assert.deepEqual(columns[0], ['b1']);
  assert.deepEqual(columns[2], ['c1']);
  assert.deepEqual(batchColumnReferences(table, edges, 'table', () => true), ['b1', 'a1', 'c1']);
  assert.deepEqual(batchColumnInputs(table, edges, 'table', (id) => id !== 'a2')[1], ['a1']);
});

test('全局提示词统一覆盖各行原文，可运行行同时校验启用、提示词与最低参考数', async () => {
  const { defaultBatchTable, batchRowPrompt, batchRowReady, batchTableSummary } = await env.load('domain/graph/BatchTable');
  const table = { ...defaultBatchTable(), rows: [
    { id: 'r1', enabled: true, prompt: '镜头一', referenceNodeIds: ['a', 'b'], outputNodeId: '' },
    { id: 'r2', enabled: true, prompt: '', referenceNodeIds: ['a', 'b'], outputNodeId: '' },
    { id: 'r3', enabled: false, prompt: '镜头三', referenceNodeIds: ['a', 'b'], outputNodeId: '' },
    { id: 'r4', enabled: true, prompt: '镜头四', referenceNodeIds: ['a'], outputNodeId: '' },
  ] };
  assert.equal(batchRowPrompt(table, table.rows[0]), '镜头一');
  assert.equal(batchRowPrompt({ ...table, globalPrompt: '统一冷色' }, table.rows[0]), '统一冷色');
  assert.equal(batchRowReady(table, table.rows[0]), true);
  assert.equal(batchRowReady(table, table.rows[1]), false, '没有提示词的行不能运行');
  assert.equal(batchRowReady(table, table.rows[2]), false, '停用行始终不运行');
  assert.equal(batchRowReady(table, table.rows[3]), false, '换装至少需要两张参考图');
  assert.equal(batchRowReady({ ...table, operation: 'creative' }, table.rows[3]), true, '创意生图一张参考即可');
  assert.deepEqual(batchTableSummary(table), { total: 4, enabled: 1 });
});

test('按列填充按参考组合复用旧行，不删除未匹配的手工行', async () => {
  const { defaultBatchTable, batchRowsFromColumns } = await env.load('domain/graph/BatchTable');
  const table = {
    ...defaultBatchTable(),
    rows: [
      { id: 'keep', enabled: true, prompt: '已写正文', referenceNodeIds: ['a', 'b'], outputNodeId: 'out-1' },
      { id: 'manual', enabled: true, prompt: '手工行', referenceNodeIds: ['z', 'z2'], outputNodeId: '' },
    ],
  };
  const rows = batchRowsFromColumns(table, [['a'], ['b']]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, 'keep');
  assert.equal(rows[0].outputNodeId, 'out-1');
  assert.equal(rows[0].prompt, '已写正文');
  assert.equal(rows[1].id, 'manual');
});

test('批量创作表数据持久化时收窄任务类型、并发、参考列与行数，并保留运行快照', async () => {
  const { normalizeBatchTable, MAX_BATCH_ROWS, MAX_BATCH_REFERENCE_COLUMNS } = await env.load('domain/graph/BatchTable');
  const table = normalizeBatchTable({
    operation: 'creative', concurrency: 99, globalPrompt: '  G  ',
    columns: Array.from({ length: 20 }, (_, index) => ({ id: `c${index}`, label: `L${index}` })),
    rows: Array.from({ length: MAX_BATCH_ROWS + 10 }, (_, index) => ({ id: `r${index}`, enabled: index % 2 === 0, prompt: `P${index}`, referenceNodeIds: ['a', 'b'], outputNodeId: 'out' })),
    runState: { running: true, startedAt: 'now', total: 4, done: 2, failed: 1 },
  });
  assert.equal(table.operation, 'creative');
  assert.equal(table.concurrency, 5);
  assert.equal(table.globalPrompt, 'G');
  assert.equal(table.columns.length, MAX_BATCH_REFERENCE_COLUMNS);
  assert.equal(table.rows.length, MAX_BATCH_ROWS);
  assert.deepEqual(table.runState, { running: true, startedAt: 'now', total: 4, done: 2, failed: 1, cancelled: false });
  const fallback = normalizeBatchTable({ operation: 'unknown', rows: [], columns: [] });
  assert.equal(fallback.operation, 'try_on');
  assert.equal(fallback.rows.length, 0);
  assert.equal(fallback.columns.length, 3);
});
