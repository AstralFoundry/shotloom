import { addCanvasEdge, deleteCanvasNodeData } from '@/store/canvasGraphStore';
import { toggleCanvasEdge } from '@/store/canvasEdgeStore';
import { cancelNode } from '@/store/taskStore';
import { validateAgentInputRole } from '@/services/agentInputRole';
import { canvasNodeDimensions } from '@/services/agentLayoutService';
import { uid } from '@/utils/format';
import type { AgentAction, AgentActionResult, AgentInputRole } from './agentTypes';

type CanvasAction = AgentAction & Record<string, any>;
type CanvasActionContext = Record<string, any>;

const CANVAS_ACTIONS = new Set([
  'create_note_node', 'connect_nodes', 'delete_node', 'delete_edge', 'move_node', 'toggle_edge',
]);

export function handleAgentCanvasAction(
  action: CanvasAction,
  context: CanvasActionContext,
): AgentActionResult | null {
  const type = action?.type;
  if (!CANVAS_ACTIONS.has(type)) return null;
  const {
    project, resolveNode, resolveNodeId, numberFromAction,
    defaultNodePosition, sizeFromAction, tempIdMap,
  } = context;

  if (type === 'create_note_node') {
    const content = String(action.content || '').trim();
    if (!content) return { applied: false, error: '文本节点内容不能为空' };
    const position = defaultNodePosition(action);
    const dimensions = canvasNodeDimensions({ type: 'note' });
    const node = {
      id: uid(),
      type: 'note',
      ...(action.tempId ? { agentTempId: String(action.tempId) } : {}),
      title: String(action.title || action.name || '剧本文本'),
      content,
      textContent: content,
      status: 'idle',
      width: sizeFromAction(action, 'width', dimensions.width),
      height: sizeFromAction(action, 'height', dimensions.height),
      x: position.x,
      y: position.y,
      createdAt: new Date().toISOString(),
      agentPlan: action.agentPlan || (action.tempId ? {
        id: action.tempId,
        source: 'assistant',
        artifactRole: action.artifactRole || 'script-scene',
        segmentIds: Array.isArray(action.segmentIds) ? [...action.segmentIds] : [],
      } : null),
    };
    project.nodes.push(node);
    if (action.tempId) tempIdMap.set(action.tempId, node.id);
    return { applied: true, createdNodeId: node.id, nodeId: node.id };
  }

  if (type === 'connect_nodes') {
    const sourceId = resolveNodeId(action.source);
    const targetId = resolveNodeId(action.target);
    const requestedRole = String(action.role || 'auto') as AgentInputRole | 'auto';
    const source = project.nodes.find((node: any) => node.id === sourceId);
    const target = project.nodes.find((node: any) => node.id === targetId);
    const validation = validateAgentInputRole(project, source, target, requestedRole);
    if (!validation.valid) return { applied: false, error: validation.error };
    const role = validation.role;
    const result = addCanvasEdge(project, sourceId, targetId, {
      touch: false,
      updateExisting: true,
      edge: {
        kind: 'typed-input',
        data: {
          inputRole: role,
          required: action.required !== false,
        },
      },
    });
    return { applied: Boolean(result.ok), edgeId: result.edge?.id || null, error: result.error, existed: result.existed };
  }
  if (type === 'delete_node') {
    const node = resolveNode(action.nodeId);
    if (!node) return { applied: false };
    cancelNode(node.id);
    return { applied: deleteCanvasNodeData(node.id, { touch: false }), nodeId: node.id };
  }
  if (type === 'delete_edge') {
    const before = project.edges.length;
    const sourceId = resolveNodeId(action.source);
    const targetId = resolveNodeId(action.target);
    project.edges = project.edges.filter((edge: any) => (
      action.edgeId ? edge.id !== action.edgeId : !(edge.source === sourceId && edge.target === targetId)
    ));
    return { applied: before !== project.edges.length };
  }
  if (type === 'move_node') {
    const node = resolveNode(action.nodeId);
    if (!node || (!action.position && action.x == null && action.y == null)) return { applied: false };
    node.x = numberFromAction(action, 'x', node.x);
    node.y = numberFromAction(action, 'y', node.y);
    return { applied: true, nodeId: node.id };
  }
  if (type === 'toggle_edge') {
    const { resolveNodeId } = context;
    const sourceId = resolveNodeId(action.source);
    const targetId = resolveNodeId(action.target);
    let edgeId: string | null = action.edgeId || null;
    if (!edgeId && sourceId && targetId) {
      const edge = project.edges.find(
        (e: any) => e.source === sourceId && e.target === targetId,
      );
      if (edge) edgeId = edge.id;
    }
    if (!edgeId) return { applied: false, error: 'toggle_edge 需要 edgeId 或 source+target 定位到已存在的边' };
    const applied = toggleCanvasEdge(project, edgeId, action.enabled);
    return { applied, edgeId };
  }
  return null;
}

// ── 自注册到 ActionRegistry ────────────────────────────────────────────────
