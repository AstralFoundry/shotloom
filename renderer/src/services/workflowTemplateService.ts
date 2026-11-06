/**
 * 工作流快照服务：保存选区、递增 revision、读入校验。
 *
 * 这里不再判断节点是否运行过，也不拆槽位/配方：选中的整段流程就是模板内容。
 */

import { t } from '@/i18n';
import { uid } from '@/utils/format';
import {
  snapshotWorkflowSelection,
  workflowDisplayOrder,
  type WorkflowSnapshotEdge,
  type WorkflowSnapshotMaterial,
  type WorkflowSnapshotNode,
  type WorkflowTemplate,
} from '@/domain/workflow/snapshot';
import type { WorkflowNodePreview } from '@/domain/workflow/types';

type AnyRecord = Record<string, any>;

export interface BuildWorkflowTemplateInput {
  name?: string;
  description?: string;
  nodes: AnyRecord[];
  edges: AnyRecord[];
  selection: string[];
  materials: AnyRecord[];
  previews?: Record<string, WorkflowNodePreview>;
  now?: string;
}

export function buildWorkflowTemplate(input: BuildWorkflowTemplateInput): WorkflowTemplate {
  const snapshot = snapshotWorkflowSelection({
    nodes: input.nodes,
    edges: input.edges,
    selection: input.selection,
    materials: input.materials,
    ...(input.previews ? { previews: input.previews } : {}),
    ...(input.now ? { now: input.now } : {}),
  });
  const createdAt = input.now || new Date().toISOString();
  return {
    id: `wf-${uid()}`,
    name: String(input.name || '').trim() || t('workflow.template.defaultName'),
    description: String(input.description || '').trim(),
    revision: 1,
    formatVersion: 2,
    nodes: snapshot.nodes,
    edges: snapshot.edges,
    materials: snapshot.materials,
    createdAt,
    updatedAt: createdAt,
  };
}

function contentSignature(template: WorkflowTemplate): string {
  return JSON.stringify({
    name: template.name,
    description: template.description,
    nodes: template.nodes,
    edges: template.edges,
    materials: template.materials,
  });
}

/** 内容变化才递增 revision；没变就返回原对象，避免版本号空转。 */
export function nextTemplateRevision(
  previous: WorkflowTemplate,
  patch: Partial<Pick<WorkflowTemplate, 'name' | 'description' | 'nodes' | 'edges' | 'materials'>>,
  now = new Date().toISOString(),
): WorkflowTemplate {
  const next: WorkflowTemplate = { ...previous, ...patch, formatVersion: 2 };
  if (contentSignature(next) === contentSignature(previous)) return previous;
  return { ...next, revision: previous.revision + 1, updatedAt: now };
}

export function templateShareableCopy(template: WorkflowTemplate, now = new Date().toISOString()) {
  return {
    format: 'shotloom.workflow-template',
    formatVersion: 2,
    id: template.id,
    name: template.name,
    description: template.description,
    revision: template.revision,
    nodes: template.nodes,
    edges: template.edges,
    materials: template.materials,
    exportedAt: now,
  };
}

/** 读入磁盘模板：只接受 v2 快照，旧版槽位模板会被剔除并计数。 */
export function normalizeStoredTemplate(value: unknown): WorkflowTemplate | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as AnyRecord;
  if (record.formatVersion !== 2 || !Array.isArray(record.nodes) || !Array.isArray(record.edges)) return null;
  const id = String(record.id || '');
  const name = String(record.name || '');
  if (!id || !name || !record.nodes.length) return null;
  const nodes = record.nodes as WorkflowSnapshotNode[];
  const ids = new Set(nodes.map((node) => String(node.id)));
  if (ids.size !== nodes.length) return null;
  const edges = (record.edges as WorkflowSnapshotEdge[]).filter((edge) => ids.has(String(edge.source)) && ids.has(String(edge.target)));
  return {
    id,
    name,
    description: String(record.description || ''),
    revision: Math.max(1, Number(record.revision) || 1),
    formatVersion: 2,
    nodes,
    edges,
    materials: Array.isArray(record.materials) ? (record.materials as WorkflowSnapshotMaterial[]) : [],
    createdAt: String(record.createdAt || ''),
    updatedAt: String(record.updatedAt || ''),
  };
}

export { workflowDisplayOrder };

const ERROR_KEYS: Record<string, 'workflow.error.emptySelection'> = {
  'workflow.emptySelection': 'workflow.error.emptySelection',
};

export function workflowErrorMessage(error: unknown): string {
  const message = String((error as Error)?.message || '');
  const key = ERROR_KEYS[message];
  if (key) return t(key);
  return message || t('workflow.error.emptySelection');
}
