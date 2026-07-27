import { getAgentProjectKey } from '@/services/agentProjectIdentity';
import { store, touchProject } from '@/store/projectStore';
import type { JsonObject } from '../core/types';

export type ProductionExecutionMode = 'plan_only' | 'execute';
export type ProductionOutputType = 'document' | 'image' | 'video' | 'audio' | 'text';
export type ProductionPlanStageStatus = 'pending' | 'doing' | 'blocked' | 'done';

export interface ProductionPlanWorkItem extends JsonObject {
  id: string;
  title: string;
  outputType: ProductionOutputType;
  prompt?: string;
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

function generatedId(prefix: string, index?: number) {
  const order = index === undefined ? '' : `${index + 1}-`;
  return `${prefix}-${order}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function expectedNodeType(outputType: ProductionOutputType): string {
  if (outputType === 'document') return 'note';
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
        ? `重复的工作项 ID ${requestedId} 已重新生成`
        : `第 ${index + 1} 个工作项缺少 ID，已自动生成`);
    } else {
      item.id = requestedId;
    }
    knownIds.add(item.id);

    item.title = String(item.title || '').trim();
    if (!item.title) {
      item.title = `工作项 ${index + 1}`;
      warnings.push(`${item.id} 缺少标题，已使用默认标题`);
    }
    item.prompt = String(item.prompt || '').trim() || undefined;
    if (item.outputType !== 'document' && !item.prompt) {
      warnings.push(`${item.id} 尚未填写生成提示词`);
    }
  });

  for (const item of workItems) {
    const dependencies = Array.isArray(item.dependsOn) ? item.dependsOn.map(String) : [];
    const validDependencies = dependencies.filter((dependencyId, index) => {
      const valid = knownIds.has(dependencyId) && dependencyId !== item.id;
      if (!valid) warnings.push(`${item.id} 的无效依赖 ${dependencyId} 已忽略`);
      return valid && dependencies.indexOf(dependencyId) === index;
    });
    item.dependsOn = validDependencies;
    item.referenceNodeIds = Array.isArray(item.referenceNodeIds) ? item.referenceNodeIds.map(String) : [];
  }
  return warnings;
}

function validateRuntimeRefs(plan: ProductionPlan, stage: ProductionPlanStage, requireOutputs: boolean): void {
  const nodes = (store.project.nodes || []) as JsonObject[];
  const tasks = (store.project.tasks || []) as JsonObject[];
  const nodeById = new Map<string, JsonObject>(nodes.map((node) => [String(node.id), node]));
  const taskById = new Map<string, JsonObject>(tasks.map((task) => [String(task.id), task]));
  const refsByWorkItem = new Map(stage.runtimeRefs.map((ref) => [ref.workItemId, ref]));

  for (const item of stage.workItems) {
    const ref = refsByWorkItem.get(item.id);
    if (!ref?.nodeId) throw new Error(`工作项 ${item.id} 尚未绑定真实画布节点`);
    const node = nodeById.get(ref.nodeId);
    if (!node) throw new Error(`工作项 ${item.id} 引用的节点不存在：${ref.nodeId}`);

    const requiredType = expectedNodeType(item.outputType);
    if (String(node.type) !== requiredType) {
      throw new Error(`工作项 ${item.id} 需要 ${requiredType} 节点，实际是 ${String(node.type || 'unknown')}`);
    }
    if (item.outputType !== 'document') {
      if (!String(node.prompt || '').trim()) throw new Error(`工作项 ${item.id} 的节点缺少 prompt`);
      if (!String(node.model || '').trim()) throw new Error(`工作项 ${item.id} 的节点缺少 model`);
    }
    if (!requireOutputs || item.outputType === 'document') continue;

    const task = ref.taskId ? taskById.get(ref.taskId) : undefined;
    const hasCompletedTask = task?.status === 'completed' && String(task.nodeId || '') === ref.nodeId;
    if (!hasCompletedTask) throw new Error(`工作项 ${item.id} 没有属于该节点的已完成任务`);
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

export function writeProductionPlan(input: {
  conversationId: string;
  title: string;
  goal: string;
  executionMode: ProductionExecutionMode;
  sources?: string[];
  stages: Array<Pick<ProductionPlanStage, 'title' | 'description' | 'workItems' | 'completionCriteria'> & { id?: string }>;
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

export function patchProductionPlanStage(planId: string, stageId: string, patch: JsonObject): ProductionPlan {
  const plan = plans().find((item) => item.schemaVersion === 2 && item.id === planId);
  if (!plan) throw new Error('制作计划不存在');
  const stage = plan.stages.find((item) => item.id === stageId);
  if (!stage) throw new Error('制作阶段不存在');

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
  status: ProductionPlanStageStatus;
  runtimeRefs?: ProductionPlanRuntimeRef[];
  summary?: string;
  blockedReason?: string;
}): ProductionPlan {
  const plan = plans().find((item) => item.schemaVersion === 2 && item.id === input.planId);
  if (!plan) throw new Error('制作计划不存在');
  const index = plan.stages.findIndex((item) => item.id === input.stageId);
  if (index < 0) throw new Error('制作阶段不存在');
  const stage = plan.stages[index];

  const refs = new Map(stage.runtimeRefs.map((ref) => [ref.workItemId, ref]));
  for (const ref of input.runtimeRefs || []) refs.set(ref.workItemId, clone(ref));
  stage.runtimeRefs = [...refs.values()];

  if (input.status === 'done') {
    const requireOutputs = plan.executionMode === 'execute';
    validateRuntimeRefs(plan, stage, requireOutputs);
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
