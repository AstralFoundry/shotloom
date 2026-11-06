/**
 * 把工作流快照导入当前画布。
 *
 * 语义：整段流程 + 素材一起复制过来，形成可独立编辑的副本。
 * 不自动运行任何节点，也不要求用户再绑定素材。
 */

import { store, touchProject } from '@/store/projectStore';
import { copyFileIntoProjectAssets, registerImportedMaterial } from '@/store/assetStore';
import { recordCanvasHistory } from '@/store/canvasHistoryStore';
import { uid } from '@/utils/format';
import type { WorkflowSnapshotMaterial, WorkflowTemplate } from '@/domain/workflow/snapshot';

type AnyRecord = Record<string, any>;

export interface CloneWorkflowResult {
  nodeIds: string[];
  materialCount: number;
  missingFiles: number;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

async function copyMaterialRecord(
  material: WorkflowSnapshotMaterial,
): Promise<{ materialId: string; path: string; missing: boolean }> {
  const sourcePath = String(material.path || material.filePath || '');
  let copied: AnyRecord = { ...material, path: sourcePath, filePath: sourcePath };
  let missing = false;
  if (sourcePath) {
    copied = await copyFileIntoProjectAssets({
      path: sourcePath,
      name: material.name,
      type: material.mimeType,
      resourceType: material.resourceType,
      size: material.size,
      checksum: material.checksum,
      checksumAlgorithm: material.checksumAlgorithm,
      ext: material.ext,
    });
    const nextPath = String(copied.path || copied.filePath || '');
    if (!nextPath) missing = true;
  }
  const { material: registered } = registerImportedMaterial(
    {
      ...copied,
      path: copied.path || copied.filePath || sourcePath,
      type: copied.mimeType || material.mimeType,
      name: copied.name || material.name,
      size: copied.size || material.size,
      checksum: copied.checksum || material.checksum,
      checksumAlgorithm: copied.checksumAlgorithm || material.checksumAlgorithm,
    },
    { resourceType: material.resourceType, reuseExisting: true, sourceType: 'workflow' },
  );
  return {
    materialId: String(registered.id),
    path: String(registered.path || registered.filePath || sourcePath),
    missing,
  };
}

export async function cloneWorkflowTemplate(template: WorkflowTemplate): Promise<CloneWorkflowResult> {
  const project = store.project as AnyRecord;
  if (!project) throw new Error('workflow.noProject');
  const existing = (project.nodes || []) as AnyRecord[];

  // 放到现有内容右侧，避免与已有节点重叠。
  const minX = template.nodes.reduce((min, node) => Math.min(min, node.x), Number.POSITIVE_INFINITY);
  const minY = template.nodes.reduce((min, node) => Math.min(min, node.y), Number.POSITIVE_INFINITY);
  const rightEdge = existing.reduce((max, node) => Math.max(max, Number(node.x || 0) + Number(node.canvasWidth || 320)), 0);
  const offsetX = existing.length ? Math.round(rightEdge + 120 - (Number.isFinite(minX) ? minX : 0)) : 0;
  const offsetY = existing.length ? Math.round((Number.isFinite(minY) ? 0 : 0) + 80 - (Number.isFinite(minY) ? minY : 0)) : 0;

  // 素材：复制文件 → 注册成当前项目素材 → 记录旧 id 到新 id 的映射。
  const materialMap = new Map<string, string>();
  let missingFiles = 0;
  for (const material of template.materials) {
    const copied = await copyMaterialRecord(material);
    materialMap.set(material.id, copied.materialId);
    if (copied.missing) missingFiles += 1;
  }

  const idMap = new Map<string, string>();
  for (const node of template.nodes) idMap.set(node.id, uid());

  const remapMaterial = (value: unknown) => {
    const key = String(value || '');
    return materialMap.get(key) || key;
  };

  const created: AnyRecord[] = [];
  for (const node of template.nodes) {
    const clone = cloneJson(node) as AnyRecord;
    clone.id = idMap.get(node.id);
    clone.x = Math.round(Number(node.x || 0) + offsetX);
    clone.y = Math.round(Number(node.y || 0) + offsetY);
    delete clone.preview;
    if (node.materialId) clone.materialId = remapMaterial(node.materialId);
    if (clone.uploadedFile && typeof clone.uploadedFile === 'object') {
      if (clone.uploadedFile.materialId) clone.uploadedFile.materialId = remapMaterial(clone.uploadedFile.materialId);
      const filePath = String(clone.uploadedFile.filePath || clone.uploadedFile.path || '');
      if (filePath) {
        const mapped = [...materialMap.entries()].find(([oldId]) => oldId === node.uploadedFile?.materialId)?.[1];
        if (mapped) {
          const mappedMaterial = (project.materials as AnyRecord[]).find((item) => item.id === mapped);
          const nextPath = String(mappedMaterial?.path || filePath);
          clone.uploadedFile.filePath = nextPath;
          clone.uploadedFile.path = nextPath;
        }
      }
    }
    if (Array.isArray(node.generatedOutputs)) {
      clone.generatedOutputs = (node.generatedOutputs as AnyRecord[]).map((output) => {
        const next = cloneJson(output);
        if (output.materialId) next.materialId = remapMaterial(output.materialId);
        const mappedId = output.materialId ? materialMap.get(String(output.materialId)) : '';
        const mappedMaterial = mappedId ? (project.materials as AnyRecord[]).find((item) => item.id === mappedId) : null;
        if (mappedMaterial?.path) {
          next.path = mappedMaterial.path;
          next.filePath = mappedMaterial.path;
        }
        return next;
      });
    }
    if (node.generatedFrom?.nodeId && idMap.has(node.generatedFrom.nodeId)) {
      clone.generatedFrom = { ...node.generatedFrom, nodeId: idMap.get(node.generatedFrom.nodeId) };
    }
    clone.workflowTemplateId = template.id;
    clone.workflowTemplateRevision = template.revision;
    clone.createdAt = new Date().toISOString();
    clone.updatedAt = clone.createdAt;
    created.push(clone);
  }

  if (!created.length) throw new Error('workflow.emptySelection');
  recordCanvasHistory('导入工作流');
  project.nodes = [...existing, ...created];
  for (const edge of template.edges) {
    const source = idMap.get(edge.source);
    const target = idMap.get(edge.target);
    if (!source || !target) continue;
    (project.edges ||= []).push({
      id: uid(),
      source,
      target,
      ...(edge.sourceHandle ? { sourceHandle: edge.sourceHandle } : {}),
      ...(edge.targetHandle ? { targetHandle: edge.targetHandle } : {}),
      ...(edge.kind ? { kind: edge.kind } : {}),
      ...(edge.data ? { data: cloneJson(edge.data) } : {}),
    });
  }
  touchProject();
  return { nodeIds: created.map((node) => String(node.id)), materialCount: materialMap.size, missingFiles };
}
