import { t } from '../i18n/index.ts';
import { getAgentProjectKey } from '@/services/agentProjectIdentity';
import { store, touchProject } from '@/store/projectStore';
import type { JsonObject } from '@/agent/core/types';

export type ProductionExecutionMode = 'plan_only' | 'execute';
export type ProductionOutputType = 'image' | 'video' | 'audio' | 'text';
export type ProductionPlanStageStatus = 'pending' | 'doing' | 'blocked' | 'done';

export interface ProductionPlanWorkItem extends JsonObject {
  id: string;
  title: string;
  outputType: ProductionOutputType;
  // 规范化会把缺失提示词显式写成 undefined（"这项还没有提示词"），所以这里必须允许显式 undefined。
  prompt?: string | undefined;
  dependsOn: string[];
  referenceNodeIds: string[];
}

export interface ProductionPlanRuntimeRef extends JsonObject {
  workItemId: string;
  nodeId?: string;
  taskId?: string;
}

export interface ProductionPlanStage extends JsonObject {
  id: string;
  order: number;
  title: string;
  description: string;
  status: ProductionPlanStageStatus;
  authored: boolean;
  workItems: ProductionPlanWorkItem[];
  completionCriteria: string[];
  runtimeRefs: ProductionPlanRuntimeRef[];
  summary?: string;
  blockedReason?: string;
}

export interface ProductionPlan extends JsonObject {
  schemaVersion: 2;
  id: string;
  conversationId: string;
  projectKey: string;
  title: string;
  goal: string;
  executionMode: ProductionExecutionMode;
  revision: number;
  sources: string[];
  stages: ProductionPlanStage[];
  warnings: string[];
  createdAt: string;
  updatedAt: string;
}

function plans(): ProductionPlan[] {
  if (!Array.isArray(store.project.productionPlans)) store.project.productionPlans = [];
  return store.project.productionPlans as ProductionPlan[];
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class StaleProductionPlanRevisionError extends Error {
  readonly expectedRevision: number;
  readonly currentRevision: number;

  constructor(expectedRevision: number, currentRevision: number) {
    super(t("ui.productionPlanStore.text.40867c06", { value0: String(expectedRevision), value1: String(currentRevision) }));
    this.name = 'StaleProductionPlanRevisionError';
    this.expectedRevision = expectedRevision;
    this.currentRevision = currentRevision;
  }
}

function assertExpectedRevision(plan: ProductionPlan, expectedRevision: number): void {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
    throw new Error(t("ui.productionPlanStore.text.7b3475fd"));
  }
  if (plan.revision !== expectedRevision) {
    throw new StaleProductionPlanRevisionError(expectedRevision, plan.revision);
  }
}

function generatedId(prefix: string, index?: number) {
  const order = index === undefined ? '' : `${index + 1}-`;
  return `${prefix}-${order}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function expectedNodeType(outputType: ProductionOutputType): string {
  if (outputType === 'image') return 'imageGeneration';
  if (outputType === 'video') return 'videoGeneration';
  if (outputType === 'audio') return 'audioGeneration';
  return 'textGeneration';
}

function normalizePlanStructure(stages: ProductionPlanStage[]): string[] {
  const warnings: string[] = [];
  const workItems = stages.flatMap((stage) => stage.workItems);
  const knownIds = new Set<string>();

  workItems.forEach((item, index) => {
    const requestedId = String(item.id || '').trim();
    if (!requestedId || knownIds.has(requestedId)) {
      item.id = generatedId('work', index);
      warnings.push(requestedId
        ? t("ui.productionPlanStore.text.4bbf346d", { value0: String(requestedId) })
        : t("ui.productionPlanStore.text.cf54c6b8", { value0: String(index + 1) }));
    } else {
      item.id = requestedId;
    }
    knownIds.add(item.id);

    item.title = String(item.title || '').trim();
    if (!item.title) {
      item.title = t("ui.productionPlanStore.text.c0b7277b", { value0: String(index + 1) });
      warnings.push(t("ui.productionPlanStore.text.33d77c09", { value0: String(item.id) }));
    }
    item.prompt = String(item.prompt || '').trim() || undefined;
    if (!item.prompt) {
      warnings.push(t("ui.productionPlanStore.text.98612ca0", { value0: String(item.id) }));
    }
  });

  for (const item of workItems) {
    const dependencies = Array.isArray(item.dependsOn) ? item.dependsOn.map(String) : [];
    const validDependencies = dependencies.filter((dependencyId, index) => {
      const valid = knownIds.has(dependencyId) && dependencyId !== item.id;
      if (!valid) warnings.push(t("ui.productionPlanStore.text.a4dca711", { value0: String(item.id), value1: String(dependencyId) }));
      return valid && dependencies.indexOf(dependencyId) === index;
    });
    item.dependsOn = validDependencies;
    item.referenceNodeIds = Array.isArray(item.referenceNodeIds) ? item.referenceNodeIds.map(String) : [];
  }
  return warnings;
}

function validateRuntimeRefs(stage: ProductionPlanStage, requireOutputs: boolean): void {
  const nodes = (store.project.nodes || []) as JsonObject[];
  const tasks = (store.project.tasks || []) as JsonObject[];
  const nodeById = new Map<string, JsonObject>(nodes.map((node) => [String(node.id), node]));
  const taskById = new Map<string, JsonObject>(tasks.map((task) => [String(task.id), task]));
  const refsByWorkItem = new Map(stage.runtimeRefs.map((ref) => [ref.workItemId, ref]));

  for (const item of stage.workItems) {
    const ref = refsByWorkItem.get(item.id);
    if (!ref?.nodeId) throw new Error(t("ui.productionPlanStore.text.2b4ed0f5", { value0: String(item.id) }));
    const node = nodeById.get(ref.nodeId);
    if (!node) throw new Error(t("ui.productionPlanStore.text.0b9fad43", { value0: String(item.id), value1: String(ref.nodeId) }));

    const requiredType = expectedNodeType(item.outputType);
    if (String(node.type) !== requiredType) {
      throw new Error(t("ui.productionPlanStore.text.9e32d67f", { value0: String(item.id), value1: String(requiredType), value2: String(String(node.type || 'unknown')) }));
    }
    if (!String(node.prompt || '').trim()) throw new Error(t("ui.productionPlanStore.text.86f6ee7a", { value0: String(item.id) }));
    if (!String(node.model || '').trim()) throw new Error(t("ui.productionPlanStore.text.b14c2201", { value0: String(item.id) }));
    if (!requireOutputs) continue;

    const task = ref.taskId ? taskById.get(ref.taskId) : undefined;
    const hasCompletedTask = task?.status === 'completed' && String(task.nodeId || '') === ref.nodeId;
    if (!hasCompletedTask) throw new Error(t("ui.productionPlanStore.text.7c6383de", { value0: String(item.id) }));
  }

}

export function activeProductionPlan(conversationId: string): ProductionPlan | undefined {
  const projectKey = getAgentProjectKey();
  const found = plans().find((plan) => plan.schemaVersion === 2
    && plan.conversationId === conversationId
    && plan.projectKey === projectKey
    && plan.stages.some((stage) => stage.status !== 'done'));
  return found ? clone(found) : undefined;
}

export function getProductionPlan(id: string): ProductionPlan | undefined {
  const found = plans().find((plan) => plan.schemaVersion === 2 && plan.id === id);
  return found ? clone(found) : undefined;
}

/**
 * 送给模型的计划候选摘要。只保留模型判断"这次请求是否续上做业"需要的字段，
 * 完整阶段内容仍要用 plan_get_stage_* 读取真实数据。
 */
export function activeProductionPlanSummary(conversationId: string): JsonObject | undefined {
  const plan = activeProductionPlan(conversationId);
  if (!plan) return undefined;
  return {
    id: plan.id,
    revision: plan.revision,
    title: plan.title,
    goal: plan.goal,
    executionMode: plan.executionMode,
    stages: plan.stages.map((stage) => ({ id: stage.id, title: stage.title, status: stage.status })),
  };
}

export function writeProductionPlan(input: {
  conversationId: string;
  title: string;
  goal: string;
  executionMode: ProductionExecutionMode;
  sources?: string[] | undefined;
  stages: Array<Pick<ProductionPlanStage, 'title' | 'description' | 'workItems' | 'completionCriteria'> & { id?: string | undefined }>;
}): ProductionPlan {
  const now = new Date().toISOString();
  const normalizedStages: ProductionPlanStage[] = input.stages.map((stage, index) => {
    const status: ProductionPlanStageStatus = index === 0 ? 'doing' : 'pending';
    return {
      id: String(stage.id || generatedId('stage', index)),
      order: index + 1,
      title: String(stage.title || '').trim(),
      description: String(stage.description || '').trim(),
      status,
      authored: stage.workItems.length > 0,
      workItems: clone(stage.workItems).map((item) => ({
        id: String(item.id || '').trim(),
        title: String(item.title || '').trim(),
        outputType: item.outputType,
        prompt: String(item.prompt || '').trim() || undefined,
        dependsOn: Array.isArray(item.dependsOn) ? item.dependsOn.map(String) : [],
        referenceNodeIds: Array.isArray(item.referenceNodeIds) ? item.referenceNodeIds.map(String) : [],
      })),
      completionCriteria: stage.completionCriteria.map(String).filter(Boolean),
      runtimeRefs: [],
    };
  });
  const warnings = normalizePlanStructure(normalizedStages);

  const next: ProductionPlan = {
    schemaVersion: 2,
    id: generatedId('plan'),
    conversationId: input.conversationId,
    projectKey: getAgentProjectKey(),
    title: input.title.trim(),
    goal: input.goal.trim(),
    executionMode: input.executionMode,
    revision: 1,
    sources: (input.sources || []).map(String).filter(Boolean),
    stages: normalizedStages,
    warnings,
    createdAt: now,
    updatedAt: now,
  };
  plans().unshift(next);
  if (plans().length > 50) plans().splice(50);
  touchProject({ sessionDelay: 0, coalesceSession: false });
  return clone(next);
}

export function patchProductionPlanStage(
  planId: string,
  stageId: string,
  expectedRevision: number,
  patch: JsonObject,
): ProductionPlan {
  const plan = plans().find((item) => item.schemaVersion === 2 && item.id === planId);
  if (!plan) throw new Error(t("ui.productionPlanStore.text.deb2e322"));
  assertExpectedRevision(plan, expectedRevision);
  const stage = plan.stages.find((item) => item.id === stageId);
  if (!stage) throw new Error(t("ui.productionPlanStore.text.e94d2b8b"));

  if (patch.title != null) stage.title = String(patch.title).trim();
  if (patch.description != null) stage.description = String(patch.description).trim();
  if (patch.summary != null) stage.summary = String(patch.summary).trim();
  if (Array.isArray(patch.completionCriteria)) stage.completionCriteria = patch.completionCriteria.map(String).filter(Boolean);
  if (Array.isArray(patch.workItems)) {
    stage.workItems = clone(patch.workItems as ProductionPlanWorkItem[]);
    stage.authored = stage.workItems.length > 0;
  }
  plan.warnings = normalizePlanStructure(plan.stages);
  plan.revision += 1;
  plan.updatedAt = new Date().toISOString();
  touchProject({ sessionDelay: 0, coalesceSession: false });
  return clone(plan);
}

export function updateProductionPlanStage(input: {
  planId: string;
  stageId: string;
  expectedRevision: number;
  status: ProductionPlanStageStatus;
  runtimeRefs?: ProductionPlanRuntimeRef[] | undefined;
  summary?: string | undefined;
  blockedReason?: string | undefined;
}): ProductionPlan {
  const plan = plans().find((item) => item.schemaVersion === 2 && item.id === input.planId);
  if (!plan) throw new Error(t("ui.productionPlanStore.text.deb2e322"));
  assertExpectedRevision(plan, input.expectedRevision);
  const index = plan.stages.findIndex((item) => item.id === input.stageId);
  const stage = plan.stages[index];
  if (!stage) throw new Error(t("ui.productionPlanStore.text.e94d2b8b"));

  const refs = new Map(stage.runtimeRefs.map((ref) => [ref.workItemId, ref]));
  for (const ref of input.runtimeRefs || []) refs.set(ref.workItemId, clone(ref));
  stage.runtimeRefs = [...refs.values()];

  if (input.status === 'done') {
    const requireOutputs = plan.executionMode === 'execute';
    validateRuntimeRefs(stage, requireOutputs);
  }

  stage.status = input.status;
  if (input.summary != null) stage.summary = input.summary.trim();
  if (input.blockedReason != null) stage.blockedReason = input.blockedReason.trim();
  if (input.status === 'done') {
    const nextStage = plan.stages[index + 1];
    if (nextStage?.status === 'pending') {
      nextStage.status = 'doing';
    }
  }
  plan.revision += 1;
  plan.updatedAt = new Date().toISOString();
  touchProject({ sessionDelay: 0, coalesceSession: false });
  return clone(plan);
}

export function productionPlanProgress(plan: ProductionPlan) {
  const done = plan.stages.filter((stage) => stage.status === 'done').length;
  const active = plan.stages.find((stage) => ['doing', 'blocked'].includes(stage.status));
  return { done, total: plan.stages.length, complete: done === plan.stages.length, activeStageId: active?.id || '' };
}
