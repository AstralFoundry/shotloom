/**
 * Agent 画布上下文选择器（纯 JavaScript 模块，可独立回归测试）。
 *
 * Renderer 保存完整项目；模型只应看到完成当前决策所需的最小事实。本模块负责：
 * 1. 为画布变化分配会话内单调递增的 revision；
 * 2. 根据 summary/timeline/working/full 选择不同信息密度；
 * 3. 为 sinceRevision 请求返回节点、连线和任务的差量，而不是重复整个画布。
 *
 * revision 只用于当前应用会话内的增量同步，不写入项目文件，也不能作为业务 ID。
 */

import type {
  AgentEdge,
  AgentNode,
  AgentProject,
  AgentTask,
  JsonObject,
  JsonValue,
} from './agentTypes';

interface SnapshotSignatures {
  nodes: Map<string, string>;
  edges: Map<string, string>;
  tasks: Map<string, string>;
}

interface RevisionState {
  revision: number;
  fingerprint: string;
  history: Map<number, SnapshotSignatures>;
}

interface CanvasSnapshot {
  project?: JsonObject;
  projectDir?: string | null;
  filePath?: string | null;
  nodes: AgentNode[];
  edges: AgentEdge[];
  tasks: AgentTask[];
  assets: JsonValue[];
  materials: JsonValue[];
  selectedNodeIds?: string[];
  aliasMap: Record<string, string>;
  agentSettings?: JsonObject;
}

interface CompactAgentNode extends JsonObject {
  id: string;
  semanticId: string | null;
  alias: string | null;
  type: string;
  title: string;
  model: string;
  status: string;
  segmentIds: string[];
  artifactRole: string;
  promptSummary: string;
  outputSpec: JsonObject;
}

interface CanvasContextRequest {
  view?: 'summary' | 'timeline' | 'working' | 'selection' | 'full';
  sinceRevision?: number;
  nodeIds?: string[];
  segmentIds?: string[];
}

const projectRevisionStates = new WeakMap<object, RevisionState>();
const MAX_REVISIONS = 20;
const BINARY_FIELD_PATTERN = /^(?:b64_json|base64|base64Data|binary|bytes)$/i;

function omittedMediaValue(value: string): string {
  const mime = value.match(/^data:([^;,]+)/i)?.[1] || 'binary';
  return `[媒体正文已省略：${mime}，${value.length} 字符；请通过节点或资源 ID 引用]`;
}

/**
 * Preserve semantic text exactly while keeping raw media bytes outside the
 * model context. The complete value remains in the project store.
 */
export function omitModelBinaryPayloads<T>(value: T, field = ''): T {
  if (typeof value === 'string') {
    if (/^data:[^;,]+;base64,/i.test(value)) return omittedMediaValue(value) as T;
    if (value.length > 2_048 && BINARY_FIELD_PATTERN.test(field) && /^[a-z0-9+/=_-]+$/i.test(value)) {
      return omittedMediaValue(value) as T;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => omitModelBinaryPayloads(item, field)) as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key, omitModelBinaryPayloads(item, key)])) as T;
  }
  return value;
}

function semanticId(node: AgentNode): string | null {
  return node.agentSemanticId
    || node.agentPlan?.semanticId
    || node.agentPlan?.id
    || node.agentTempId
    || null;
}

function compactPrompt(node: AgentNode): string {
  const prompt = String(node.prompt || '').trim();
  if (!prompt) return '';
  return prompt.length > 180 ? `${prompt.slice(0, 180)}…` : prompt;
}

/** 模型浏览索引时使用的紧凑节点，不携带媒体、长提示词和历史结果。 */
export function compactAgentNode(node: AgentNode): CompactAgentNode {
  return {
    id: node.id,
    semanticId: semanticId(node),
    alias: node.alias || null,
    type: node.type,
    title: node.title || node.name || '',
    model: String(node.model || ''),
    status: node.status || 'idle',
    segmentIds: [...(node.segmentIds || node.agentPlan?.segmentIds || [])],
    artifactRole: node.artifactRole || node.agentPlan?.artifactRole || '',
    promptSummary: compactPrompt(node),
    outputSpec: node.outputSpec || {},
  };
}

function itemSignatures(items: JsonObject[] = []): Map<string, string> {
  return new Map(items.map((item) => [String(item.id), JSON.stringify(item)]));
}

function snapshotSignatures(snapshot: CanvasSnapshot): SnapshotSignatures {
  return {
    nodes: itemSignatures(snapshot.nodes),
    edges: itemSignatures(snapshot.edges),
    tasks: itemSignatures(snapshot.tasks),
  };
}

function canvasFingerprint(snapshot: CanvasSnapshot): string {
  // updatedAt 由所有正常项目写操作更新；计数与选择用于覆盖尚未落盘的 UI 变化。
  return JSON.stringify({
    updatedAt: snapshot.project?.updatedAt || null,
    nodeCount: snapshot.nodes.length,
    edgeCount: snapshot.edges.length,
    taskCount: snapshot.tasks.length,
    selectedNodeIds: snapshot.selectedNodeIds,
  });
}

function revisionState(project: object, snapshot: CanvasSnapshot): RevisionState {
  const fingerprint = canvasFingerprint(snapshot);
  let state = projectRevisionStates.get(project);
  if (!state) {
    state = { revision: 1, fingerprint, history: new Map() };
    projectRevisionStates.set(project, state);
  } else if (state.fingerprint !== fingerprint) {
    state.revision += 1;
    state.fingerprint = fingerprint;
  }
  state.history.set(state.revision, snapshotSignatures(snapshot));
  while (state.history.size > MAX_REVISIONS) {
    const oldest = state.history.keys().next().value;
    if (oldest !== undefined) state.history.delete(oldest);
  }
  return state;
}

function changedIds(previous: Map<string, string>, current: Map<string, string>) {
  const created = [];
  const updated = [];
  const deleted = [];
  for (const [id, signature] of current.entries()) {
    if (!previous.has(id)) created.push(id);
    else if (previous.get(id) !== signature) updated.push(id);
  }
  for (const id of previous.keys()) {
    if (!current.has(id)) deleted.push(id);
  }
  return { created, updated, deleted };
}

function selectByIds<T extends JsonObject>(items: T[], ids: string[]): T[] {
  const wanted = new Set(ids);
  return items.filter((item) => wanted.has(String(item.id)));
}

function deltaContext(snapshot: CanvasSnapshot, state: RevisionState, sinceRevision: number) {
  const previous = state.history.get(Number(sinceRevision));
  if (!previous) return null;
  const current = snapshotSignatures(snapshot);
  const nodeChanges = changedIds(previous.nodes, current.nodes);
  const edgeChanges = changedIds(previous.edges, current.edges);
  const taskChanges = changedIds(previous.tasks, current.tasks);
  return {
    success: true,
    contextMode: 'delta',
    revision: state.revision,
    baseRevision: Number(sinceRevision),
    resetRequired: false,
    changes: {
      createdNodes: selectByIds(snapshot.nodes, nodeChanges.created).map(compactAgentNode),
      updatedNodes: selectByIds(snapshot.nodes, nodeChanges.updated).map(compactAgentNode),
      deletedNodeIds: nodeChanges.deleted,
      createdEdges: selectByIds(snapshot.edges, edgeChanges.created),
      updatedEdges: selectByIds(snapshot.edges, edgeChanges.updated),
      deletedEdgeIds: edgeChanges.deleted,
      createdTasks: selectByIds(snapshot.tasks, taskChanges.created),
      updatedTasks: selectByIds(snapshot.tasks, taskChanges.updated),
      deletedTaskIds: taskChanges.deleted,
    },
  };
}

function baseContext(snapshot: CanvasSnapshot, state: RevisionState, mode: string) {
  return {
    success: true,
    contextMode: mode,
    revision: state.revision,
    project: snapshot.project,
    projectDir: snapshot.projectDir,
    filePath: snapshot.filePath,
    summary: {
      nodeCount: snapshot.nodes.length,
      edgeCount: snapshot.edges.length,
      taskCount: snapshot.tasks.length,
      assetCount: snapshot.assets.length,
      materialCount: snapshot.materials.length,
      selectedNodeIds: snapshot.selectedNodeIds,
    },
    agentSettings: snapshot.agentSettings,
  };
}

function timelineContext(snapshot: CanvasSnapshot, state: RevisionState) {
  const base = baseContext(snapshot, state, 'timeline');
  const segments = new Map<string, CompactAgentNode[]>();
  for (const node of snapshot.nodes) {
    const compact = compactAgentNode(node);
    for (const segmentId of compact.segmentIds) {
      if (!segments.has(segmentId)) segments.set(segmentId, []);
      segments.get(segmentId)?.push(compact);
    }
  }
  return {
    ...base,
    segments: [...segments.entries()].map(([id, nodes]) => ({ id, nodes })),
    unsegmentedNodes: snapshot.nodes
      .filter((node) => !(node.segmentIds || node.agentPlan?.segmentIds || []).length)
      .map(compactAgentNode),
  };
}

function workingContext(snapshot: CanvasSnapshot, state: RevisionState, request: CanvasContextRequest) {
  const requestedIds = new Set((request.nodeIds || []).map(String));
  const segmentIds = new Set((request.segmentIds || []).map(String));
  for (const node of snapshot.nodes) {
    const nodeSegments = node.segmentIds || node.agentPlan?.segmentIds || [];
    if (nodeSegments.some((id) => segmentIds.has(String(id)))) requestedIds.add(String(node.id));
    if (requestedIds.has(String(semanticId(node)))) requestedIds.add(String(node.id));
  }
  // 当前节点的一跳上下游通常足够判断引用关系；更远节点由后续 working 请求按需读取。
  for (const edge of snapshot.edges) {
    if (requestedIds.has(String(edge.source)) || requestedIds.has(String(edge.target))) {
      requestedIds.add(String(edge.source));
      requestedIds.add(String(edge.target));
    }
  }
  const nodes = snapshot.nodes.filter((node) => requestedIds.has(String(node.id)));
  const nodeIds = new Set(nodes.map((node) => String(node.id)));
  return {
    ...baseContext(snapshot, state, 'working'),
    nodes,
    edges: snapshot.edges.filter((edge) => nodeIds.has(String(edge.source)) && nodeIds.has(String(edge.target))),
    tasks: snapshot.tasks.filter((task) => nodeIds.has(String(task.nodeId))),
    aliasMap: Object.fromEntries(Object.entries(snapshot.aliasMap).filter(([, id]) => nodeIds.has(String(id)))),
    semanticMap: Object.fromEntries(nodes.map((node) => [semanticId(node), node.id]).filter(([id]) => id)),
  };
}

function selectionContext(snapshot: CanvasSnapshot, state: RevisionState) {
  const selectedIds = new Set((snapshot.selectedNodeIds || []).map(String));
  const visibleIds = new Set(selectedIds);
  for (const edge of snapshot.edges) {
    if (selectedIds.has(String(edge.source)) || selectedIds.has(String(edge.target))) {
      visibleIds.add(String(edge.source));
      visibleIds.add(String(edge.target));
    }
  }
  const nodes = snapshot.nodes.filter((node) => visibleIds.has(String(node.id)));
  return {
    ...baseContext(snapshot, state, 'selection'),
    nodes,
    edges: snapshot.edges.filter((edge) => (
      visibleIds.has(String(edge.source)) && visibleIds.has(String(edge.target))
    )),
    tasks: snapshot.tasks.filter((task) => visibleIds.has(String(task.nodeId))),
    aliasMap: Object.fromEntries(Object.entries(snapshot.aliasMap)
      .filter(([, id]) => visibleIds.has(String(id)))),
    semanticMap: Object.fromEntries(nodes
      .map((node) => [semanticId(node), node.id])
      .filter(([id]) => id)),
  };
}

/**
 * 从完整快照生成模型可见上下文。未知 revision 会返回当前视图并标记 resetRequired，
 * 让调用方重新建立基线，而不是错误地假设没有变化。
 */
export function buildCanvasContext(
  project: AgentProject,
  snapshot: CanvasSnapshot,
  request: CanvasContextRequest = {},
) {
  const state = revisionState(project, snapshot);
  const requestedUnknownRevision = request.sinceRevision != null
    && Number(request.sinceRevision) !== state.revision
    && !state.history.has(Number(request.sinceRevision));
  if (request.sinceRevision != null && Number(request.sinceRevision) !== state.revision) {
    const delta = deltaContext(snapshot, state, request.sinceRevision);
    if (delta) return omitModelBinaryPayloads(delta);
  }
  const mode = request.view && ['summary', 'timeline', 'working', 'selection', 'full'].includes(request.view)
    ? request.view
    : 'full';
  let context;
  if (mode === 'full') context = { ...snapshot, contextMode: 'full', revision: state.revision };
  else if (mode === 'timeline') context = timelineContext(snapshot, state);
  else if (mode === 'working') context = workingContext(snapshot, state, request);
  else if (mode === 'selection') context = selectionContext(snapshot, state);
  else {
    const selectedIds = new Set(snapshot.selectedNodeIds || []);
    const selected = snapshot.nodes.filter((node) => selectedIds.has(node.id));
    const recent = snapshot.nodes
      .filter((node) => !selectedIds.has(node.id))
      .slice(-Math.max(0, 30 - selected.length));
    const visibleNodes = [...selected, ...recent];
    const visibleIds = new Set(visibleNodes.map((node) => node.id));
    context = {
      ...baseContext(snapshot, state, 'summary'),
      nodes: visibleNodes.map(compactAgentNode),
      truncatedNodeCount: Math.max(0, snapshot.nodes.length - visibleNodes.length),
      aliasMap: Object.fromEntries(Object.entries(snapshot.aliasMap)
        .filter(([, id]) => visibleIds.has(id))),
      semanticMap: Object.fromEntries(visibleNodes
      .map((node) => [semanticId(node), node.id])
      .filter(([id]) => id)),
    };
  }
  const result = requestedUnknownRevision ? { ...context, resetRequired: true } : context;
  return omitModelBinaryPayloads(result);
}
