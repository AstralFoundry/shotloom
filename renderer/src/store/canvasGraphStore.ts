import { t } from '../i18n/index.ts';
import { store as rawStore, touchProject } from '@/store/projectStore';
import { uid } from '@/utils/format';
import { assertProjectOperationIdle } from '@/services/projectOperationGuards';

// projectStore 的顶层字段只有最小类型，画布图对象在这里放宽为 any 边界。
type ProjectLike = {
  nodes: any[];
  edges: EdgeLike[];
  tasks: any[];
  [key: string]: any;
};
type StoreShape = {
  project: ProjectLike;
  selectedNodeId: any;
  selectedNodeIds: any;
  connectFromId: any;
};

type EdgeLike = { id?: string; source?: string; target?: string; [key: string]: unknown };

// projectStore ↔ taskStore ↔ nodeStore ↔ canvasGraphStore 存在循环依赖，
// 模块体执行时 projectStore 的导出可能尚未初始化，因此只能在调用时读取 live binding。
function store(): StoreShape {
  return rawStore as unknown as StoreShape;
}

// 过渡期：画布工程对象仍来自未类型化存储，各调用方以自身形状传入。
export type CanvasProjectLike = { [key: string]: any; nodes: any[]; edges: any[] };

export function deleteCanvasNodeData(nodeId: string, { touch = true }: { touch?: boolean } = {}): boolean {
  const current = store();
  assertProjectOperationIdle(current.project, [nodeId]);
  const node = current.project.nodes.find((item) => item.id === nodeId);
  if (!node) return false;
  if (node.type === 'threeDDirector' && Array.isArray(current.project.harnessSessions)) {
    const removed = current.project.harnessSessions.filter((session: { directorNodeId?: string }) => session.directorNodeId === nodeId);
    current.project.harnessSessions = current.project.harnessSessions.filter((session: { directorNodeId?: string }) => session.directorNodeId !== nodeId);
    if (removed.some((session: { id?: string }) => session.id === current.project.activeHarnessSessionId)) {
      current.project.activeHarnessSessionId = current.project.harnessSessions[0]?.id;
    }
  }
  current.project.nodes = current.project.nodes.filter((item) => item.id !== nodeId);
  current.project.edges = current.project.edges.filter(
    (edge) => edge.source !== nodeId && edge.target !== nodeId,
  );
  current.project.tasks = current.project.tasks.filter((task) => task.nodeId !== nodeId);
  if (current.selectedNodeId === nodeId) current.selectedNodeId = null;
  if (Array.isArray(current.selectedNodeIds)) {
    current.selectedNodeIds = current.selectedNodeIds.filter((id) => id !== nodeId);
  }
  if (current.connectFromId === nodeId) current.connectFromId = null;
  if (touch) touchProject();
  return true;
}

export function wouldCreateCanvasCycle(
  project: { edges?: EdgeLike[] } | null | undefined,
  sourceId: string,
  targetId: string,
  edges: EdgeLike[] = project?.edges || [],
): boolean {
  if (!project || !sourceId || !targetId) return false;
  if (sourceId === targetId) return true;
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    if (!edge?.source || !edge?.target) continue;
    const targets = outgoing.get(edge.source);
    if (targets) targets.push(edge.target);
    else outgoing.set(edge.source, [edge.target]);
  }
  const stack = [targetId];
  const visited = new Set<string>();
  while (stack.length) {
    const current = stack.pop();
    if (current === undefined) break;
    if (current === sourceId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const next of outgoing.get(current) || []) {
      if (!visited.has(next)) stack.push(next);
    }
  }
  return false;
}

export type CanvasConnectResult =
  | { ok: true; edge?: EdgeLike; existed: boolean }
  | { ok: false; error: string };

export function canConnectCanvasNodes(
  project: CanvasProjectLike | null | undefined,
  sourceId: string,
  targetId: string,
  edges: EdgeLike[] = project?.edges || [],
): CanvasConnectResult {
  if (!project || !sourceId || !targetId) return { ok: false, error: t("ui.canvasGraphStore.text.0e12c8c0") };
  if (sourceId === targetId) return { ok: false, error: t("ui.canvasGraphStore.text.d77ea665") };
  const source = project.nodes?.find((node) => node.id === sourceId);
  const target = project.nodes?.find((node) => node.id === targetId);
  if (!source) return { ok: false, error: t("ui.canvasGraphStore.text.945ffbe2") };
  if (!target) return { ok: false, error: t("ui.canvasGraphStore.text.6d3d6060") };
  const existing = edges.find((edge) => edge.source === sourceId && edge.target === targetId);
  if (existing) return { ok: true, edge: existing, existed: true };
  if (wouldCreateCanvasCycle(project, sourceId, targetId, edges)) {
    return { ok: false, error: t("ui.canvasGraphStore.text.b459c64b") };
  }
  return { ok: true, existed: false };
}

export function addCanvasEdge(
  project: CanvasProjectLike,
  sourceId: string,
  targetId: string,
  options: { id?: string; kind?: string; edge?: EdgeLike; touch?: boolean; updateExisting?: boolean } = {},
): CanvasConnectResult {
  const result = canConnectCanvasNodes(project, sourceId, targetId, project.edges || []);
  if (!result.ok) return result;
  if (result.existed) {
    if (options.updateExisting && result.edge && options.edge) Object.assign(result.edge, options.edge);
    return result;
  }
  const edge: EdgeLike = {
    id: options.id || uid(),
    source: sourceId,
    target: targetId,
    ...(options.kind ? { kind: options.kind } : {}),
    ...(options.edge || {}),
  };
  project.edges.push(edge);
  if (options.touch !== false) touchProject();
  return { ok: true, edge, existed: false };
}

export function remapImportedNodeReferences(nodes: any[], _idMap?: Map<string, string>): any[] {
  return nodes.filter((node) => node.type !== 'group').map((node) => {
    if (node.parentGroupId) delete node.parentGroupId;
    return node;
  });
}
