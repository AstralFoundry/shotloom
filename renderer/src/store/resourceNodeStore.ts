import { t } from '../i18n/index.ts';
import { touchProject } from '@/store/projectStore';

// 画布工程对象仍来自未类型化存储；调用方按真实工程传入。
type AnyProject = { [key: string]: any };
type NodeRecord = { [key: string]: any };
import { addCanvasEdge } from '@/store/canvasGraphStore';

const resourceKeys = [
  'title',
  'content',
  'fileName',
  'filePath',
  'url',
  'resourceUrl',
  'previewUrl',
  'thumbnail',
  'objectKey',
  'ossObjectKey',
  'materialId',
  'resourceType',
  'mediaType',
  'mimeType',
  'source',
  'metadata',
  'cloudCache',
];

export function archiveResourceNode(project: AnyProject, nodeId: string, { touch = true }: { touch?: boolean } = {}) {
  const node = project.nodes.find((item: NodeRecord) => item.id === nodeId);
  if (!node || node.type !== 'resource') return { ok: false, error: t("ui.resourceNodeStore.text.b569e4df") };
  const before = JSON.parse(JSON.stringify(node));
  node.archived = true;
  node.archivedAt = new Date().toISOString();
  node.updatedAt = node.archivedAt;
  if (touch) touchProject();
  return { ok: true, node, before };
}

export function restoreResourceNode(project: AnyProject, nodeId: string, { touch = true }: { touch?: boolean } = {}) {
  const node = project.nodes.find((item: NodeRecord) => item.id === nodeId);
  if (!node || node.type !== 'resource') return { ok: false, error: t("ui.resourceNodeStore.text.b569e4df") };
  const before = JSON.parse(JSON.stringify(node));
  node.archived = false;
  delete node.archivedAt;
  node.updatedAt = new Date().toISOString();
  if (touch) touchProject();
  return { ok: true, node, before };
}

export function replaceResourceNode(project: AnyProject, nodeId: string, payload: AnyProject = {}, { touch = true }: { touch?: boolean } = {}) {
  const node = project.nodes.find((item: NodeRecord) => item.id === nodeId);
  if (!node || node.type !== 'resource') return { ok: false, error: t("ui.resourceNodeStore.text.b569e4df") };
  const before = JSON.parse(JSON.stringify(node));
  for (const key of resourceKeys) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) node[key] = payload[key];
  }
  if (payload.name && !payload.title) node.title = payload.name;
  if (payload.path && !payload.filePath) node.filePath = payload.path;
  if (payload.fileUrl && !payload.url) node.url = payload.fileUrl;
  node.archived = false;
  delete node.archivedAt;
  node.updatedAt = new Date().toISOString();
  if (touch) touchProject();
  return { ok: true, node, before };
}

export function connectResourceToNode(project: AnyProject, resourceNodeId: string, targetNodeId: string, { touch = true }: { touch?: boolean } = {}) {
  if (!resourceNodeId || !targetNodeId || resourceNodeId === targetNodeId) {
    return { ok: false, error: t("ui.canvasGraphStore.text.0e12c8c0") };
  }
  const resource = project.nodes.find((node: NodeRecord) => node.id === resourceNodeId && node.type === 'resource');
  const target = project.nodes.find((node: NodeRecord) => node.id === targetNodeId);
  if (!resource) return { ok: false, error: t("ui.resourceNodeStore.text.b569e4df") };
  if (!target) return { ok: false, error: t("ui.canvasGraphStore.text.6d3d6060") };
  const result = addCanvasEdge(project as any, resourceNodeId, targetNodeId, {
    kind: 'resource-input',
    touch: false,
  });
  if (!result.ok) return result;
  if (result.existed) return result;
  if (touch) touchProject();
  return { ok: true, edge: result.edge, existed: false };
}

export function latestGeneratedResourceForNode(project: AnyProject, sourceNodeId: string): NodeRecord | null {
  return project.nodes
    .filter((node: NodeRecord) => node.type === 'resource' && !node.archived && node.generatedFrom?.nodeId === sourceNodeId)
    .sort((a: NodeRecord, b: NodeRecord) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())[0] || null;
}

export function listGeneratedResourcesForNode(project: AnyProject, sourceNodeId: string): NodeRecord[] {
  return project.nodes
    .filter((node: NodeRecord) => node.type === 'resource' && !node.archived && node.generatedFrom?.nodeId === sourceNodeId)
    .sort((a: NodeRecord, b: NodeRecord) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
}

export function selectGeneratedOutput(project: AnyProject, sourceNodeId: string, outputNodeId: string, { touch = true }: { touch?: boolean } = {}) {
  const source = project.nodes.find((node: NodeRecord) => node.id === sourceNodeId);
  const output = project.nodes.find((node: NodeRecord) => node.id === outputNodeId && node.type === 'resource');
  if (!source) return { ok: false, error: t("ui.canvasGraphStore.text.945ffbe2") };
  if (String(outputNodeId || '').startsWith('material:')) {
    const materialId = String(outputNodeId).slice('material:'.length);
    const material = (project.materials || []).find((item: NodeRecord) => item.id === materialId && item.nodeId === sourceNodeId);
    if (!material) return { ok: false, error: t("ui.resourceNodeStore.text.0f0ac639") };
    source.selectedOutputNodeId = outputNodeId;
    source.selectedOutputTaskId = material.taskId || '';
    source.updatedAt = new Date().toISOString();
    if (touch) touchProject();
    return { ok: true, source, output: material };
  }
  if (output?.archived) return { ok: false, error: t("ui.resourceNodeStore.text.d2f9fd6e") };
  if (!output || output.generatedFrom?.nodeId !== sourceNodeId) return { ok: false, error: t("ui.resourceNodeStore.text.6fcd56cf") };
  source.selectedOutputNodeId = output.id;
  source.selectedOutputTaskId = output.generatedFrom?.taskId || '';
  source.updatedAt = new Date().toISOString();
  if (touch) touchProject();
  return { ok: true, source, output };
}
