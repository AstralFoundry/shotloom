/**
 * 可复用工作流的模板服务。
 *
 * 领域层的编译器只负责"选区能不能变成模板"；这里补上命名、槽位文案、
 * revision 递增与可运行性校验。模板跨项目复用，随应用级 JSON 持久化。
 */

import { t, type MessageKey } from '@/i18n';
import { uid } from '@/utils/format';
import {
  WorkflowCompileError,
  compileWorkflowTemplate,
  shareableWorkflowTemplate,
  validateWorkflowDefinition,
  workflowReadiness,
  type CanvasEdgeLike,
  type CanvasNodeLike,
  type CanvasTaskLike,
} from '@/domain/workflow/compile';
import type {
  WorkflowDefinition,
  WorkflowMediaType,
  WorkflowRecipeNode,
  WorkflowRole,
  WorkflowTemplate,
} from '@/domain/workflow/types';

const SLOT_LABELS: Record<string, MessageKey> = {
  'input.image': 'workflow.slot.input.image',
  'input.video': 'workflow.slot.input.video',
  'input.audio': 'workflow.slot.input.audio',
  'input.text': 'workflow.slot.input.text',
  'generation.image': 'workflow.slot.generation.image',
  'generation.video': 'workflow.slot.generation.video',
  'generation.audio': 'workflow.slot.generation.audio',
  'generation.text': 'workflow.slot.generation.text',
  'constant.text': 'workflow.slot.constant.text',
};

export function workflowSlotLabel({
  role,
  mediaType,
}: {
  role: WorkflowRole;
  mediaType: WorkflowMediaType;
  index?: number;
}): string {
  const key = SLOT_LABELS[`${role}.${mediaType}`];
  return key ? t(key) : `${role}:${mediaType}`;
}

export interface BuildWorkflowTemplateInput {
  name?: string;
  description?: string;
  nodes: CanvasNodeLike[];
  edges: CanvasEdgeLike[];
  selection: string[];
  tasks?: CanvasTaskLike[];
  now?: string;
}

function assertRunnable(template: Pick<WorkflowTemplate, 'definition' | 'recipe'>) {
  validateWorkflowDefinition(template.definition);
  // 绑定在运行时才确定；这里只要求每个生成步骤都有配方。
  const issues = workflowReadiness(template.definition, template.recipe, {}).issues
    .filter((issue) => issue.startsWith('missing-recipe:') || issue === 'missing-output');
  if (issues.length) {
    throw new WorkflowCompileError('no-generation-step', `workflow.missingRecipe:${issues.join('|')}`);
  }
}

export function buildWorkflowTemplate(input: BuildWorkflowTemplateInput): WorkflowTemplate {
  const compiled = compileWorkflowTemplate({
    nodes: input.nodes,
    edges: input.edges,
    selection: input.selection,
    ...(input.tasks ? { tasks: input.tasks } : {}),
    genericTitle: workflowSlotLabel,
  });
  const createdAt = input.now || new Date().toISOString();
  const template: WorkflowTemplate = {
    id: `wf-${uid()}`,
    name: String(input.name || '').trim() || t('workflow.template.defaultName'),
    description: String(input.description || '').trim(),
    revision: 1,
    definition: compiled.definition,
    recipe: compiled.recipe,
    createdAt,
    updatedAt: createdAt,
  };
  assertRunnable(template);
  return template;
}

/** 模板内容是否真的变了；没变就不递增 revision，避免版本号空转。 */
function definitionChanged(previous: WorkflowTemplate, next: WorkflowTemplate): boolean {
  return JSON.stringify({
    name: previous.name,
    description: previous.description,
    definition: previous.definition,
    recipe: previous.recipe,
  }) !== JSON.stringify({
    name: next.name,
    description: next.description,
    definition: next.definition,
    recipe: next.recipe,
  });
}

/** 把改动应用到模板；内容有变化时 revision +1，createdAt 保持不变。 */
export function nextTemplateRevision(
  previous: WorkflowTemplate,
  patch: Partial<Pick<WorkflowTemplate, 'name' | 'description' | 'definition' | 'recipe'>>,
  now = new Date().toISOString(),
): WorkflowTemplate {
  const next: WorkflowTemplate = {
    ...previous,
    ...patch,
    revision: previous.revision,
    updatedAt: previous.updatedAt,
  };
  if (!definitionChanged(previous, next)) return previous;
  next.revision = previous.revision + 1;
  next.updatedAt = now;
  assertRunnable(next);
  return next;
}

export function templateShareableCopy(template: WorkflowTemplate, now?: string) {
  return shareableWorkflowTemplate(template, now);
}

const ERROR_KEYS: Record<string, MessageKey> = {
  'empty-selection': 'workflow.error.emptySelection',
  'not-run': 'workflow.error.notRun',
  'no-generation-step': 'workflow.error.noGenerationStep',
  cycle: 'workflow.error.cycle',
  'missing-output': 'workflow.error.missingOutput',
  'unknown-output': 'workflow.error.unknownOutput',
  'unsupported-node': 'workflow.error.unsupportedNode',
};

/** 把编译错误转成可操作的中文提示；未知错误保留原文，不吞掉。 */
export function workflowErrorMessage(error: unknown): string {
  const code = String((error as { code?: unknown })?.code || '');
  const detail = String((error as { detail?: unknown })?.detail || '');
  const key = ERROR_KEYS[code];
  if (key) {
    return detail ? t(key, { name: detail } as never) : t(key);
  }
  return detail || String((error as Error)?.message || '');
}

/** 从磁盘/导入读到的模板可能缺字段或结构损坏，读入时统一规范化。 */
export function normalizeStoredTemplate(value: unknown): WorkflowTemplate | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const definition = record.definition as WorkflowDefinition | undefined;
  if (!definition || typeof definition !== 'object') return null;
  const template: WorkflowTemplate = {
    id: String(record.id || ''),
    name: String(record.name || ''),
    description: String(record.description || ''),
    revision: Math.max(1, Number(record.revision) || 1),
    definition,
    recipe: (record.recipe && typeof record.recipe === 'object' ? record.recipe : {}) as Record<string, WorkflowRecipeNode>,
    createdAt: String(record.createdAt || ''),
    updatedAt: String(record.updatedAt || ''),
  };
  if (!template.id || !template.name) return null;
  try {
    validateWorkflowDefinition(template.definition);
  } catch {
    return null;
  }
  return template;
}
