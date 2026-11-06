/**
 * 工作流 = 一段完整制作流程的快照。
 *
 * 不要求节点运行过：选中的节点、连线、它们引用的素材记录与文件路径全部存下来。
 * 应用时把节点和素材复制到当前画布，用户直接得到一份可编辑的副本，
 * 不需要再绑定槽位，也不会自动运行任何任务。
 */

import type { WorkflowNodePreview } from './types';

export interface WorkflowSnapshotMaterial {
  id: string;
  name?: string;
  path?: string;
  filePath?: string;
  url?: string;
  resourceType?: string;
  mimeType?: string;
  size?: number;
  checksum?: string;
  checksumAlgorithm?: string;
  ext?: string;
}

export interface WorkflowSnapshotNode {
  /** 模板内的稳定 id（取原画布节点 id）。 */
  id: string;
  type: string;
  title?: string;
  x: number;
  y: number;
  canvasWidth?: number;
  canvasHeight?: number;
  artifactType?: string;
  content?: string;
  textContent?: string;
  prompt?: string;
  model?: string;
  config?: Record<string, unknown>;
  outputSpec?: unknown;
  inputMode?: string;
  resourceType?: string;
  materialId?: string;
  assetId?: string;
  uploadedFile?: Record<string, unknown>;
  generatedOutputs?: Array<Record<string, unknown>>;
  imageRecipe?: Record<string, unknown>;
  generatedFrom?: { nodeId?: string; type?: string };
  /** 保存时的缩略图，仅用于展示。 */
  preview?: WorkflowNodePreview | undefined;
  [key: string]: unknown;
}

export interface WorkflowSnapshotEdge {
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  kind?: string;
  data?: Record<string, unknown>;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  revision: number;
  formatVersion: 2;
  nodes: WorkflowSnapshotNode[];
  edges: WorkflowSnapshotEdge[];
  /** 节点引用到的素材记录快照，应用时复制进当前项目。 */
  materials: WorkflowSnapshotMaterial[];
  createdAt: string;
  updatedAt: string;
}

/** 旧版（槽位/配方）模板的只读识别结果；只用于兼容读取与提示重新保存。 */
export interface LegacyWorkflowTemplate {
  legacy: true;
  id: string;
  name: string;
  description: string;
  revision: number;
}

const NODE_TYPE_BY_MEDIA: Record<string, string> = {
  image: 'imageGeneration',
  video: 'videoGeneration',
  audio: 'audioGeneration',
  text: 'textGeneration',
};

/** 浮层/运行时字段不属于作品，复制时丢弃。 */
const TRANSIENT_KEYS = [
  'selected', 'dragging', 'resizing', 'status', 'progress', 'error',
  'taskStatus', 'taskId', 'agentEvaluation', 'lastTaskId', 'agentTempId',
  'updatedAt', 'createdAt', 'cloudCache', 'previewUrl',
];

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function sanitizeNode(node: Record<string, unknown>, index: number): WorkflowSnapshotNode {
  const clone = cloneJson(node);
  for (const key of TRANSIENT_KEYS) delete clone[key];
  const outputs = Array.isArray(clone.generatedOutputs) ? clone.generatedOutputs : [];
  return {
    ...clone,
    id: String(node.id || `node-${index}`),
    type: String(node.type || 'imageGeneration'),
    title: String(node.title || ''),
    x: Number(node.x) || 0,
    y: Number(node.y) || 0,
    // 已带产出文件的节点保留「完成」外观，但不复制任务与错误。
    ...(outputs.length ? { status: 'completed' } : { status: 'idle' }),
    ...(Array.isArray(node.generatedOutputs) ? { generatedOutputs: cloneJson(outputs) } : {}),
  } as WorkflowSnapshotNode;
}

function sanitizeEdge(edge: Record<string, unknown>): WorkflowSnapshotEdge {
  const clone = cloneJson(edge);
  delete clone.id;
  delete clone.selected;
  return {
    source: String(edge.source || ''),
    target: String(edge.target || ''),
    ...(edge.sourceHandle ? { sourceHandle: String(edge.sourceHandle) } : {}),
    ...(edge.targetHandle ? { targetHandle: String(edge.targetHandle) } : {}),
    ...(edge.kind ? { kind: String(edge.kind) } : {}),
    ...(edge.data && typeof edge.data === 'object' ? { data: cloneJson(edge.data as Record<string, unknown>) } : {}),
  };
}

function referencedMaterialIds(nodes: WorkflowSnapshotNode[]): Set<string> {
  const ids = new Set<string>();
  const add = (value: unknown) => {
    const id = String(value || '').trim();
    if (id) ids.add(id);
  };
  for (const node of nodes) {
    add(node.materialId);
    add((node.uploadedFile as Record<string, unknown> | undefined)?.materialId);
    for (const output of node.generatedOutputs || []) add(output.materialId);
  }
  return ids;
}

/**
 * 从画布选区生成完整快照。空选区直接报错；其余情况一律保存，不检查是否运行过。
 */
export function snapshotWorkflowSelection({
  nodes,
  edges,
  selection,
  materials,
  previews,
}: {
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
  selection: string[];
  materials: Array<Record<string, unknown>>;
  previews?: Record<string, WorkflowNodePreview>;
}): { nodes: WorkflowSnapshotNode[]; edges: WorkflowSnapshotEdge[]; materials: WorkflowSnapshotMaterial[] } {
  const selected = new Set(selection.map(String));
  const chosen = nodes.filter((node) => selected.has(String(node.id)) && node.archived !== true);
  if (!chosen.length) throw new Error('workflow.emptySelection');

  const snapshotNodes = chosen.map((node, index) => {
    const snapshot = sanitizeNode(node, index);
    if (previews && previews[snapshot.id]) snapshot.preview = previews[snapshot.id];
    return snapshot;
  });
  const ids = new Set(snapshotNodes.map((node) => node.id));
  const snapshotEdges = edges
    .filter((edge) => ids.has(String(edge.source)) && ids.has(String(edge.target)))
    .map(sanitizeEdge);

  const materialIds = referencedMaterialIds(snapshotNodes);
  const snapshotMaterials = materials
    .filter((material) => materialIds.has(String(material.id)))
    .map((material): WorkflowSnapshotMaterial => ({
      id: String(material.id),
      ...(material.name ? { name: String(material.name) } : {}),
      ...(material.path ? { path: String(material.path) } : {}),
      ...(material.filePath ? { filePath: String(material.filePath) } : {}),
      ...(material.url ? { url: String(material.url) } : {}),
      ...(material.resourceType ? { resourceType: String(material.resourceType) } : {}),
      ...(material.mimeType ? { mimeType: String(material.mimeType) } : {}),
      ...(material.size !== undefined ? { size: Number(material.size) } : {}),
      ...(material.checksum ? { checksum: String(material.checksum) } : {}),
      ...(material.checksumAlgorithm ? { checksumAlgorithm: String(material.checksumAlgorithm) } : {}),
      ...(material.ext ? { ext: String(material.ext) } : {}),
    }));

  return { nodes: snapshotNodes, edges: snapshotEdges, materials: snapshotMaterials };
}

/** 按画布阅读顺序（先上后下、先左后右）列出节点，供流程条展示。 */
export function workflowDisplayOrder(nodes: WorkflowSnapshotNode[]): WorkflowSnapshotNode[] {
  return [...nodes].sort((left, right) => (
    Math.abs(left.y - right.y) > 40
      ? left.y - right.y
      : left.x - right.x
  ));
}

export function snapshotNodeKind(node: WorkflowSnapshotNode): WorkflowNodePreview['kind'] {
  const type = String(node.type || '');
  if (type === 'videoGeneration') return 'video';
  if (type === 'audioGeneration') return 'audio';
  if (type === 'textGeneration') return 'text';
  return NODE_TYPE_BY_MEDIA[String(node.resourceType || '')] === 'video' ? 'video' : 'image';
}
