/**
 * 把模板规划成一次画布实例：创建哪些节点、连哪些线、按什么顺序执行。
 *
 * 这一层不碰画布 store，只产出可检查的计划，便于在真正创建节点前
 * 一次性报出"缺素材绑定""缺配方"这类问题。
 */

import type { WorkflowDefinition, WorkflowMediaType, WorkflowRecipeNode, WorkflowRole } from './types';

export type WorkflowCanvasNodeType =
  | 'resource'
  | 'imageGeneration'
  | 'videoGeneration'
  | 'audioGeneration'
  | 'textGeneration';

export interface PlannedInstanceNode {
  /** 模板里的节点 id，用于把计划映射回创建的画布节点。 */
  sourceId: string;
  type: WorkflowCanvasNodeType;
  role: WorkflowRole;
  mediaType: WorkflowMediaType;
  title: string;
  /** 输入槽位绑定的素材 id。 */
  resourceId?: string;
  /** 固定文本内容。 */
  content?: string;
  prompt?: string;
  model?: string;
  config?: Record<string, unknown>;
  outputSpec?: unknown;
}

export interface PlannedInstanceEdge {
  from: string;
  to: string;
  toPort?: string;
}

export interface WorkflowInstancePlan {
  nodes: PlannedInstanceNode[];
  edges: PlannedInstanceEdge[];
  /** 只包含生成步骤的拓扑顺序。 */
  executionOrder: string[];
  issues: string[];
}

const NODE_TYPE: Record<WorkflowMediaType, WorkflowCanvasNodeType> = {
  image: 'imageGeneration',
  video: 'videoGeneration',
  audio: 'audioGeneration',
  text: 'textGeneration',
};

/** 生成步骤之间的拓扑序；输入与固定内容不参与排序。 */
export function generationExecutionOrder(definition: WorkflowDefinition): { order: string[]; missing: string[] } {
  const generationIds = new Set(
    definition.nodes.filter((node) => node.role === 'generation').map((node) => node.id),
  );
  const indegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const id of generationIds) {
    indegree.set(id, 0);
    outgoing.set(id, []);
  }
  for (const edge of definition.edges) {
    if (!generationIds.has(edge.fromNodeId) || !generationIds.has(edge.toNodeId)) continue;
    indegree.set(edge.toNodeId, (indegree.get(edge.toNodeId) || 0) + 1);
    outgoing.get(edge.fromNodeId)?.push(edge.toNodeId);
  }
  const queue = [...indegree.entries()].filter(([, count]) => count === 0).map(([id]) => id);
  const order: string[] = [];
  while (queue.length) {
    const current = queue.shift() as string;
    order.push(current);
    for (const next of outgoing.get(current) || []) {
      const remaining = (indegree.get(next) || 0) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }
  return { order, missing: [...generationIds].filter((id) => !order.includes(id)) };
}

/**
 * 规划一次实例。
 *
 * @param bindings 输入槽位 id → 素材 id（用户运行时选择）；缺省回落到模板里保存的绑定。
 */
export function planWorkflowInstance({
  definition,
  recipe,
  bindings = {},
}: {
  definition: WorkflowDefinition;
  recipe: Record<string, WorkflowRecipeNode>;
  bindings?: Record<string, string | undefined>;
}): WorkflowInstancePlan {
  const issues: string[] = [];
  const nodes: PlannedInstanceNode[] = [];
  const nodeIds = new Set(definition.nodes.map((node) => node.id));

  for (const node of definition.nodes) {
    if (node.role === 'input') {
      const resourceId = String(bindings[node.id] || node.resourceId || '').trim();
      if (!resourceId) issues.push(`missing-input:${node.id}`);
      nodes.push({
        sourceId: node.id,
        type: 'resource',
        role: node.role,
        mediaType: node.mediaType,
        title: node.title,
        ...(resourceId ? { resourceId } : {}),
      });
      continue;
    }
    if (node.role === 'constant') {
      nodes.push({
        sourceId: node.id,
        type: NODE_TYPE[node.mediaType],
        role: node.role,
        mediaType: node.mediaType,
        title: node.title,
        content: String(node.text || ''),
      });
      continue;
    }
    const recipeNode = recipe[node.id];
    if (!recipeNode) issues.push(`missing-recipe:${node.id}`);
    nodes.push({
      sourceId: node.id,
      type: NODE_TYPE[node.mediaType],
      role: node.role,
      mediaType: node.mediaType,
      title: node.title,
      ...(recipeNode?.prompt !== undefined ? { prompt: recipeNode.prompt } : {}),
      ...(recipeNode?.model !== undefined ? { model: recipeNode.model } : {}),
      ...(recipeNode?.config !== undefined ? { config: recipeNode.config } : {}),
      ...(recipeNode?.outputSpec !== undefined ? { outputSpec: recipeNode.outputSpec } : {}),
    });
  }

  const edges: PlannedInstanceEdge[] = definition.edges
    .filter((edge) => nodeIds.has(edge.fromNodeId) && nodeIds.has(edge.toNodeId))
    .map((edge) => ({
      from: edge.fromNodeId,
      to: edge.toNodeId,
      ...(edge.toPort ? { toPort: edge.toPort } : {}),
    }));

  const { order, missing } = generationExecutionOrder(definition);
  for (const id of missing) issues.push(`cycle:${id}`);
  if (!order.length) issues.push('missing-generation-step');
  if (!definition.outputNodeIds.length) issues.push('missing-output');
  for (const outputId of definition.outputNodeIds) {
    if (!nodeIds.has(outputId)) issues.push(`unknown-output:${outputId}`);
  }

  return { nodes, edges, executionOrder: order, issues };
}
