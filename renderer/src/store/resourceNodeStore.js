import { uid } from '@/utils/format';
import { touchProject } from '@/store/projectStore';
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

export function archiveResourceNode(project, nodeId, { touch = true } = {}) {
  const node = project.nodes.find((item) => item.id === nodeId);
  if (!node || node.type !== 'resource') return { ok: false, error: '资源节点不存在' };
  const before = JSON.parse(JSON.stringify(node));
  node.archived = true;
  node.archivedAt = new Date().toISOString();
  node.updatedAt = node.archivedAt;
  if (touch) touchProject();
  return { ok: true, node, before };
}

export function restoreResourceNode(project, nodeId, { touch = true } = {}) {
  const node = project.nodes.find((item) => item.id === nodeId);
  if (!node || node.type !== 'resource') return { ok: false, error: '资源节点不存在' };
  const before = JSON.parse(JSON.stringify(node));
  node.archived = false;
  delete node.archivedAt;
  node.updatedAt = new Date().toISOString();
  if (touch) touchProject();
  return { ok: true, node, before };
}

export function replaceResourceNode(project, nodeId, payload = {}, { touch = true } = {}) {
  const node = project.nodes.find((item) => item.id === nodeId);
  if (!node || node.type !== 'resource') return { ok: false, error: '资源节点不存在' };
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

export function connectResourceToNode(project, resourceNodeId, targetNodeId, { touch = true } = {}) {
  if (!resourceNodeId || !targetNodeId || resourceNodeId === targetNodeId) {
    return { ok: false, error: '连接节点无效' };
  }
  const resource = project.nodes.find((node) => node.id === resourceNodeId && node.type === 'resource');
  const target = project.nodes.find((node) => node.id === targetNodeId);
  if (!resource) return { ok: false, error: '资源节点不存在' };
  if (!target) return { ok: false, error: '目标节点不存在' };
  const result = addCanvasEdge(project, resourceNodeId, targetNodeId, {
    kind: 'resource-input',
    touch: false,
  });
  if (!result.ok || result.existed) return result;
  if (touch) touchProject();
  return { ok: true, edge: result.edge, existed: false };
}

export function latestGeneratedResourceForNode(project, sourceNodeId) {
  return project.nodes
    .filter((node) => node.type === 'resource' && !node.archived && node.generatedFrom?.nodeId === sourceNodeId)
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0] || null;
}

export function listGeneratedResourcesForNode(project, sourceNodeId) {
  return project.nodes
    .filter((node) => node.type === 'resource' && !node.archived && node.generatedFrom?.nodeId === sourceNodeId)
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

export function selectGeneratedOutput(project, sourceNodeId, outputNodeId, { touch = true } = {}) {
  const source = project.nodes.find((node) => node.id === sourceNodeId);
  const output = project.nodes.find((node) => node.id === outputNodeId && node.type === 'resource');
  if (!source) return { ok: false, error: '源节点不存在' };
  if (String(outputNodeId || '').startsWith('material:')) {
    const materialId = String(outputNodeId).slice('material:'.length);
    const material = (project.materials || []).find((item) => item.id === materialId && item.nodeId === sourceNodeId);
    if (!material) return { ok: false, error: '输出素材不属于该节点' };
    source.selectedOutputNodeId = outputNodeId;
    source.selectedOutputTaskId = material.taskId || '';
    source.updatedAt = new Date().toISOString();
    if (touch) touchProject();
    return { ok: true, source, output: material };
  }
  if (output?.archived) return { ok: false, error: '输出资源已归档' };
  if (!output || output.generatedFrom?.nodeId !== sourceNodeId) return { ok: false, error: '输出资源不属于该节点' };
  source.selectedOutputNodeId = output.id;
  source.selectedOutputTaskId = output.generatedFrom?.taskId || '';
  source.updatedAt = new Date().toISOString();
  if (touch) touchProject();
  return { ok: true, source, output };
}

export function createBoardOutputResource(project, boardNodeId, dataUrl, { touch = true, file = null } = {}) {
  const board = project.nodes.find((node) => node.id === boardNodeId && node.type === 'board');
  if (!board) return { ok: false, error: '画板节点不存在' };
  if (!String(dataUrl || '').startsWith('data:image/png;base64,')) {
    return { ok: false, error: '画板图片数据无效' };
  }
  const filePath = file?.filePath || file?.path || '';
  if (!filePath) return { ok: false, error: '画板输出未能写入项目素材目录' };
  const index = (project.materials || []).filter((material) => (
    material.source === 'board' && material.nodeId === board.id
  )).length + 1;
  const now = new Date().toISOString();
  const material = {
    id: uid(),
    name: file?.name || `board-${board.id.slice(0, 8)}-${index}.png`,
    path: filePath,
    filePath,
    ext: 'png',
    size: file?.size || 0,
    mimeType: file?.mimeType || 'image/png',
    resourceType: 'image',
    source: 'board',
    sourceType: 'board',
    nodeId: board.id,
    nodeType: board.type,
    boardText: board.boardText || board.content || '',
    storageScope: 'project',
    importedAt: now,
  };
  project.materials.unshift(material);
  board.selectedOutputNodeId = `material:${material.id}`;
  board.updatedAt = now;
  if (touch) touchProject();
  return { ok: true, board, material, resource: material };
}
