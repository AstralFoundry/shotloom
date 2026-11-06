/**
 * 把模板实例化到画布：创建节点与连线，并记录一份实例（固定模板版本）。
 *
 * 实例只读取创建时的模板 revision 与配方；之后模板再改，已有实例不跟随。
 */

import { store, touchProject } from '@/store/projectStore';
import { addNode } from '@/store/nodeStore';
import { addCanvasEdge } from '@/store/canvasGraphStore';
import { defaultCanvasNodeDimensions } from '@/domain/graph/CanvasNodeDimensions';
import { uid } from '@/utils/format';
import { planWorkflowInstance, type WorkflowInstancePlan } from '@/domain/workflow/instance';
import type { WorkflowTemplate } from '@/domain/workflow/types';

type AnyRecord = Record<string, any>;

export interface WorkflowInstanceRecord {
  id: string;
  templateId: string;
  templateRevision: number;
  /** 模板节点 id → 画布节点 id。 */
  nodeIds: Record<string, string>;
  /** 生成步骤的拓扑顺序（模板节点 id）。 */
  executionOrder: string[];
  steps: Record<string, WorkflowInstanceStep>;
  status: 'planned' | 'running' | 'completed' | 'failed' | 'cancelled';
  createdAt: string;
}

export interface WorkflowInstanceStep {
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  taskId?: string | undefined;
  error?: string | undefined;
  startedAt?: string | undefined;
  completedAt?: string | undefined;
}

export interface InstantiateResult {
  instance: WorkflowInstanceRecord;
  plan: WorkflowInstancePlan;
}

const MATERIAL_FIELDS = [
  'materialId', 'resourceType', 'mimeType', 'fileName', 'filePath', 'path',
  'url', 'previewUrl', 'thumbnail', 'size', 'name',
] as const;

function applyMaterial(node: AnyRecord, material: AnyRecord | undefined) {
  if (!material) return;
  for (const key of MATERIAL_FIELDS) {
    if (material[key] !== undefined) node[key] = material[key];
  }
  node.title = String(material.name || node.title || '');
  // 素材记录用 path/url，节点用 filePath/url；两套字段在画布预览里都要能取到。
  if (!node.filePath && material.path) node.filePath = String(material.path);
  if (!node.url && material.url) node.url = String(material.url);
  if (!material.path && material.content !== undefined) node.content = String(material.content);
}

/** 资源节点不在 `canvasNodeTypes` 里，`addNode` 会退化成图片节点，必须单独创建。 */
function createResourceNode(title: string, x: number, y: number): AnyRecord {
  const dimensions = defaultCanvasNodeDimensions('resource');
  const node: AnyRecord = {
    id: uid(),
    type: 'resource',
    artifactType: 'other',
    title,
    content: '',
    canvasWidth: dimensions.width,
    canvasHeight: dimensions.height,
    status: 'idle',
    progress: 0,
    x,
    y,
    createdAt: new Date().toISOString(),
  };
  (store.project.nodes as AnyRecord[]).push(node);
  return node;
}

function projectInstances(project: AnyRecord): WorkflowInstanceRecord[] {
  if (!Array.isArray(project.workflowInstances)) project.workflowInstances = [];
  return project.workflowInstances as WorkflowInstanceRecord[];
}

/**
 * 创建实例。任何规划问题都会在写画布之前抛出，避免留下半成品。
 */
export function instantiateWorkflowTemplate(
  template: WorkflowTemplate,
  { bindings = {} }: { bindings?: Record<string, string | undefined> } = {},
): InstantiateResult {
  // 模板是全局的，素材是项目局的：旧项目保存的素材 id 在当前项目里通常不存在。
  // 这类绑定必须当作「未绑定」，让界面要求重新选择，而不是建出空引用节点。
  const availableMaterialIds = new Set(
    ((store.project.materials || []) as AnyRecord[]).map((material) => String(material.id)),
  );
  const resolvedBindings: Record<string, string | undefined> = { ...bindings };
  for (const node of template.definition.nodes) {
    if (node.role !== 'input') continue;
    const bound = resolvedBindings[node.id];
    const id = String((bound === undefined ? node.resourceId : bound) || '').trim();
    if (id && !availableMaterialIds.has(id)) resolvedBindings[node.id] = '';
  }
  const plan = planWorkflowInstance({
    definition: template.definition,
    recipe: template.recipe,
    bindings: resolvedBindings,
  });
  if (plan.issues.length) {
    throw new Error(`workflow.notReady:${plan.issues.join(',')}`);
  }

  const materials = new Map<string, AnyRecord>(
    ((store.project.materials || []) as AnyRecord[]).map((material) => [String(material.id), material]),
  );
  const nodeIds: Record<string, string> = {};
  const created: string[] = [];
  const baseX = 80 + ((store.project.nodes || []).length % 4) * 300;
  const baseY = 80 + Math.floor((store.project.nodes || []).length / 4) * 220;

  for (const planned of plan.nodes) {
    const node = planned.role === 'input'
      ? createResourceNode(planned.title, baseX + created.length * 300, baseY)
      : addNode(planned.type);
    node.title = planned.title;
    if (planned.role === 'generation') {
      if (planned.prompt !== undefined) node.prompt = planned.prompt;
      if (planned.model) node.model = planned.model;
      if (planned.config) node.config = { ...(node.config || {}), ...planned.config };
      if (planned.outputSpec !== undefined) node.outputSpec = planned.outputSpec;
    }
    if (planned.role === 'constant') {
      node.content = planned.content || '';
    }
    if (planned.role === 'input') {
      applyMaterial(node, materials.get(String(planned.resourceId || '')));
      if (planned.resourceId) node.materialId = planned.resourceId;
    }
    node.artifactType = planned.role === 'input' ? 'other' : node.artifactType;
    node.workflowTemplateId = template.id;
    node.workflowTemplateRevision = template.revision;
    node.x = baseX + created.length * 300;
    node.y = baseY;
    nodeIds[planned.sourceId] = String(node.id || '');
    created.push(String(node.id || ''));
  }

  const edgeFailures: string[] = [];
  for (const edge of plan.edges) {
    const fromId = nodeIds[edge.from];
    const toId = nodeIds[edge.to];
    if (!fromId || !toId) {
      edgeFailures.push(`${edge.from}->${edge.to}:missing-node`);
      continue;
    }
    const result = addCanvasEdge(store.project as unknown as Parameters<typeof addCanvasEdge>[0], fromId, toId, {
      kind: 'workflow',
      ...(edge.toPort ? { edge: { targetHandle: edge.toPort } } : {}),
      touch: false,
    });
    if (!result.ok) edgeFailures.push(`${edge.from}->${edge.to}:${result.error || 'failed'}`);
  }

  const instance: WorkflowInstanceRecord = {
    id: `wfi-${uid()}`,
    templateId: template.id,
    templateRevision: template.revision,
    nodeIds,
    executionOrder: [...plan.executionOrder],
    steps: Object.fromEntries(plan.executionOrder.map((id) => [id, { status: 'pending' as const }])),
    status: 'planned',
    createdAt: new Date().toISOString(),
  };
  projectInstances(store.project as AnyRecord).push(instance);
  touchProject();

  if (edgeFailures.length) {
    throw new Error(`workflow.edgeFailed:${edgeFailures.join(',')}`);
  }
  return { instance, plan };
}
