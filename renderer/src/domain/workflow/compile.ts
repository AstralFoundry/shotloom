/**
 * 从画布选区编译可复用工作流模板。
 *
 * 只接受「已经跑通」的步骤：生成节点必须处于完成状态，否则模板会在运行时
 * 失败。编译结果分成可分享的结构与私有配方两部分，导出时只带走前者。
 */

import type {
  ShareableWorkflowTemplate,
  WorkflowDefinition,
  WorkflowDefinitionEdge,
  WorkflowDefinitionNode,
  WorkflowMediaType,
  WorkflowRecipeNode,
  WorkflowRole,
  WorkflowTemplate,
} from './types';

export type WorkflowCompileCode =
  | 'empty-selection'
  | 'unsupported-node'
  | 'not-run'
  | 'missing-output'
  | 'unknown-output'
  | 'cycle'
  | 'no-generation-step';

export class WorkflowCompileError extends Error {
  public readonly code: WorkflowCompileCode;

  constructor(code: WorkflowCompileCode, message: string) {
    super(message);
    this.name = 'WorkflowCompileError';
    this.code = code;
  }
}

export interface CanvasNodeLike {
  id: string;
  type: string;
  title?: string;
  status?: string;
  prompt?: string;
  content?: string;
  model?: string;
  config?: Record<string, unknown>;
  outputSpec?: unknown;
  materialId?: string;
  resourceType?: string;
  mediaType?: string;
  mimeType?: string;
  archived?: boolean;
}

export interface CanvasEdgeLike {
  id?: string;
  source: string;
  target: string;
  targetHandle?: string | null;
}

export interface CanvasTaskLike {
  id: string;
  nodeId: string;
  status: string;
  completedAt?: string;
  createdAt?: string;
}

export interface CompileWorkflowInput {
  nodes: CanvasNodeLike[];
  edges: CanvasEdgeLike[];
  selection: string[];
  tasks?: CanvasTaskLike[];
  /** 用户指定的输出节点；省略时取没有下游的生成节点。 */
  outputNodeIds?: string[];
  /** 槽位通用名，由界面按语言生成，保证领域层不产出硬编码文案。 */
  genericTitle: (node: { role: WorkflowRole; mediaType: WorkflowMediaType; index: number }) => string;
}

export interface CompiledWorkflow {
  definition: WorkflowDefinition;
  recipe: Record<string, WorkflowRecipeNode>;
  /** 因不在输出祖先链上而被丢弃的节点，便于界面解释。 */
  droppedNodeIds: string[];
}

const GENERATION_TYPES: Record<string, WorkflowMediaType> = {
  imageGeneration: 'image',
  videoGeneration: 'video',
  audioGeneration: 'audio',
  textGeneration: 'text',
};

function mediaTypeOfResource(node: CanvasNodeLike): WorkflowMediaType | null {
  const raw = String(node.resourceType || node.mediaType || node.mimeType || '').toLowerCase();
  if (raw.includes('image')) return 'image';
  if (raw.includes('video')) return 'video';
  if (raw.includes('audio')) return 'audio';
  if (raw.includes('text') || raw.includes('markdown')) return 'text';
  return null;
}

function latestCompletedTaskId(nodeId: string, tasks: CanvasTaskLike[]): string | undefined {
  return tasks
    .filter((task) => task.nodeId === nodeId && task.status === 'completed')
    .sort((left, right) => Date.parse(right.completedAt || right.createdAt || '0') - Date.parse(left.completedAt || left.createdAt || '0'))[0]
    ?.id;
}

function reachableFromOutputs(
  outputs: string[],
  edges: WorkflowDefinitionEdge[],
  nodes: WorkflowDefinitionNode[],
): Set<string> {
  const keep = new Set<string>(outputs);
  const queue = [...outputs];
  while (queue.length) {
    const current = queue.shift() as string;
    for (const edge of edges) {
      if (edge.toNodeId !== current) continue;
      if (keep.has(edge.fromNodeId)) continue;
      keep.add(edge.fromNodeId);
      queue.push(edge.fromNodeId);
    }
  }
  // 只保留仍然存在的节点
  const available = new Set(nodes.map((node) => node.id));
  return new Set([...keep].filter((id) => available.has(id)));
}

export function assertAcyclic(definition: WorkflowDefinition): void {
  const indegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const node of definition.nodes) {
    indegree.set(node.id, 0);
    outgoing.set(node.id, []);
  }
  for (const edge of definition.edges) {
    if (!indegree.has(edge.toNodeId) || !outgoing.has(edge.fromNodeId)) continue;
    indegree.set(edge.toNodeId, (indegree.get(edge.toNodeId) || 0) + 1);
    outgoing.get(edge.fromNodeId)?.push(edge.toNodeId);
  }
  const queue = [...indegree.entries()].filter(([, count]) => count === 0).map(([id]) => id);
  let visited = 0;
  while (queue.length) {
    const current = queue.shift() as string;
    visited += 1;
    for (const next of outgoing.get(current) || []) {
      const remaining = (indegree.get(next) || 0) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }
  if (visited !== definition.nodes.length) {
    throw new WorkflowCompileError('cycle', 'workflow.cycle');
  }
}

/** 校验从磁盘/导入取得的模板，避免半损坏的模板进入运行。 */
export function validateWorkflowDefinition(definition: WorkflowDefinition): WorkflowDefinition {
  if (definition.version !== 1) throw new WorkflowCompileError('unsupported-node', 'workflow.unsupportedVersion');
  const ids = new Set<string>();
  for (const node of definition.nodes) {
    if (!node.id || ids.has(node.id)) throw new WorkflowCompileError('unsupported-node', 'workflow.duplicateNode');
    ids.add(node.id);
    if (!['input', 'constant', 'generation'].includes(node.role)) {
      throw new WorkflowCompileError('unsupported-node', 'workflow.unknownRole');
    }
  }
  if (!definition.outputNodeIds.length) throw new WorkflowCompileError('missing-output', 'workflow.missingOutput');
  for (const id of definition.outputNodeIds) {
    if (!ids.has(id)) throw new WorkflowCompileError('unknown-output', id);
  }
  if (!definition.nodes.some((node) => node.role === 'generation')) {
    throw new WorkflowCompileError('no-generation-step', 'workflow.noGenerationStep');
  }
  assertAcyclic(definition);
  return definition;
}

export function compileWorkflowTemplate(input: CompileWorkflowInput): CompiledWorkflow {
  const selected = new Set(input.selection);
  const chosen = input.nodes.filter((node) => selected.has(node.id) && !node.archived);
  if (!chosen.length) throw new WorkflowCompileError('empty-selection', 'workflow.emptySelection');

  const tasks = input.tasks || [];
  const nodes: WorkflowDefinitionNode[] = [];
  const recipe: Record<string, WorkflowRecipeNode> = {};
  let index = 0;

  for (const node of chosen) {
    // 未运行的文本节点是「写好的文本」，当作固定输入而不是待执行步骤。
    if (node.type === 'textGeneration' && node.status !== 'completed') {
      nodes.push({
        id: node.id,
        title: input.genericTitle({ role: 'constant', mediaType: 'text', index: index++ }),
        role: 'constant',
        mediaType: 'text',
        text: String(node.content ?? node.prompt ?? ''),
      });
      continue;
    }
    const generationMedia = GENERATION_TYPES[node.type];
    if (generationMedia) {
      if (node.status !== 'completed') throw new WorkflowCompileError('not-run', 'workflow.notRun');
      const role: WorkflowRole = 'generation';
      nodes.push({
        id: node.id,
        title: input.genericTitle({ role, mediaType: generationMedia, index: index++ }),
        role,
        mediaType: generationMedia,
      });
      recipe[node.id] = {
        ...(node.prompt !== undefined ? { prompt: node.prompt } : {}),
        ...(node.model !== undefined ? { model: node.model } : {}),
        ...(node.config !== undefined ? { config: node.config } : {}),
        ...(node.outputSpec !== undefined ? { outputSpec: node.outputSpec } : {}),
        ...(latestCompletedTaskId(node.id, tasks) ? { sourceTaskId: latestCompletedTaskId(node.id, tasks) as string } : {}),
      };
      continue;
    }
    if (node.type === 'resource') {
      const mediaType = mediaTypeOfResource(node);
      if (!mediaType) throw new WorkflowCompileError('unsupported-node', `workflow.unsupportedMedia:${node.id}`);
      nodes.push({
        id: node.id,
        title: input.genericTitle({ role: 'input', mediaType, index: index++ }),
        role: 'input',
        mediaType,
        ...(node.materialId ? { resourceId: node.materialId } : {}),
      });
      continue;
    }
    throw new WorkflowCompileError('unsupported-node', `workflow.unsupportedNode:${node.type}`);
  }

  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges: WorkflowDefinitionEdge[] = [];
  for (const edge of input.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    if (edges.some((item) => item.fromNodeId === edge.source && item.toNodeId === edge.target && item.toPort === (edge.targetHandle || undefined))) continue;
    edges.push({
      fromNodeId: edge.source,
      toNodeId: edge.target,
      ...(edge.targetHandle ? { toPort: edge.targetHandle } : {}),
    });
  }

  // 先查环再推断输出：有环时「没有下游的生成节点」也会为空，
  // 若不先查，用户会看到「缺少输出」这种误导性的原因。
  assertAcyclic({ version: 1, nodes, edges, outputNodeIds: [] });

  const generationNodes = nodes.filter((node) => node.role === 'generation');
  if (!generationNodes.length) throw new WorkflowCompileError('no-generation-step', 'workflow.noGenerationStep');

  const hasDownstream = new Set(edges.map((edge) => edge.fromNodeId));
  const outputNodeIds = input.outputNodeIds?.length
    ? [...input.outputNodeIds]
    : generationNodes.filter((node) => !hasDownstream.has(node.id)).map((node) => node.id);
  if (!outputNodeIds.length) throw new WorkflowCompileError('missing-output', 'workflow.missingOutput');
  for (const id of outputNodeIds) {
    const node = nodes.find((item) => item.id === id);
    if (!node || node.role !== 'generation') throw new WorkflowCompileError('unknown-output', `workflow.outputMustBeGeneration:${id}`);
  }

  const keep = reachableFromOutputs(outputNodeIds, edges, nodes);
  const droppedNodeIds = nodes.filter((node) => !keep.has(node.id)).map((node) => node.id);
  const definition: WorkflowDefinition = {
    version: 1,
    nodes: nodes.filter((node) => keep.has(node.id)),
    edges: edges.filter((edge) => keep.has(edge.fromNodeId) && keep.has(edge.toNodeId)),
    outputNodeIds,
  };
  for (const id of Object.keys(recipe)) if (!keep.has(id)) delete recipe[id];
  assertAcyclic(definition);

  return { definition, recipe, droppedNodeIds };
}

/** 导出副本：去掉配方与素材绑定，只留可分享的结构。 */
export function shareableWorkflowTemplate(
  template: Pick<WorkflowTemplate, 'id' | 'name' | 'description' | 'revision' | 'definition'>,
  now = new Date().toISOString(),
): ShareableWorkflowTemplate {
  return {
    format: 'shotloom.workflow-template',
    formatVersion: 1,
    id: template.id,
    name: template.name,
    description: template.description,
    revision: template.revision,
    definition: {
      ...template.definition,
      nodes: template.definition.nodes.map((node) => {
        const clone: WorkflowDefinitionNode = { ...node };
        delete clone.resourceId;
        return clone;
      }),
    },
    exportedAt: now,
  };
}

/** 模板里的可替换输入槽位，界面据此渲染绑定表单。 */
export function workflowInputSlots(definition: WorkflowDefinition): WorkflowDefinitionNode[] {
  return definition.nodes.filter((node) => node.role === 'input');
}

/** 运行前的静态校验：每个输入槽位都要有绑定，生成步骤必须有配方。 */
export function workflowReadiness(
  definition: WorkflowDefinition,
  recipe: Record<string, WorkflowRecipeNode>,
  bindings: Record<string, string | undefined> = {},
): { ready: boolean; issues: string[] } {
  const issues: string[] = [];
  for (const node of workflowInputSlots(definition)) {
    if (!String(bindings[node.id] || node.resourceId || '').trim()) issues.push(`missing-input:${node.id}`);
  }
  for (const node of definition.nodes) {
    if (node.role !== 'generation') continue;
    if (!recipe[node.id]) issues.push(`missing-recipe:${node.id}`);
  }
  if (!definition.outputNodeIds.length) issues.push('missing-output');
  return { ready: issues.length === 0, issues };
}
