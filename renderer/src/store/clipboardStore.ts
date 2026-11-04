import { t } from '../i18n/index.ts';
// 工作流剪贴板读写的是持久化的松散 JSON：节点、边与素材都按 AnyRecord 进出，
// 只有 id/路径等标量字段有独立类型。
import { store, touchProject } from '@/store/projectStore';
import { desktopApi } from '@/services/desktopApi';
import { showToast } from '@/store/notificationStore';
import { uid } from '@/utils/format';
import { selectedNodes, nodeTypeLabel } from '@/store/nodeStore';
import { addCanvasEdge, remapImportedNodeReferences } from '@/store/canvasGraphStore';
import { recordCanvasHistory } from '@/store/canvasHistoryStore';
import { captureClipWorkflowNodes, copyClipWorkflowResources, restoreClipWorkflowNodes } from '@/services/clipWorkflowTransfer';
import { canvasSectionMembers } from '@/domain/graph/CanvasSections.ts';

type AnyRecord = Record<string, any>;

function clone(value: unknown): AnyRecord {
  return JSON.parse(JSON.stringify(value ?? null));
}

function basename(value: unknown): string {
  return String(value || '').split(/[\\/]/).filter(Boolean).pop() || '';
}

function stripFileProtocol(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw.startsWith('file://')) return raw;
  try {
    return decodeURIComponent(new URL(raw).pathname);
  } catch {
    return raw.replace(/^file:\/\//i, '');
  }
}

function looksLikeLocalPath(value: unknown): boolean {
  const raw = stripFileProtocol(value);
  return /^[a-z]:[\\/]/i.test(raw) || raw.startsWith('/') || raw.includes('\\');
}

function isRemoteOrDataUrl(value: unknown): boolean {
  return /^(https?:|data:|blob:)/i.test(String(value || '').trim());
}

function looksLikeObjectKey(value: unknown): boolean {
  const raw = stripFileProtocol(value);
  if (!raw || looksLikeLocalPath(raw) || isRemoteOrDataUrl(raw)) return false;
  return raw.includes('/') || /^[\w.-]+\.[a-z0-9]{2,8}$/i.test(raw);
}

function nodeResourceCandidates(node: AnyRecord | null | undefined): string[] {
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

function nodeObjectKeyCandidates(node: AnyRecord | null | undefined): string[] {
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

function collectWorkflowMaterials(nodes: AnyRecord[] = []): AnyRecord[] {
  const nodeMaterialIds = new Set<string>();
  const resourcePaths = new Map<string, AnyRecord>();
  const resourceObjectKeys = new Map<string, AnyRecord>();

  function addPath(path: string, fallback: AnyRecord = {}) {
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

  function addObjectKey(objectKey: string, fallback: AnyRecord = {}) {
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
    for (const asset of node.type === 'clipStudio' ? node.videoEditProject?.assets || [] : []) {
      if (asset.sourceFile) addPath(asset.sourceFile, {
        materialId: asset.id, nodeId: node.id, name: asset.name, resourceType: asset.type,
      });
    }
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

  const materials: AnyRecord[] = [];
  const seenPaths = new Set<string>();
  const seenObjectKeys = new Set<string>();
  for (const material of (store.project.materials || []) as AnyRecord[]) {
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

function buildPastedMaterials(resources: AnyRecord[] = []): {
  materials: AnyRecord[];
  materialIdMap: Map<string, string>;
  bySourcePath: Map<string, AnyRecord>;
} {
  const materialIdMap = new Map<string, string>();
  const bySourcePath = new Map<string, AnyRecord>();
  const materials: AnyRecord[] = [];

  for (const item of resources || []) {
    if (!item?.stagedPath) continue;
    const id = uid();
    const material: AnyRecord = {
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
    [item.path, item.filePath, item.localPath, item.stagedPath].filter(Boolean).forEach((source: string) => {
      bySourcePath.set(stripFileProtocol(source), material);
    });
  }

  return { materials, materialIdMap, bySourcePath };
}

function findPastedMaterialForNode(node: AnyRecord, bySourcePath: Map<string, AnyRecord>): AnyRecord | null {
  for (const candidate of nodeResourceCandidates(node)) {
    const material = bySourcePath.get(stripFileProtocol(candidate));
    if (material) return material;
  }
  return null;
}

function resetRuntimeState(node: AnyRecord) {
  if (['imageGeneration', 'videoGeneration', 'audioGeneration', 'textGeneration'].includes(node.type)) {
    node.status = 'idle';
    node.progress = 0;
    node.error = '';
    node.retryCount = 0;
    delete node.taskId;
    delete node.remoteTaskId;
  }
}

function remapPastedResourceNode(node: AnyRecord, materialIdMap: Map<string, string>, pastedMaterial: AnyRecord | null) {
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
export async function stageSelectedWorkflow(options: AnyRecord = {}) {
  const snapshot = await captureWorkflowSnapshot({
    selectedOnly: Boolean(selectedNodes.value.length),
    withUpstream: Boolean(options.withUpstream),
  });
  const snapshotId = uid();
  const objectKeys = [...new Set(snapshot.materials
    .flatMap((item: AnyRecord) => [item.objectKey, item.ossObjectKey, item.path, item.filePath])
    .filter(Boolean))];
  const result: AnyRecord = await desktopApi.clipboard.stageWorkflow({
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
    ? t("ui.clipboardStore.text.fb6cabf0", { value0: String(summary.nodeCount) })
    : t("ui.clipboardStore.text.bbe33d7c", { value0: String(summary.nodeCount) }));
}

/**
 * 从系统剪贴板 sentinel 加载暂存工作流并粘贴到当前画布。
 * 读取 sentinel → 加载 payload → 重新映射 ID → 追加节点和边。
 */
export async function pasteStagedWorkflow() {
  const owner = store.project;
  const directory = store.projectDir;
  const sentinel = await desktopApi.clipboard.readStagedSentinel();
  if (!sentinel) return false;
  const payload: AnyRecord = await desktopApi.clipboard.loadStagedPayload(sentinel.snapshotId);
  if (!payload) { showToast(t("ui.clipboardStore.text.09a71daf")); return false; }
  if (!Array.isArray(payload.nodes) || !payload.nodes.length) { showToast(t("ui.clipboardStore.text.75dda049")); return false; }
  if (store.project !== owner || store.projectDir !== directory) throw new Error(t("errors.ce6bbc529b"));
  const idMap = new Map<string, string>();
  const resources = await copyClipWorkflowResources(payload.nodes, payload.resources || [], String(directory || ''));
  if (store.project !== owner || store.projectDir !== directory) throw new Error(t("errors.de659eff9f"));
  const pastedMaterials = buildPastedMaterials(resources);
  const nodes: AnyRecord[] = payload.nodes.map((node: AnyRecord, index: number) => {
    const nextId = uid();
    idMap.set(node.id, nextId);
    const next: AnyRecord = {
      ...clone(node),
      id: nextId,
      x: (node.x || 0) + 60 + index * 16,
      y: (node.y || 0) + 60 + index * 16,
      title: t("ui.clipboardStore.text.2d813dfb", { value0: String(node.title || nodeTypeLabel(node.type)) }),
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
  const edges: AnyRecord[] = payload.edges
    .filter((edge: AnyRecord) => idMap.has(edge.source) && idMap.has(edge.target))
    .map((edge: AnyRecord) => ({ ...edge, id: uid(), source: idMap.get(edge.source), target: idMap.get(edge.target) }));
  const edgeIds = new Map<string, string>();
  payload.edges.filter((edge: AnyRecord) => idMap.has(edge.source) && idMap.has(edge.target))
    .forEach((edge: AnyRecord, index: number) => edgeIds.set(edge.id, edges[index]!.id));
  await restoreClipWorkflowNodes(nodes, idMap, edgeIds, new Map([...pastedMaterials.bySourcePath].map(([path, material]) => [path, material.path])), edges);
  if (store.project !== owner || store.projectDir !== directory) throw new Error(t("errors.0ed287b7ab"));
  recordCanvasHistory(t("ui.clipboardStore.text.2c9527b0"));
  store.project.nodes.push(...nodes);
  const importedEdges = [];
  for (const edge of edges) {
    const result = addCanvasEdge(store.project, edge.source, edge.target, { edge, touch: false });
    if (result.ok && !result.existed) importedEdges.push(result.edge);
  }
  store.selectedNodeId = nodes[0]?.id || null;
  store.selectedNodeIds = nodes.map((node: AnyRecord) => node.id);
  store.project.materials.push(...pastedMaterials.materials);
  touchProject();
  showToast(t("ui.clipboardStore.text.1209cbdc", { value0: String(nodes.length), value1: String(importedEdges.length) }));
  return true;
}

/**
 * 生成当前画布或选中节点的工作流快照 JSON。
 * 用于模板发布等场景。
 * @param {{ selectedOnly?: boolean }} [options]
 * @returns {{ nodes: Array, edges: Array, assets: Array, materials: Array, sourceProjectName: string, summary: Object }}
 */
export async function captureWorkflowSnapshot({ selectedOnly = false, withUpstream = false }: { selectedOnly?: boolean; withUpstream?: boolean } = {}) {
  const selected = selectedOnly && selectedNodes.value.length
    ? collectSelectedWorkflowNodes({ withUpstream })
    : (store.project.nodes as AnyRecord[]);
  const ids = new Set(selected.map((node: AnyRecord) => node.id));
  const nodes = selected.map((node: AnyRecord) => clone(node));
  await captureClipWorkflowNodes(nodes);
  const edges = (store.project.edges as AnyRecord[])
    .filter((edge: AnyRecord) => ids.has(edge.source) && ids.has(edge.target))
    .map((edge: AnyRecord) => clone(edge));
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

function collectSelectedWorkflowNodes({ withUpstream = false }: { withUpstream?: boolean } = {}): AnyRecord[] {
  const byId = new Map<string, AnyRecord>();
  for (const node of selectedNodes.value as AnyRecord[]) {
    byId.set(node.id, node);
    if (node.type === 'canvasSection') {
      for (const member of canvasSectionMembers(node as any, store.project.nodes as any[])) byId.set(member.id, member);
    }
  }
  if (withUpstream) {
    const nodeById = new Map<string, AnyRecord>((store.project.nodes || []).map((node: AnyRecord) => [node.id, node]));
    const queue = [...byId.keys()];
    while (queue.length) {
      const targetId = queue.shift();
      for (const edge of (store.project.edges || []) as AnyRecord[]) {
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
export async function importWorkflowTemplate(workflow: AnyRecord, title = t("ui.clipboardStore.text.06d0f38d")) {
  const owner = store.project;
  const directory = store.projectDir;
  const templateNodes = ((Array.isArray(workflow?.nodes) ? workflow.nodes : []) as AnyRecord[])
    .filter((node: AnyRecord) => node?.type !== 'group');
  if (!templateNodes.length) {
    showToast(t("ui.clipboardStore.text.1b2e4184"));
    return { importedNodes: 0, importedEdges: 0 };
  }
  const idMap = new Map<string, string>();
  const baseOffset = 80 + store.project.nodes.length * 12;
  templateNodes.forEach((node: AnyRecord) => { idMap.set(node.id, uid()); });
  const nodes: AnyRecord[] = templateNodes.map((node: AnyRecord, index: number) => ({
    ...JSON.parse(JSON.stringify(node)),
    id: idMap.get(node.id),
    title: node.title || nodeTypeLabel(node.type),
    x: (Number(node.x) || 0) + baseOffset + index * 10,
    y: (Number(node.y) || 0) + baseOffset + index * 10,
    status: 'idle', progress: 0,
    createdAt: new Date().toISOString(),
  }));
  remapImportedNodeReferences(nodes, idMap);
  const edges: AnyRecord[] = (workflow.edges || [])
    .filter((edge: AnyRecord) => idMap.has(edge.source) && idMap.has(edge.target))
    .map((edge: AnyRecord) => ({ ...edge, id: uid(), source: idMap.get(edge.source), target: idMap.get(edge.target) }));
  const edgeIds = new Map<string, string>();
  (workflow.edges || []).filter((edge: AnyRecord) => idMap.has(edge.source) && idMap.has(edge.target))
    .forEach((edge: AnyRecord, index: number) => edgeIds.set(edge.id, edges[index]!.id));
  await restoreClipWorkflowNodes(nodes, idMap, edgeIds, new Map(), edges);
  if (store.project !== owner || store.projectDir !== directory) throw new Error(t("errors.27f3a444ab"));
  recordCanvasHistory(t("ui.clipboardStore.text.a939e0cd"));
  store.project.nodes.push(...nodes);
  const importedEdges = [];
  for (const edge of edges) {
    const result = addCanvasEdge(store.project, edge.source, edge.target, { edge, touch: false });
    if (result.ok && !result.existed) importedEdges.push(result.edge);
  }
  store.selectedNodeId = nodes[0]?.id || null;
  store.selectedNodeIds = nodes.map((node: AnyRecord) => node.id);
  store.route = 'creation';
  touchProject();
  showToast(t("ui.clipboardStore.text.46aa31b9", { value0: String(title) }));
  return { importedNodes: nodes.length, importedEdges: importedEdges.length };
}
