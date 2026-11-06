/**
 * 工作流模板的领域状态（应用级，跨项目复用）。
 *
 * 模板是整段流程快照（节点 + 连线 + 素材引用），这里只管列表、持久化与版本规则。
 */

import { reactive } from '@/store/domainReactivity';
import { desktopApi } from '@/services/desktopApi';
import { uid } from '@/utils/format';
import {
  nextTemplateRevision,
  normalizeStoredTemplate,
} from '@/services/workflowTemplateService';
import type { WorkflowTemplate } from '@/domain/workflow/snapshot';

export const workflowTemplateStore = reactive({
  storageVersion: 1,
  templates: [] as WorkflowTemplate[],
  loading: false,
  error: '',
});

function storageSnapshot() {
  return { storageVersion: workflowTemplateStore.storageVersion, templates: workflowTemplateStore.templates };
}

async function persist() {
  const saved = await desktopApi.workflowTemplates.setGlobal(storageSnapshot());
  if (Number.isInteger(saved?.storageVersion)) workflowTemplateStore.storageVersion = saved.storageVersion;
}

export async function loadWorkflowTemplates() {
  workflowTemplateStore.loading = true;
  workflowTemplateStore.error = '';
  try {
    const storage = await desktopApi.workflowTemplates.getGlobal();
    workflowTemplateStore.storageVersion = Number(storage?.storageVersion) || 1;
    const rows = Array.isArray(storage?.templates) ? storage.templates : [];
    const templates: WorkflowTemplate[] = [];
    let invalid = 0;
    for (const row of rows as unknown[]) {
      const template = normalizeStoredTemplate(row);
      if (template) templates.push(template);
      else invalid += 1;
    }
    workflowTemplateStore.templates = templates;
    workflowTemplateStore.error = invalid ? `invalid-templates:${invalid}` : '';
    return templates;
  } catch (error) {
    workflowTemplateStore.error = (error as Error)?.message || '';
    workflowTemplateStore.templates = [];
    return [];
  } finally {
    workflowTemplateStore.loading = false;
  }
}

export function findWorkflowTemplate(id: string): WorkflowTemplate | null {
  return workflowTemplateStore.templates.find((template) => template.id === id) || null;
}

/** 保存：新模板直接加入；已有模板按内容比较，变了才 +1。 */
export async function saveWorkflowTemplate(template: WorkflowTemplate): Promise<WorkflowTemplate> {
  const index = workflowTemplateStore.templates.findIndex((item) => item.id === template.id);
  if (index < 0) {
    workflowTemplateStore.templates = [template, ...workflowTemplateStore.templates];
    await persist();
    return template;
  }
  const previous = workflowTemplateStore.templates[index] as WorkflowTemplate;
  const next = nextTemplateRevision(previous, {
    name: template.name,
    description: template.description,
    nodes: template.nodes,
    edges: template.edges,
    materials: template.materials,
  });
  if (next === previous) return previous;
  workflowTemplateStore.templates = workflowTemplateStore.templates.map((item, itemIndex) => (
    itemIndex === index ? next : item
  ));
  await persist();
  return next;
}

export async function renameWorkflowTemplate(templateId: string, name: string) {
  const template = findWorkflowTemplate(templateId);
  const nextName = String(name || '').trim();
  if (!template || !nextName) return null;
  return saveWorkflowTemplate({ ...template, name: nextName });
}

export async function duplicateWorkflowTemplate(templateId: string, name?: string) {
  const template = findWorkflowTemplate(templateId);
  if (!template) return null;
  const now = new Date().toISOString();
  const copy: WorkflowTemplate = {
    ...template,
    id: `wf-${uid()}`,
    name: String(name || '').trim() || `${template.name} · 副本`,
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
  workflowTemplateStore.templates = [copy, ...workflowTemplateStore.templates];
  await persist();
  return copy;
}

export async function deleteWorkflowTemplate(templateId: string) {
  const before = workflowTemplateStore.templates.length;
  workflowTemplateStore.templates = workflowTemplateStore.templates.filter((template) => template.id !== templateId);
  if (workflowTemplateStore.templates.length === before) return false;
  await persist();
  return true;
}

export function resetWorkflowTemplateStore() {
  workflowTemplateStore.templates = [];
  workflowTemplateStore.storageVersion = 1;
  workflowTemplateStore.error = '';
}
