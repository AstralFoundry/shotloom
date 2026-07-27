import { store, touchProject } from '@/store/projectStore';
import { uid } from '@/utils/format';

export function deleteCanvasNodeData(nodeId, { touch = true } = {}) {
  const node = store.project.nodes.find((item) => item.id === nodeId);
  if (!node) return false;
  store.project.nodes = store.project.nodes.filter((item) => item.id !== nodeId);
  store.project.edges = store.project.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId);
  store.project.tasks = store.project.tasks.filter((task) => task.nodeId !== nodeId);
  if (store.selectedNodeId === nodeId) store.selectedNodeId = null;
  if (Array.isArray(store.selectedNodeIds)) {
    store.selectedNodeIds = store.selectedNodeIds.filter((id) => id !== nodeId);
  }
  if (store.connectFromId === nodeId) store.connectFromId = null;
  if (touch) touchProject();
  return true;
}

export function wouldCreateCanvasCycle(project, sourceId, targetId, edges = project?.edges || []) {
  if (!project || !sourceId || !targetId) return false;
  if (sourceId === targetId) return true;
  const outgoing = new Map();
  for (const edge of edges) {
    if (!edge?.source || !edge?.target) continue;
    if (!outgoing.has(edge.source)) outgoing.set(edge.source, []);
    outgoing.get(edge.source).push(edge.target);
  }
  const stack = [targetId];
  const visited = new Set();
  while (stack.length) {
    const current = stack.pop();
    if (current === sourceId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const next of outgoing.get(current) || []) {
      if (!visited.has(next)) stack.push(next);
    }
  }
  return false;
}

export function canConnectCanvasNodes(project, sourceId, targetId, edges = project?.edges || []) {
  if (!project || !sourceId || !targetId) return { ok: false, error: '连接节点无效' };
  if (sourceId === targetId) return { ok: false, error: '不能连接节点自身' };
  const source = project.nodes?.find((node) => node.id === sourceId);
  const target = project.nodes?.find((node) => node.id === targetId);
  if (!source) return { ok: false, error: '源节点不存在' };
  if (!target) return { ok: false, error: '目标节点不存在' };
  const existing = edges.find((edge) => edge.source === sourceId && edge.target === targetId);
  if (existing) return { ok: true, edge: existing, existed: true };
  if (wouldCreateCanvasCycle(project, sourceId, targetId, edges)) {
    return { ok: false, error: '连线会形成循环，画布工作流必须保持 DAG' };
  }
  return { ok: true, existed: false };
}

export function addCanvasEdge(project = store.project, sourceId, targetId, options = {}) {
  const result = canConnectCanvasNodes(project, sourceId, targetId, project?.edges || []);
  if (!result.ok) return result;
  if (result.existed) {
    if (options.updateExisting && options.edge) Object.assign(result.edge, options.edge);
    return result;
  }
  const edge = {
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

export function remapImportedNodeReferences(nodes, idMap) {
  return nodes.filter((node) => node.type !== 'group').map((node) => {
    if (node.parentGroupId) delete node.parentGroupId;
    return node;
  });
}
