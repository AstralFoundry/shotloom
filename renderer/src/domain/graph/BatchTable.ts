import { uid } from '../../utils/format.ts';

/**
 * 批量创作表：每一行是一份独立的生图任务，参考图列可保存行级覆盖。
 * 这里只保存任务计划，不提交生成、不写任务状态；节点状态仍以真实生成节点为准。
 *
 * 与参考项目保持一致：换装（try_on）每行至少两张参考图，创意（creative）每行至少一张；
 * 全局提示词非空时统一覆盖各行原文，清空后才恢复各行提示词。
 */
export const MAX_BATCH_ROWS = 200;
export const MAX_BATCH_REFERENCE_COLUMNS = 10;
export const DEFAULT_BATCH_REFERENCE_COLUMNS = 3;
export const BATCH_CONCURRENCY_OPTIONS = [1, 5, 10] as const;
export const TRY_ON_BATCH_PROMPT = '参考图1是人物原图，参考图2是目标服装。保持人物身份、五官、姿态和背景不变，将人物服装替换为参考图2中的款式。准确还原服装版型、颜色、材质、纹理和装饰细节，穿着关系自然，光影与原图一致。';
export const CREATIVE_BATCH_PROMPT = '基于参考图创作一张新的商业图片，保留主体身份和关键产品细节，画面构图完整，光影自然。';

const BATCH_CELL_HANDLE_PREFIX = 'batch-cell:';
const BATCH_CELL_EDGE_PREFIX = 'batch-cell-edge:';

export function batchColumnHandle(columnId: string) {
  return `batch-reference:${columnId}`;
}

export function batchCellHandle(rowId: string, columnId: string) {
  return `${BATCH_CELL_HANDLE_PREFIX}${encodeURIComponent(rowId)}:${encodeURIComponent(columnId)}`;
}

export function parseBatchCellHandle(handle?: string | null) {
  if (!handle?.startsWith(BATCH_CELL_HANDLE_PREFIX)) return null;
  const [row, column, extra] = handle.slice(BATCH_CELL_HANDLE_PREFIX.length).split(':');
  if (!row || !column || extra !== undefined) return null;
  try {
    return { rowId: decodeURIComponent(row), columnId: decodeURIComponent(column) };
  } catch {
    return null;
  }
}

export function batchCellEdgeId(tableId: string, rowId: string, columnId: string) {
  return `${BATCH_CELL_EDGE_PREFIX}${encodeURIComponent(tableId)}:${batchCellHandle(rowId, columnId)}`;
}

export function parseBatchCellEdgeId(id: string) {
  if (!id.startsWith(BATCH_CELL_EDGE_PREFIX)) return null;
  const separator = id.indexOf(':', BATCH_CELL_EDGE_PREFIX.length);
  if (separator < 0) return null;
  const cell = parseBatchCellHandle(id.slice(separator + 1));
  if (!cell) return null;
  try {
    return { tableId: decodeURIComponent(id.slice(BATCH_CELL_EDGE_PREFIX.length, separator)), ...cell };
  } catch {
    return null;
  }
}

export type BatchOperation = 'try_on' | 'creative';

export interface BatchReferenceColumn {
  id: string;
  label: string;
}

export interface BatchRow {
  id: string;
  enabled: boolean;
  prompt: string;
  /** 行级参考图；空位由表格级连线参考补齐。 */
  referenceNodeIds: string[];
  outputNodeId: string;
}

export interface BatchTableData {
  operation: BatchOperation;
  concurrency: number;
  globalPrompt: string;
  columns: BatchReferenceColumn[];
  rows: BatchRow[];
  runState?: {
    running: boolean;
    startedAt: string;
    total: number;
    done: number;
    failed: number;
    cancelled?: boolean;
  };
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function positiveInteger(value: unknown, fallback: number, max: number): number {
  const number = Math.round(Number(value));
  return Number.isFinite(number) && number > 0 ? Math.min(number, max) : fallback;
}

export function defaultBatchPrompt(operation: BatchOperation): string {
  return operation === 'creative' ? CREATIVE_BATCH_PROMPT : TRY_ON_BATCH_PROMPT;
}

export function minimumBatchReferences(operation: BatchOperation): number {
  return operation === 'creative' ? 1 : 2;
}

export function createBatchColumn(index: number): BatchReferenceColumn {
  return { id: uid(), label: `参考图 ${index + 1}` };
}

export function defaultBatchColumns(): BatchReferenceColumn[] {
  return Array.from({ length: DEFAULT_BATCH_REFERENCE_COLUMNS }, (_, index) => createBatchColumn(index));
}

/** 手工追加任务时沿用上一行参考图，但重新使用当前任务类型的默认提示词。 */
export function createBatchRow(operation: BatchOperation, referenceNodeIds: string[] = []): BatchRow {
  return {
    id: uid(),
    enabled: true,
    prompt: defaultBatchPrompt(operation),
    referenceNodeIds: [...referenceNodeIds],
    outputNodeId: '',
  };
}

export function defaultBatchTable(): BatchTableData {
  return {
    operation: 'try_on',
    concurrency: 5,
    globalPrompt: '',
    columns: defaultBatchColumns(),
    rows: [],
  };
}

function normalizeRow(value: unknown): BatchRow | null {
  const source = record(value);
  if (!source) return null;
  const references = Array.isArray(source.referenceNodeIds)
    ? source.referenceNodeIds.map((id) => text(id))
    : [];
  return {
    id: text(source.id) || uid(),
    enabled: source.enabled !== false,
    prompt: typeof source.prompt === 'string' ? source.prompt : '',
    referenceNodeIds: references,
    outputNodeId: text(source.outputNodeId),
  };
}

export function normalizeBatchTable(value: unknown): BatchTableData {
  const source = record(value);
  const base = defaultBatchTable();
  if (!source) return base;
  const operation: BatchOperation = source.operation === 'creative' ? 'creative' : 'try_on';
  const columns = Array.isArray(source.columns)
    ? source.columns.map((column, index) => {
      const entry = record(column);
      return entry
        ? { id: text(entry.id) || uid(), label: text(entry.label) || `参考图 ${index + 1}` }
        : createBatchColumn(index);
    }).slice(0, MAX_BATCH_REFERENCE_COLUMNS)
    : base.columns;
  const rows = Array.isArray(source.rows)
    ? source.rows.map(normalizeRow).filter((row): row is BatchRow => Boolean(row)).slice(0, MAX_BATCH_ROWS)
    : [];
  const concurrency = Number(source.concurrency);
  const runState = record(source.runState);
  return {
    operation,
    concurrency: BATCH_CONCURRENCY_OPTIONS.includes(concurrency as typeof BATCH_CONCURRENCY_OPTIONS[number]) ? concurrency : base.concurrency,
    globalPrompt: typeof source.globalPrompt === 'string' ? source.globalPrompt : '',
    columns: columns.length ? columns : base.columns,
    rows,
    ...(runState ? {
      runState: {
        running: runState.running === true,
        startedAt: text(runState.startedAt),
        total: positiveInteger(runState.total, 0, MAX_BATCH_ROWS),
        done: positiveInteger(runState.done, 0, MAX_BATCH_ROWS),
        failed: positiveInteger(runState.failed, 0, MAX_BATCH_ROWS),
        cancelled: runState.cancelled === true,
      },
    } : {}),
  };
}

export function isBatchTableNode(node: Record<string, unknown> | null | undefined): boolean {
  return Boolean(node && node.type === 'batchTable');
}

/** 在指定行之后插入；未给行 ID 时追加到末尾。参考图沿用前一行，正文使用当前任务类型默认值。 */
export function addBatchRow(table: BatchTableData, afterRowId?: string): { table: BatchTableData; row: BatchRow | null } {
  if (table.rows.length >= MAX_BATCH_ROWS) return { table, row: null };
  const index = afterRowId === undefined
    ? table.rows.length
    : table.rows.findIndex((item) => item.id === afterRowId) + 1;
  const previous = table.rows[Math.max(0, index - 1)];
  const row = createBatchRow(table.operation, previous?.referenceNodeIds || []);
  const rows = [...table.rows];
  rows.splice(index, 0, row);
  return { table: { ...table, rows }, row };
}

export function removeBatchRow(table: BatchTableData, rowId: string): BatchTableData {
  return { ...table, rows: table.rows.filter((row) => row.id !== rowId) };
}

/** 调整参考列顺序，并同步重排每行按列保存的参考图。 */
export function reorderBatchColumns(table: BatchTableData, fromColumnId: string, toColumnId: string): BatchTableData {
  const fromIndex = table.columns.findIndex((column) => column.id === fromColumnId);
  const toIndex = table.columns.findIndex((column) => column.id === toColumnId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return table;
  const columns = [...table.columns];
  const [moved] = columns.splice(fromIndex, 1);
  if (!moved) return table;
  columns.splice(toIndex, 0, moved);
  const order = columns.map((column) => table.columns.findIndex((item) => item.id === column.id));
  return {
    ...table,
    columns: columns.map((column, index) => ({ ...column, label: `参考图 ${index + 1}` })),
    rows: table.rows.map((row) => ({
      ...row,
      referenceNodeIds: order.map((oldIndex) => row.referenceNodeIds[oldIndex] || ''),
    })),
  };
}

/** 在行与列之间交换参考图；不改变提示词和产出。 */
export function moveBatchReferenceCell(
  table: BatchTableData,
  sourceRowId: string,
  sourceColumnIndex: number,
  targetRowId: string,
  targetColumnIndex: number,
): BatchTableData {
  if (sourceRowId === targetRowId && sourceColumnIndex === targetColumnIndex) return table;
  if (sourceColumnIndex < 0 || targetColumnIndex < 0 || targetColumnIndex >= table.columns.length) return table;
  const rows = table.rows.map((row) => ({
    ...row,
    referenceNodeIds: Array.from({ length: table.columns.length }, (_, index) => row.referenceNodeIds[index] || ''),
  }));
  const sourceRow = rows.find((row) => row.id === sourceRowId);
  const targetRow = rows.find((row) => row.id === targetRowId);
  if (!sourceRow || !targetRow) return table;
  const source = sourceRow.referenceNodeIds[sourceColumnIndex] || '';
  if (!source) return table;
  const target = targetRow.referenceNodeIds[targetColumnIndex] || '';
  targetRow.referenceNodeIds[targetColumnIndex] = source;
  sourceRow.referenceNodeIds[sourceColumnIndex] = target;
  return { ...table, rows };
}

export function updateBatchRow(table: BatchTableData, rowId: string, patch: Partial<BatchRow>): BatchTableData {
  return {
    ...table,
    rows: table.rows.map((row) => row.id === rowId ? { ...row, ...patch, id: row.id } : row),
  };
}

export function moveBatchRow(table: BatchTableData, rowId: string, direction: -1 | 1): BatchTableData {
  const index = table.rows.findIndex((row) => row.id === rowId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= table.rows.length) return table;
  const rows = [...table.rows];
  const [row] = rows.splice(index, 1);
  if (!row) return table;
  rows.splice(target, 0, row);
  return { ...table, rows };
}

export function addBatchColumn(table: BatchTableData): BatchTableData {
  if (table.columns.length >= MAX_BATCH_REFERENCE_COLUMNS) return table;
  return { ...table, columns: [...table.columns, createBatchColumn(table.columns.length)] };
}

export function removeBatchColumn(table: BatchTableData): BatchTableData {
  if (table.columns.length <= 1) return table;
  return {
    ...table,
    columns: table.columns.slice(0, -1).map((column, index) => ({ ...column, label: `参考图 ${index + 1}` })),
    rows: table.rows.map((row) => ({ ...row, referenceNodeIds: row.referenceNodeIds.slice(0, table.columns.length - 1) })),
  };
}

export function setBatchOperation(table: BatchTableData, operation: BatchOperation): BatchTableData {
  if (table.operation === operation) return table;
  return { ...table, operation };
}

/** 每列的真实连线参考；带 batchColumnId 的连线按列归位，其余按顺序补齐空列。 */
export function batchColumnInputs(
  table: BatchTableData,
  edges: Array<{ source?: string; target?: string; data?: Record<string, unknown> }>,
  tableNodeId: string,
  isReferenceNode: (nodeId: string) => boolean,
): string[][] {
  const result = table.columns.map(() => [] as string[]);
  const columnIndex = new Map(table.columns.map((column, index) => [column.id, index]));
  const explicitSeen = table.columns.map(() => new Set<string>());
  const legacySeen = new Set<string>();
  const legacy: string[] = [];
  for (const edge of edges) {
    if (edge.target !== tableNodeId || !edge.source || edge.data?.skipTaskInput === true) continue;
    if (!isReferenceNode(edge.source)) continue;
    const explicit = typeof edge.data?.batchColumnId === 'string' ? String(edge.data.batchColumnId) : '';
    const index = explicit ? columnIndex.get(explicit) : undefined;
    if (explicit) {
      if (index === undefined) continue;
      const seen = explicitSeen[index];
      if (!seen || seen.has(edge.source)) continue;
      seen.add(edge.source);
      result[index]?.push(edge.source);
    } else {
      if (legacySeen.has(edge.source)) continue;
      legacySeen.add(edge.source);
      legacy.push(edge.source);
    }
  }
  let legacyIndex = 0;
  result.forEach((column) => {
    if (column.length) return;
    const next = legacy[legacyIndex];
    if (next) { column.push(next); legacyIndex += 1; }
  });
  for (; legacyIndex < legacy.length; legacyIndex += 1) {
    const targetIndex = result.findIndex((column) => !column.length);
    if (targetIndex < 0) break;
    const source = legacy[legacyIndex];
    if (source) result[targetIndex]?.push(source);
  }
  return result;
}

/** 表格级连线参考：每列取第一张图作为行默认值；行级设置优先。 */
export function batchColumnReferences(
  table: BatchTableData,
  edges: Array<{ source?: string; target?: string; data?: Record<string, unknown> }>,
  tableNodeId: string,
  isReferenceNode: (nodeId: string) => boolean,
): string[] {
  return batchColumnInputs(table, edges, tableNodeId, isReferenceNode).map((column) => column[0] || '');
}

/** A single column reference fills every row. Multiple images follow row order. */
export function batchRowColumnReferences(columns: string[][], rowIndex: number): string[] {
  return columns.map(column => column[column.length === 1 ? 0 : rowIndex] || '');
}

export function batchRowReferences(row: BatchRow, defaults: string[]): string[] {
  return Array.from({ length: Math.max(row.referenceNodeIds.length, defaults.length) }, (_, index) => row.referenceNodeIds[index] || defaults[index] || '');
}

export function batchRowPrompt(table: BatchTableData, row: BatchRow): string {
  return table.globalPrompt.trim() || row.prompt.trim();
}

/** 可运行必须同时满足：启用、有提示词、参考图达到当前任务类型的最低数量。 */
export function batchRowReady(table: BatchTableData, row: BatchRow, references: string[] = row.referenceNodeIds): boolean {
  if (!row.enabled || !batchRowPrompt(table, row)) return false;
  const usable = references.filter(Boolean);
  return usable.length >= minimumBatchReferences(table.operation);
}

export function batchTableSummary(table: BatchTableData, defaults: string[] = []) {
  const enabled = table.rows.filter((row) => batchRowReady(table, row, batchRowReferences(row, defaults))).length;
  return { total: table.rows.length, enabled };
}

/**
 * “按列填充”：一列的单个参考图广播到所有行，多张图按顺序分配；同参考组合的旧行保留
 * 自己的正文与产出，其余手工行不会被删除。
 */
export function batchRowsFromColumns(table: BatchTableData, columns: string[][]): BatchRow[] {
  const rowCount = Math.max(0, ...columns.map((column) => column.length));
  const unmatched = [...table.rows];
  const synchronized = Array.from({ length: rowCount }, (_, index) => {
    const references = batchRowColumnReferences(columns, index);
    let previousIndex = unmatched.findIndex((row) => row.referenceNodeIds.length === references.length
      && row.referenceNodeIds.every((id, position) => id === references[position]));
    if (previousIndex < 0 && references[0]) previousIndex = unmatched.findIndex((row) => row.referenceNodeIds[0] === references[0]);
    const previous = previousIndex >= 0 ? unmatched.splice(previousIndex, 1)[0] : undefined;
    const row = createBatchRow(table.operation, references);
    return {
      ...row,
      ...(previous ? {
        id: previous.id,
        enabled: previous.enabled,
        prompt: previous.prompt || row.prompt,
        ...(previous.outputNodeId ? { outputNodeId: previous.outputNodeId } : {}),
      } : {}),
      referenceNodeIds: references,
    };
  });
  return [...synchronized, ...unmatched];
}

export function batchRowsCompleted(table: BatchTableData, isCompleted: (row: BatchRow) => boolean): number {
  return table.rows.filter(isCompleted).length;
}
