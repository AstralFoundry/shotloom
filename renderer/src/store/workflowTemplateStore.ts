/**
 * 工作流模板的领域状态。
 *
 * 模板跨项目复用，存应用级 JSON；这里只维护列表、持久化与水合，
 * 编译与版本规则在 domain/workflow 与 services/workflowTemplateService。
 */

import { reactive } from '@/store/domainReactivity';
import { desktopApi } from '@/services/desktopApi';
import {
  nextTemplateRevision,
  normalizeStoredTemplate,
} from '@/services/workflowTemplateService';
import type { WorkflowTemplate } from '@/domain/workflow/types';

type AnyRecord = Record<string, any>;

export const workflowTemplateStore = reactive({
  storageVersion: 1,
  templates: [] as WorkflowTemplate[],
  loading: false,
  error: '',
});

function storageSnapshot() {
  return {
    storageVersion: workflowTemplateStore.storageVersion,
    templates: workflowTemplateStore.templates,
  };
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

/**
 * 保存模板：新模板直接加入；已存在的走 revision 规则。
 * 内容没变化时返回同一个对象，不写盘也不递增版本。
 */
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
    definition: template.definition,
    recipe: template.recipe,
  });
  if (next === previous) return previous;
  workflowTemplateStore.templates = workflowTemplateStore.templates.map((item, itemIndex) => (
    itemIndex === index ? next : item
  ));
  await persist();
  return next;
}

export async function deleteWorkflowTemplate(templateId: string) {
  const before = workflowTemplateStore.templates.length;
  workflowTemplateStore.templates = workflowTemplateStore.templates.filter((template) => template.id !== templateId);
  if (workflowTemplateStore.templates.length === before) return false;
  await persist();
  return true;
}

/** 测试与项目切换时清空内存视图。 */
export function resetWorkflowTemplateStore() {
  workflowTemplateStore.templates = [];
  workflowTemplateStore.storageVersion = 1;
  workflowTemplateStore.error = '';
}

export type { WorkflowTemplate, AnyRecord };
