import { computed } from '@/store/domainReactivity';
import { store, touchProject } from '@/store/projectStore';

// 每条撤销记录都包含完整节点快照。大型工作流中 40 条会把项目文件膨胀数 MB，
// 拖垮启动 IPC 和 Agent 画布上下文；8 条足够覆盖近期误操作，同时保持文件可控。
export const MAX_CANVAS_HISTORY = 8;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function snapshot(label = '画布操作') {
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

export const canUndoCanvas = computed(() => Array.isArray(store.project.canvasHistory) && store.project.canvasHistory.length > 0);
export const canRedoCanvas = computed(() => Array.isArray(store.project.canvasRedoStack) && store.project.canvasRedoStack.length > 0);

function restore(entry) {
  store.project.nodes = clone(entry.nodes || []);
  store.project.edges = clone(entry.edges || []);
  store.project.materials = clone(entry.materials || []);
  store.selectedNodeId = entry.selectedNodeId || null;
  store.selectedNodeIds = [...(entry.selectedNodeIds || [])];
  touchProject();
}

export function recordCanvasHistory(label) {
  ensureHistory();
  store.project.canvasHistory.unshift(snapshot(label));
  store.project.canvasHistory = store.project.canvasHistory.slice(0, MAX_CANVAS_HISTORY);
  store.project.canvasRedoStack = [];
}

/**
 * 记录调用方在批量修改前捕获的画布状态。Agent 只有执行完成后才能确认
 * 是否真的发生了修改，因此用这个入口补记批次前快照，避免空撤销记录。
 */
export function recordCanvasHistoryState(label, state = {}) {
  ensureHistory();
  store.project.canvasHistory.unshift({
    label: label || '画布操作',
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
  store.project.canvasRedoStack.unshift(snapshot('重做快照'));
  store.project.canvasRedoStack = store.project.canvasRedoStack.slice(0, MAX_CANVAS_HISTORY);
  restore(previous);
  return true;
}

export function redoCanvas() {
  ensureHistory();
  const next = store.project.canvasRedoStack.shift();
  if (!next) return false;
  store.project.canvasHistory.unshift(snapshot('撤销快照'));
  store.project.canvasHistory = store.project.canvasHistory.slice(0, MAX_CANVAS_HISTORY);
  restore(next);
  return true;
}
