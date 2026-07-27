import { store, touchProject } from '@/store/projectStore';
import { desktopApi } from '@/services/desktopApi';
import { showToast } from '@/composables/useToast';
import { uid } from '@/utils/format';
import { selectedNodes, nodeTypeLabel } from '@/store/nodeStore';
import { addCanvasEdge, remapImportedNodeReferences } from '@/store/canvasGraphStore';
import { recordCanvasHistory } from '@/store/canvasHistoryStore';

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function basename(value) {
  return String(value || '').split(/[\\/]/).filter(Boolean).pop() || '';
}

function stripFileProtocol(value) {
  const raw = String(value || '').trim();
  if (!raw.startsWith('file://')) return raw;
  try {
    return decodeURIComponent(new URL(raw).pathname);
  } catch {
    return raw.replace(/^file:\/\//i, '');
  }
}

function looksLikeLocalPath(value) {
  const raw = stripFileProtocol(value);
  return /^[a-z]:[\\/]/i.test(raw) || raw.startsWith('/') || raw.includes('\\');
}

function isRemoteOrDataUrl(value) {
  return /^(https?:|data:|blob:)/i.test(String(value || '').trim());
}

function looksLikeObjectKey(value) {
  const raw = stripFileProtocol(value);
  if (!raw || looksLikeLocalPath(raw) || isRemoteOrDataUrl(raw)) return false;
  return raw.includes('/') || /^[\w.-]+\.[a-z0-9]{2,8}$/i.test(raw);
}

function nodeResourceCandidates(node) {
  return [
    node?.filePath,
    node?.localPath,
    node?.stagedResourcePath,
    node?.stagedPath,
    node?.uploadedFile?.path,
    node?.content,
    node?.url,
    node?.resourceUrl,
    node?.previewUrl,
  ]
    .filter(Boolean)
    .map(stripFileProtocol)
    .filter((value) => looksLikeLocalPath(value));
}

function nodeObjectKeyCandidates(node) {
  return [
    node?.objectKey,
    node?.ossObjectKey,
    node?.storageKey,
    node?.uploadedFile?.objectKey,
    node?.uploadedFile?.ossObjectKey,
    node?.metadata?.objectKey,
    node?.metadata?.ossObjectKey,
  ]
    .filter(Boolean)
    .map(stripFileProtocol)
    .filter((value) => looksLikeObjectKey(value));
}

function collectWorkflowMaterials(nodes = []) {
  const nodeMaterialIds = new Set();
  const resourcePaths = new Map();
  const resourceObjectKeys = new Map();

  function addPath(path, fallback = {}) {
    const normalized = stripFileProtocol(path);
    if (!looksLikeLocalPath(normalized) || resourcePaths.has(normalized)) return;
    resourcePaths.set(normalized, {
      id: fallback.materialId || `resource-${fallback.nodeId || normalized}`,
      path: normalized,
      filePath: normalized,
      localPath: normalized,
      name: fallback.name || basename(normalized) || 'resource',
      fileName: fallback.fileName || basename(normalized) || '',
      resourceType: fallback.resourceType || '',
      source: fallback.source || 'workflow-node',
      nodeId: fallback.nodeId || '',
    });
  }

  function addObjectKey(objectKey, fallback = {}) {
    const normalized = stripFileProtocol(objectKey);
    if (!looksLikeObjectKey(normalized) || resourceObjectKeys.has(normalized)) return;
    resourceObjectKeys.set(normalized, {
      id: fallback.materialId || `object-key-${fallback.nodeId || normalized}`,
      path: '',
      filePath: '',
      localPath: '',
      objectKey: normalized,
      ossObjectKey: normalized,
      name: fallback.name || basename(normalized) || 'resource',
      fileName: fallback.fileName || basename(normalized) || '',
      resourceType: fallback.resourceType || '',
      source: fallback.source || 'workflow-node',
      nodeId: fallback.nodeId || '',
    });
  }

  for (const node of nodes) {
    if (node.materialId) nodeMaterialIds.add(node.materialId);
    if (node.uploadedFile?.materialId) nodeMaterialIds.add(node.uploadedFile.materialId);
    nodeResourceCandidates(node).forEach((path) => addPath(path, {
      materialId: node.materialId || node.uploadedFile?.materialId || '',
      nodeId: node.id,
      name: node.fileName || node.uploadedFile?.name || node.title,
      fileName: node.fileName || node.uploadedFile?.name || '',
      resourceType: node.resourceType || node.uploadedFile?.resourceType || '',
      source: node.source || 'workflow-node',
    }));
    nodeObjectKeyCandidates(node).forEach((objectKey) => addObjectKey(objectKey, {
      materialId: node.materialId || node.uploadedFile?.materialId || '',
      nodeId: node.id,
      name: node.fileName || node.resourceName || node.uploadedFile?.name || node.title,
      fileName: node.fileName || node.resourceName || node.uploadedFile?.name || '',
      resourceType: node.resourceType || node.mediaType || node.uploadedFile?.resourceType || '',
      source: node.source || 'workflow-node',
    }));
  }

  const materials = [];
  const seenPaths = new Set();
  const seenObjectKeys = new Set();
  for (const material of store.project.materials || []) {
    const objectKey = stripFileProtocol(material.objectKey || material.ossObjectKey || '');
    if (
      !nodeMaterialIds.has(material.id)
      && !resourcePaths.has(stripFileProtocol(material.path || material.filePath))
      && !resourceObjectKeys.has(objectKey)
    ) {
      continue;
    }
    const next = clone(material);
    materials.push(next);
    if (next.path || next.filePath) seenPaths.add(stripFileProtocol(next.path || next.filePath));
    if (next.objectKey || next.ossObjectKey) seenObjectKeys.add(stripFileProtocol(next.objectKey || next.ossObjectKey));
  }

  for (const [path, material] of resourcePaths.entries()) {
    if (!seenPaths.has(path)) materials.push(material);
  }
  for (const [objectKey, material] of resourceObjectKeys.entries()) {
    if (!seenObjectKeys.has(objectKey)) materials.push(material);
  }

  return materials;
}

function buildPastedMaterials(resources = []) {
  const materialIdMap = new Map();
  const bySourcePath = new Map();
  const materials = [];

  for (const item of resources || []) {
    if (!item?.stagedPath) continue;
    const id = uid();
    const material = {
      ...clone(item),
      id,
      path: item.stagedPath,
      filePath: item.stagedPath,
      localPath: item.stagedPath,
      name: item.name || item.fileName || basename(item.stagedPath),
      fileName: item.fileName || item.name || basename(item.stagedPath),
      importedAt: new Date().toISOString(),
      source: item.source || 'workflow-paste',
    };
    materials.push(material);
    if (item.id) materialIdMap.set(item.id, id);
    [item.path, item.filePath, item.localPath, item.stagedPath].filter(Boolean).forEach((source) => {
      bySourcePath.set(stripFileProtocol(source), material);
    });
  }

  return { materials, materialIdMap, bySourcePath };
}

function findPastedMaterialForNode(node, bySourcePath) {
  for (const candidate of nodeResourceCandidates(node)) {
    const material = bySourcePath.get(stripFileProtocol(candidate));
    if (material) return material;
  }
  return null;
}

function resetRuntimeState(node) {
  if (['imageGeneration', 'videoGeneration', 'audioGeneration', 'textGeneration'].includes(node.type)) {
    node.status = 'idle';
    node.progress = 0;
    node.error = '';
    node.retryCount = 0;
    delete node.taskId;
    delete node.remoteTaskId;
  }
}

function remapPastedResourceNode(node, materialIdMap, pastedMaterial) {
  if (node.materialId && materialIdMap.has(node.materialId)) {
    node.materialId = materialIdMap.get(node.materialId);
  }
  if (node.uploadedFile?.materialId && materialIdMap.has(node.uploadedFile.materialId)) {
    node.uploadedFile = {
      ...node.uploadedFile,
      materialId: materialIdMap.get(node.uploadedFile.materialId),
      path: pastedMaterial?.path || node.uploadedFile.path,
      name: node.uploadedFile.name || pastedMaterial?.name || '',
    };
  }
  if (node.type !== 'resource' || !pastedMaterial) return;
  node.materialId = pastedMaterial.id;
  node.filePath = pastedMaterial.path;
  node.localPath = pastedMaterial.path;
  node.fileName = pastedMaterial.fileName || pastedMaterial.name || basename(pastedMaterial.path);
  node.content = looksLikeLocalPath(node.content) ? pastedMaterial.path : (node.content || pastedMaterial.path);
  if (looksLikeLocalPath(node.url)) node.url = pastedMaterial.path;
  if (looksLikeLocalPath(node.resourceUrl)) node.resourceUrl = pastedMaterial.path;
  if (looksLikeLocalPath(node.previewUrl)) node.previewUrl = pastedMaterial.path;
}

/**
 * 将当前选中节点（或全部节点）暂存到工作流剪贴板。
 * 通过桌面桥 将节点、边和素材文件写入 userData 暂存区。
 */
export async function stageSelectedWorkflow(options = {}) {
  const snapshot = captureWorkflowSnapshot({
    selectedOnly: Boolean(selectedNodes.value.length),
    withUpstream: Boolean(options.withUpstream),
  });
  const snapshotId = uid();
  const objectKeys = [...new Set(snapshot.materials
    .flatMap((item) => [item.objectKey, item.ossObjectKey, item.path, item.filePath])
    .filter(Boolean))];
  const result = await desktopApi.clipboard.stageWorkflow({
    snapshotId,
    nodes: snapshot.nodes,
    edges: snapshot.edges,
    resources: snapshot.materials,
    objectKeys,
    sourceProjectName: snapshot.sourceProjectName,
    summary: snapshot.summary,
  });
  const summary = result.summary || snapshot.summary;
  showToast(options.withUpstream
    ? `已暂存 ${summary.nodeCount} 个节点（含上游连线）`
    : `已暂存 ${summary.nodeCount} 个节点`);
}

/**
 * 从系统剪贴板 sentinel 加载暂存工作流并粘贴到当前画布。
 * 读取 sentinel → 加载 payload → 重新映射 ID → 追加节点和边。
 */
export async function pasteStagedWorkflow() {
  const sentinel = await desktopApi.clipboard.readStagedSentinel();
  if (!sentinel) return false;
  const payload = await desktopApi.clipboard.loadStagedPayload(sentinel.snapshotId);
  if (!payload) { showToast('暂存工作流已失效'); return false; }
  if (!Array.isArray(payload.nodes) || !payload.nodes.length) { showToast('暂存工作流没有可粘贴的节点'); return false; }
  recordCanvasHistory('粘贴节点');
  const idMap = new Map();
  const pastedMaterials = buildPastedMaterials(payload.resources || []);
  const nodes = payload.nodes.map((node, index) => {
    const nextId = uid();
    idMap.set(node.id, nextId);
    const next = {
      ...clone(node),
      id: nextId,
      x: (node.x || 0) + 60 + index * 16,
      y: (node.y || 0) + 60 + index * 16,
      title: `${node.title || nodeTypeLabel(node.type)} 副本`,
    };
    resetRuntimeState(next);
    remapPastedResourceNode(
      next,
      pastedMaterials.materialIdMap,
      findPastedMaterialForNode(node, pastedMaterials.bySourcePath),
    );
    return next;
  });
  remapImportedNodeReferences(nodes, idMap);
  const edges = payload.edges
    .filter((edge) => idMap.has(edge.source) && idMap.has(edge.target))
    .map((edge) => ({ ...edge, id: uid(), source: idMap.get(edge.source), target: idMap.get(edge.target) }));
  store.project.nodes.push(...nodes);
  const importedEdges = [];
  for (const edge of edges) {
    const result = addCanvasEdge(store.project, edge.source, edge.target, { edge, touch: false });
    if (result.ok && !result.existed) importedEdges.push(result.edge);
  }
  store.selectedNodeId = nodes[0]?.id || null;
  store.selectedNodeIds = nodes.map((node) => node.id);
  store.project.materials.push(...pastedMaterials.materials);
  touchProject();
  showToast(`已粘贴 ${nodes.length} 个节点 / ${importedEdges.length} 条连线`);
  return true;
}

/**
 * 生成当前画布或选中节点的工作流快照 JSON。
 * 用于模板发布等场景。
 * @param {{ selectedOnly?: boolean }} [options]
 * @returns {{ nodes: Array, edges: Array, assets: Array, materials: Array, sourceProjectName: string, summary: Object }}
 */
export function captureWorkflowSnapshot({ selectedOnly = false, withUpstream = false } = {}) {
  const selected = selectedOnly && selectedNodes.value.length
    ? collectSelectedWorkflowNodes({ withUpstream })
    : store.project.nodes;
  const ids = new Set(selected.map((node) => node.id));
  const nodes = selected.map((node) => clone(node));
  const edges = store.project.edges
    .filter((edge) => ids.has(edge.source) && ids.has(edge.target))
    .map((edge) => clone(edge));
  const materials = collectWorkflowMaterials(nodes);
  return {
    nodes, edges,
    assets: clone(store.project.assets),
    materials,
    sourceProjectName: store.project.name,
    summary: {
      nodeCount: nodes.length, edgeCount: edges.length,
      assetCount: materials.length, materialCount: materials.length,
    },
  };
}

function collectSelectedWorkflowNodes({ withUpstream = false } = {}) {
  const byId = new Map();
  for (const node of selectedNodes.value) {
    byId.set(node.id, node);
  }
  if (withUpstream) {
    const nodeById = new Map((store.project.nodes || []).map((node) => [node.id, node]));
    const queue = [...byId.keys()];
    while (queue.length) {
      const targetId = queue.shift();
      for (const edge of store.project.edges || []) {
        if (edge.target !== targetId || byId.has(edge.source)) continue;
        const source = nodeById.get(edge.source);
        if (!source || source.archived) continue;
        byId.set(source.id, source);
        queue.push(source.id);
      }
    }
  }
  return [...byId.values()];
}

/**
 * 将模板工作流导入到当前画布。自动重映射所有节点 ID 和边引用。
 * @param {Object} workflow - 模板工作流 { nodes, edges }
 * @param {string} [title='模板'] - 模板名称，用于 toast 提示
 * @returns {{ importedNodes: number, importedEdges: number }}
 */
export function importWorkflowTemplate(workflow, title = '模板') {
  const templateNodes = (Array.isArray(workflow?.nodes) ? workflow.nodes : [])
    .filter((node) => node?.type !== 'group');
  if (!templateNodes.length) {
    showToast('模板没有可导入的节点');
    return { importedNodes: 0, importedEdges: 0 };
  }
  const idMap = new Map();
  const baseOffset = 80 + store.project.nodes.length * 12;
  templateNodes.forEach((node) => { idMap.set(node.id, uid()); });
  const nodes = templateNodes.map((node, index) => ({
    ...JSON.parse(JSON.stringify(node)),
    id: idMap.get(node.id),
    title: node.title || nodeTypeLabel(node.type),
    x: (Number(node.x) || 0) + baseOffset + index * 10,
    y: (Number(node.y) || 0) + baseOffset + index * 10,
    status: 'idle', progress: 0,
    createdAt: new Date().toISOString(),
  }));
  remapImportedNodeReferences(nodes, idMap);
  const edges = (workflow.edges || [])
    .filter((edge) => idMap.has(edge.source) && idMap.has(edge.target))
    .map((edge) => ({ ...edge, id: uid(), source: idMap.get(edge.source), target: idMap.get(edge.target) }));
  store.project.nodes.push(...nodes);
  const importedEdges = [];
  for (const edge of edges) {
    const result = addCanvasEdge(store.project, edge.source, edge.target, { edge, touch: false });
    if (result.ok && !result.existed) importedEdges.push(result.edge);
  }
  store.selectedNodeId = nodes[0]?.id || null;
  store.selectedNodeIds = nodes.map((node) => node.id);
  store.route = 'creation';
  touchProject();
  showToast(`已导入模板「${title}」`);
  return { importedNodes: nodes.length, importedEdges: importedEdges.length };
}
