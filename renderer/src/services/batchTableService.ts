import { t } from '@/i18n';
import { store, touchProject } from '@/store/projectStore';
import { addNode } from '@/store/nodeStore';
import { addCanvasEdge } from '@/store/canvasGraphStore';
import { recordCanvasHistory } from '@/store/canvasHistoryStore';
import { runNode } from '@/store/taskStore';
import { showToast } from '@/store/notificationStore';
import { getAvailableModelIdsByType } from '@/store/settingsStore';
import { isActiveTaskStatus, isTerminalTaskStatus } from '@/domain/tasks/TaskStatus';
import { getGenerationInputModes } from '@/domain/catalog/ModelCatalog';
import { defaultInputSlot, type GenerationInputSlot } from '@/domain/graph/GenerationInputContract';
import {
  addBatchColumn,
  addBatchRow,
  batchColumnInputs,
  batchColumnReferences,
  batchRowPrompt,
  batchRowReady,
  batchRowReferences,
  batchRowsFromColumns,
  batchTableSummary,
  defaultBatchTable,
  moveBatchRow,
  normalizeBatchTable,
  removeBatchColumn,
  removeBatchRow,
  updateBatchRow,
  type BatchOperation,
  type BatchRow,
  type BatchTableData,
} from '@/domain/graph/BatchTable';

type AnyRecord = Record<string, any>;

const cancelledTables = new Set<string>();

function projectNode(nodeId: string): AnyRecord | null {
  return (store.project.nodes as AnyRecord[]).find((node) => node.id === nodeId) || null;
}

export function batchTableData(node: AnyRecord | null | undefined): BatchTableData {
  return normalizeBatchTable(node?.batchTable);
}

export function ensureBatchTableData(node: AnyRecord): BatchTableData {
  node.batchTable = batchTableData(node);
  return node.batchTable as BatchTableData;
}

export function updateBatchTable(nodeId: string, update: (table: BatchTableData) => BatchTableData, options: { history?: boolean } = {}): void {
  const node = projectNode(nodeId);
  if (!node) return;
  if (options.history) recordCanvasHistory(t('canvas.batch.edit'));
  node.batchTable = update(batchTableData(node));
  touchProject();
}

export function appendBatchRow(nodeId: string, afterRowId?: string): string | null {
  const node = projectNode(nodeId);
  if (!node) return null;
  const { table, row } = addBatchRow(batchTableData(node), afterRowId);
  if (!row) return null;
  recordCanvasHistory(t('canvas.batch.addRow'));
  node.batchTable = table;
  touchProject();
  return row.id;
}

export function setBatchOperation(nodeId: string, operation: BatchOperation): void {
  updateBatchTable(nodeId, (table) => ({ ...table, operation }));
}

/** 按列连线重新填充行；行级手工改过的参考只在连线覆盖时更新。 */
export function fillBatchRowsFromColumns(nodeId: string): number {
  const table = batchTableData(projectNode(nodeId));
  const columns = batchColumnInputs(table, store.project.edges as AnyRecord[], nodeId, isCanvasImageNode);
  if (!columns.some((column) => column.length)) {
    showToast(t('canvas.batch.noColumnReferences'));
    return 0;
  }
  const rows = batchRowsFromColumns(table, columns);
  updateBatchTable(nodeId, (current) => ({ ...current, rows }), { history: true });
  return rows.length;
}

export function deleteBatchRow(nodeId: string, rowId: string): void {
  updateBatchTable(nodeId, (table) => removeBatchRow(table, rowId), { history: true });
}

export function patchBatchRow(nodeId: string, rowId: string, patch: Partial<BatchRow>): void {
  const node = projectNode(nodeId);
  if (!node) return;
  node.batchTable = updateBatchRow(batchTableData(node), rowId, patch);
  touchProject({ sessionDelay: 250, coalesceSession: true });
}

export function reorderBatchRow(nodeId: string, rowId: string, direction: -1 | 1): void {
  updateBatchTable(nodeId, (table) => moveBatchRow(table, rowId, direction), { history: true });
}

export function appendBatchColumn(nodeId: string): void {
  updateBatchTable(nodeId, addBatchColumn, { history: true });
}

export function deleteBatchColumn(nodeId: string): void {
  updateBatchTable(nodeId, removeBatchColumn, { history: true });
}

export function setBatchTableSettings(nodeId: string, settings: Partial<Pick<BatchTableData, 'operation' | 'concurrency' | 'globalPrompt'>>): void {
  updateBatchTable(nodeId, (table) => ({ ...table, ...settings }));
}

export function canvasImageNodes(): AnyRecord[] {
  return (store.project.nodes as AnyRecord[]).filter((node) => {
    if (node.archived || node.type !== 'imageGeneration') return false;
    return Boolean(String(node.uploadedFile?.path || node.filePath || node.selectedOutputNodeId || '').trim())
      || (store.project.materials as AnyRecord[]).some((material) => material.nodeId === node.id);
  });
}

export function isCanvasImageNode(nodeId: string): boolean {
  const node = projectNode(nodeId);
  if (!node || node.archived || node.type !== 'imageGeneration') return false;
  return Boolean(String(node.uploadedFile?.path || node.filePath || node.selectedOutputNodeId || '').trim())
    || (store.project.materials as AnyRecord[]).some((material) => material.nodeId === node.id);
}

export function batchTableSummaryFor(nodeId: string) {
  return batchTableSummary(batchTableData(projectNode(nodeId)), batchReferenceDefaults(nodeId));
}

/** 表格级参考由真实连线决定；行级引用优先，空位使用列默认值。 */
export function batchReferenceDefaults(nodeId: string): string[] {
  const node = projectNode(nodeId);
  if (!node) return [];
  return batchColumnReferences(
    batchTableData(node),
    store.project.edges as AnyRecord[],
    nodeId,
    isCanvasImageNode,
  );
}

function connectRowReferences(output: AnyRecord, references: string[]): void {
  // 只回收本功能写入的参考边，用户手工加在产出节点上的参考保持不动。
  const edges = store.project.edges as AnyRecord[];
  for (let index = edges.length - 1; index >= 0; index -= 1) {
    const edge = edges[index];
    if (!edge) continue;
    if (edge?.target !== output.id || edge.data?.creationSource !== 'batch-table') continue;
    if (!references.includes(String(edge.source))) edges.splice(index, 1);
  }
  if (!references.length) return;
  const modes = getGenerationInputModes(String(output.model || ''));
  const mode = modes.find((item) => item.maxImages > 0);
  if (!mode) return;
  output.inputMode = mode.value;
  const occupied = (store.project.edges as AnyRecord[])
    .filter((edge) => edge.target === output.id)
    .map((edge) => edge.data?.inputSlot)
    .filter(Boolean) as GenerationInputSlot[];
  for (const sourceId of references) {
    const source = projectNode(sourceId);
    if (!source) continue;
    const slot = defaultInputSlot(mode.value, 'referenceImage', occupied);
    if (slot) occupied.push(slot);
    addCanvasEdge(store.project, sourceId, output.id, {
      edge: {
        kind: 'typed-input',
        data: { inputRole: 'referenceImage', ...(slot ? { inputSlot: slot } : {}), required: true, creationSource: 'batch-table' },
      },
    });
  }
}

function ensureRowOutput(tableNode: AnyRecord, table: BatchTableData, row: BatchRow, index: number): AnyRecord | null {
  const existing = projectNode(row.outputNodeId);
  const output = existing && existing.type === 'imageGeneration' ? existing : addNode('imageGeneration', { select: false });
  output.title = t(table.operation === 'creative' ? 'canvas.batch.creativeRowTitle' : 'canvas.batch.tryOnRowTitle', { index: index + 1 });
  output.prompt = batchRowPrompt(table, row);
  output.batchSourceNodeId = tableNode.id;
  output.batchRowId = row.id;
  output.canvasSectionId = tableNode.canvasSectionId ?? null;
  if (!existing || existing.type !== 'imageGeneration') {
    output.x = Math.round(Number(tableNode.x || 0) + Number(tableNode.canvasWidth || 1000) + 90 + (index % 3) * 380);
    output.y = Math.round(Number(tableNode.y || 0) + Math.floor(index / 3) * 320);
    row.outputNodeId = output.id;
  }
  return output;
}

function waitForNode(nodeId: string, project: AnyRecord, timeoutMs = 15 * 60 * 1000): Promise<void> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const tick = () => {
      if (store.project !== project) return resolve();
      const node = projectNode(nodeId);
      if (!node || node.archived) return resolve();
      if (!isActiveTaskStatus(node.status) && (isTerminalTaskStatus(node.status) || node.error)) return resolve();
      if (Date.now() - startedAt > timeoutMs) return resolve();
      window.setTimeout(tick, 1200);
    };
    tick();
  });
}

export function cancelBatchTableRun(nodeId: string): void {
  cancelledTables.add(nodeId);
  const node = projectNode(nodeId);
  if (!node) return;
  const table = batchTableData(node);
  node.batchTable = { ...table, runState: { ...(table.runState || { running: true, startedAt: '', total: table.rows.length, done: 0, failed: 0 }), running: false, cancelled: true } };
  touchProject();
}

export async function runBatchTable(nodeId: string, options: { rowIds?: string[]; force?: boolean } = {}): Promise<void> {
  const tableNode = projectNode(nodeId);
  if (!tableNode) return;
  const project = store.project;
  const table = batchTableData(tableNode);
  if (!getAvailableModelIdsByType('imageGeneration').length) {
    showToast(t('canvas.batch.noModel'));
    return;
  }
  const defaults = batchReferenceDefaults(nodeId);
  const rowIds = options.rowIds ? new Set(options.rowIds) : null;
  const targets = table.rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => (rowIds ? rowIds.has(row.id) : true))
    .filter(({ row }) => batchRowReady(table, row, batchRowReferences(row, defaults)));
  if (!targets.length) {
    showToast(t('canvas.batch.nothingToRun'));
    return;
  }
  cancelledTables.delete(nodeId);
  const runState = { running: true, startedAt: new Date().toISOString(), total: targets.length, done: 0, failed: 0, cancelled: false };
  tableNode.batchTable = { ...table, runState };
  touchProject();

  let cursor = 0;
  const concurrency = Math.max(1, Math.min(10, Number(table.concurrency) || 1));
  const worker = async () => {
    while (cursor < targets.length && !cancelledTables.has(nodeId)) {
      const target = targets[cursor];
      cursor += 1;
      if (!target) continue;
      const { row, index } = target;
      const current = batchTableData(tableNode);
      const currentRow = current.rows.find((item) => item.id === row.id);
      const defaultsNow = batchReferenceDefaults(nodeId);
      if (!currentRow || !batchRowReady(current, currentRow, batchRowReferences(currentRow, defaultsNow))) continue;
      const output = ensureRowOutput(tableNode, current, currentRow, index);
      if (!output) continue;
      const references = batchRowReferences(currentRow, defaults).filter(Boolean);
      connectRowReferences(output, references);
      const previousStatus = output.status;
      if (!options.force && previousStatus === 'completed' && !rowIds) {
        runState.done += 1;
        tableNode.batchTable = { ...batchTableData(tableNode), runState: { ...runState } };
        touchProject();
        continue;
      }
      runNode(output);
      await waitForNode(output.id, project);
      const finished = projectNode(output.id);
      runState.done += 1;
      if (finished && finished.status !== 'completed') runState.failed += 1;
      const next = batchTableData(tableNode);
      tableNode.batchTable = { ...next, runState: { ...runState } };
      touchProject();
    }
  };
  try {
    await Promise.all(Array.from({ length: concurrency }, worker));
  } finally {
    const finalTable = batchTableData(tableNode);
    tableNode.batchTable = {
      ...finalTable,
      runState: {
        ...runState,
        running: false,
        cancelled: cancelledTables.has(nodeId),
      },
    };
    cancelledTables.delete(nodeId);
    touchProject();
  }
}

export function newBatchTableNode(): Record<string, unknown> {
  return { batchTable: defaultBatchTable() };
}
