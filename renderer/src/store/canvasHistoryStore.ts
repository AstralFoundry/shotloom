import { t } from '../i18n/index.ts';
import { computed } from '@/store/domainReactivity';
import { store, touchProject } from '@/store/projectStore';
import {
  applyCanvasTransaction,
  captureCanvasTransaction,
  type CanvasTransaction,
} from '@/utils/canvasTransaction.ts';

// 与 projectStore 互为循环引用，只能在调用时读取它的 `store` 绑定。

// 结构性操作仍需完整快照；高频移动只记录受影响节点的坐标。
// 限制近期记录数量，避免项目文件、启动 IPC 和 Agent 画布上下文持续膨胀。
export const MAX_CANVAS_HISTORY = 8;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function snapshot(label = t("ui.canvasHistoryStore.text.51ff2c28")) {
  return {
    label,
    createdAt: new Date().toISOString(),
    nodes: clone(store.project.nodes || []),
    edges: clone(store.project.edges || []),
    materials: clone(store.project.materials || []),
    selectedNodeId: store.selectedNodeId || null,
    selectedNodeIds: [...(store.selectedNodeIds || [])],
  };
}

function ensureHistory() {
  if (!Array.isArray(store.project.canvasHistory)) store.project.canvasHistory = [];
  if (!Array.isArray(store.project.canvasRedoStack)) store.project.canvasRedoStack = [];
}

export const canUndoCanvas = computed(
  () => Array.isArray(store.project.canvasHistory) && store.project.canvasHistory.length > 0,
);
export const canRedoCanvas = computed(
  () => Array.isArray(store.project.canvasRedoStack) && store.project.canvasRedoStack.length > 0,
);

function restore(entry: { [key: string]: any }) {
  if (entry?.kind === 'canvas-transaction') {
    applyCanvasTransaction(store.project, entry as CanvasTransaction);
    store.selectedNodeId = entry.selectedNodeId || null;
    store.selectedNodeIds = [...(entry.selectedNodeIds || [])];
    touchProject();
    return;
  }
  if (entry?.kind === 'node-positions') {
    const positions = new Map<string, { id: string; x: number; y: number }>(
      (entry.positions || []).map(
        (item: { id: string; x: number; y: number }) => [item.id, item] as const,
      ),
    );
    for (const node of store.project.nodes || []) {
      const position = positions.get(node.id);
      if (!position) continue;
      node.x = position.x;
      node.y = position.y;
    }
    touchProject();
    return;
  }
  store.project.nodes = clone(entry.nodes || []);
  store.project.edges = clone(entry.edges || []);
  store.project.materials = clone(entry.materials || []);
  store.selectedNodeId = entry.selectedNodeId || null;
  store.selectedNodeIds = [...(entry.selectedNodeIds || [])];
  touchProject();
}

export function recordCanvasHistory(label: string) {
  ensureHistory();
  store.project.canvasHistory.unshift(snapshot(label));
  store.project.canvasHistory = store.project.canvasHistory.slice(0, MAX_CANVAS_HISTORY);
  store.project.canvasRedoStack = [];
}

function nodePositionSnapshot(nodeIds: string[], label: string) {
  const ids = new Set(nodeIds);
  return {
    kind: 'node-positions',
    label,
    createdAt: new Date().toISOString(),
    positions: (store.project.nodes || [])
      .filter((node: { id: string }) => ids.has(node.id))
      .map((node: { id: string; x: unknown; y: unknown }) => ({
        id: node.id,
        x: Number(node.x) || 0,
        y: Number(node.y) || 0,
      })),
  };
}

export function recordCanvasPositionHistory(nodeIds: string[], label = t("ui.canvasHistoryStore.text.c4aa4abc")) {
  ensureHistory();
  store.project.canvasHistory.unshift(nodePositionSnapshot(nodeIds, label));
  store.project.canvasHistory = store.project.canvasHistory.slice(0, MAX_CANVAS_HISTORY);
  store.project.canvasRedoStack = [];
}

export function recordCanvasTransactionHistory(label: string | undefined, transaction: { [key: string]: any }) {
  ensureHistory();
  store.project.canvasHistory.unshift({
    ...transaction,
    kind: 'canvas-transaction',
    label: label || t("ui.canvasHistoryStore.text.51ff2c28"),
    createdAt: new Date().toISOString(),
  });
  store.project.canvasHistory = store.project.canvasHistory.slice(0, MAX_CANVAS_HISTORY);
  store.project.canvasRedoStack = [];
}

/**
 * 记录调用方在批量修改前捕获的画布状态。Agent 只有执行完成后才能确认
 * 是否真的发生了修改，因此用这个入口补记批次前快照，避免空撤销记录。
 */
export function recordCanvasHistoryState(label: string, state: { [key: string]: any } = {}) {
  ensureHistory();
  store.project.canvasHistory.unshift({
    label: label || t("ui.canvasHistoryStore.text.51ff2c28"),
    createdAt: new Date().toISOString(),
    nodes: clone(state.nodes || []),
    edges: clone(state.edges || []),
    materials: clone(state.materials || []),
    selectedNodeId: state.selectedNodeId || null,
    selectedNodeIds: [...(state.selectedNodeIds || [])],
  });
  store.project.canvasHistory = store.project.canvasHistory.slice(0, MAX_CANVAS_HISTORY);
  store.project.canvasRedoStack = [];
}

export function undoCanvas() {
  ensureHistory();
  const previous = store.project.canvasHistory.shift();
  if (!previous) return false;
  store.project.canvasRedoStack.unshift(
    previous.kind === 'canvas-transaction'
      ? {
          ...captureCanvasTransaction(
            store.project,
            previous.nodes.map((item: { id: string }) => item.id),
            previous.edges.map((item: { id: string }) => item.id),
            { selectedNodeId: store.selectedNodeId, selectedNodeIds: store.selectedNodeIds },
          ),
          label: t("ui.canvasHistoryStore.text.ab729947"),
          createdAt: new Date().toISOString(),
        }
      : previous.kind === 'node-positions'
      ? nodePositionSnapshot(
          previous.positions.map((item: { id: string }) => item.id),
          t("ui.canvasHistoryStore.text.d8a98b07"),
        )
      : snapshot(t("ui.canvasHistoryStore.text.3514256b")),
  );
  store.project.canvasRedoStack = store.project.canvasRedoStack.slice(0, MAX_CANVAS_HISTORY);
  restore(previous);
  return true;
}

export function redoCanvas() {
  ensureHistory();
  const next = store.project.canvasRedoStack.shift();
  if (!next) return false;
  store.project.canvasHistory.unshift(
    next.kind === 'canvas-transaction'
      ? {
          ...captureCanvasTransaction(
            store.project,
            next.nodes.map((item: { id: string }) => item.id),
            next.edges.map((item: { id: string }) => item.id),
            { selectedNodeId: store.selectedNodeId, selectedNodeIds: store.selectedNodeIds },
          ),
          label: t("ui.canvasHistoryStore.text.6111defe"),
          createdAt: new Date().toISOString(),
        }
      : next.kind === 'node-positions'
      ? nodePositionSnapshot(
          next.positions.map((item: { id: string }) => item.id),
          t("ui.canvasHistoryStore.text.08abe193"),
        )
      : snapshot(t("ui.canvasHistoryStore.text.5ac11272")),
  );
  store.project.canvasHistory = store.project.canvasHistory.slice(0, MAX_CANVAS_HISTORY);
  restore(next);
  return true;
}
