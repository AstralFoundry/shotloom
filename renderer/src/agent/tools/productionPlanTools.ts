import { registerAgentTool } from '../core/toolRegistry';
import type { AgentToolContext, JsonObject } from '../core/types';
import {
  activeProductionPlan,
  getProductionPlan,
  patchProductionPlanStage,
  productionPlanProgress,
  updateProductionPlanStage,
  writeProductionPlan,
  type ProductionExecutionMode,
  type ProductionPlanRuntimeRef,
  type ProductionPlanStageStatus,
} from '../runtime/productionPlanStore';

const workItemSchema = {
  type: 'object' as const,
  required: ['id', 'title', 'outputType', 'prompt', 'dependsOn', 'referenceNodeIds'],
  properties: {
    id: { type: 'string' as const },
    title: { type: 'string' as const },
    outputType: { type: 'string' as const, enum: ['document', 'image', 'video', 'audio', 'text'] },
    prompt: { type: 'string' as const },
    dependsOn: { type: 'array' as const, items: { type: 'string' as const } },
    referenceNodeIds: { type: 'array' as const, items: { type: 'string' as const } },
  },
  additionalProperties: false,
};

const runtimeRefSchema = {
  type: 'object' as const,
  required: ['workItemId'],
  properties: {
    workItemId: { type: 'string' as const },
    nodeId: { type: 'string' as const },
    taskId: { type: 'string' as const },
  },
  additionalProperties: false,
};

function publish(context: AgentToolContext, plan: JsonObject) {
  context.state.set('activeProductionPlanId', plan.id);
  context.emit({ type: 'production_plan_updated', plan, createdAt: new Date().toISOString() });
}

export function registerProductionPlanTools() {
  registerAgentTool({
    id: 'plan_write',
    title: '创建制作计划',
    effect: 'project_write',
    description: '创建 Production Plan v2。根据用户完整语义选择 plan_only 或 execute。计划允许渐进完善；可恢复的依赖和提示词问题会作为 warning 返回。',
    inputSchema: {
      type: 'object',
      required: ['title', 'goal', 'executionMode', 'stages'],
      additionalProperties: false,
      properties: {
        title: { type: 'string' },
        goal: { type: 'string' },
        executionMode: { type: 'string', enum: ['plan_only', 'execute'] },
        sources: { type: 'array', items: { type: 'string' } },
        stages: {
          type: 'array', minItems: 1,
          items: {
            type: 'object', required: ['title', 'description', 'workItems', 'completionCriteria'], additionalProperties: false,
            properties: {
              id: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' },
              workItems: { type: 'array', items: workItemSchema },
              completionCriteria: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    },
    summarizeInput: (input) => String(input.title || '制作计划'),
    execute: (input, context) => {
      const executionMode = String(input.executionMode) as ProductionExecutionMode;
      const plan = writeProductionPlan({
        conversationId: context.conversationId,
        title: String(input.title || ''),
        goal: String(input.goal || ''),
        executionMode,
        sources: input.sources as string[] | undefined,
        stages: input.stages as any[],
      });
      publish(context, plan);
      return { success: true, planId: plan.id, revision: plan.revision, plan, progress: productionPlanProgress(plan) };
    },
  });

  registerAgentTool({
    id: 'plan_get_stage_status', title: '查看制作计划状态', effect: 'read',
    description: '读取当前 Production Plan v2、阶段进度和活动阶段。',
    inputSchema: { type: 'object', properties: { planId: { type: 'string' } }, additionalProperties: false },
    execute: (input, context) => {
      const plan = String(input.planId || '') ? getProductionPlan(String(input.planId)) : activeProductionPlan(context.conversationId);
      if (!plan) return { success: true, exists: false, plan: null, progress: null };
      publish(context, plan);
      return { success: true, exists: true, planId: plan.id, revision: plan.revision, progress: productionPlanProgress(plan), stages: plan.stages };
    },
  });

  registerAgentTool({
    id: 'plan_get_stage_detail', title: '查看制作阶段详情', effect: 'read',
    description: '读取一个阶段的工作项、提示词、依赖和逐项运行凭证。',
    inputSchema: { type: 'object', required: ['planId', 'stageId'], properties: { planId: { type: 'string' }, stageId: { type: 'string' } }, additionalProperties: false },
    execute: (input, context) => {
      const plan = getProductionPlan(String(input.planId));
      const stage = plan?.stages.find((item) => item.id === String(input.stageId));
      if (!plan || !stage) return { success: true, exists: false, plan: null, stage: null };
      publish(context, plan);
      return { success: true, exists: true, planId: plan.id, executionMode: plan.executionMode, revision: plan.revision, stage };
    },
  });

  registerAgentTool({
    id: 'plan_patch_stage', title: '更新制作阶段计划', effect: 'project_write',
    description: '基于最近读取的 revision 更新尚未完成阶段。若计划已变化会拒绝旧写入，必须重新读取后再提交。',
    inputSchema: {
      type: 'object', required: ['planId', 'stageId', 'expectedRevision'], additionalProperties: false,
      properties: {
        planId: { type: 'string' }, stageId: { type: 'string' }, expectedRevision: { type: 'integer', minimum: 1 }, title: { type: 'string' }, description: { type: 'string' }, summary: { type: 'string' },
        workItems: { type: 'array', items: workItemSchema },
        completionCriteria: { type: 'array', items: { type: 'string' } },
      },
    },
    execute: (input, context) => {
      const plan = patchProductionPlanStage(
        String(input.planId),
        String(input.stageId),
        Number(input.expectedRevision),
        input,
      );
      publish(context, plan);
      return { success: true, planId: plan.id, revision: plan.revision, plan };
    },
  });

  registerAgentTool({
    id: 'plan_update_stage_state', title: '推进制作阶段', effect: 'project_write',
    description: '基于最近读取的 revision 推进阶段状态，并按 workItemId 绑定真实节点和任务；旧 revision 会被拒绝。',
    inputSchema: {
      type: 'object', required: ['planId', 'stageId', 'expectedRevision', 'status'], additionalProperties: false,
      properties: {
        planId: { type: 'string' }, stageId: { type: 'string' },
        expectedRevision: { type: 'integer', minimum: 1 },
        status: { type: 'string', enum: ['doing', 'blocked', 'done'] },
        runtimeRefs: { type: 'array', items: runtimeRefSchema },
        summary: { type: 'string' }, blockedReason: { type: 'string' },
      },
    },
    summarizeInput: (input) => `${String(input.stageId || '阶段')} → ${String(input.status || '')}`,
    execute: (input, context) => {
      const plan = updateProductionPlanStage({
        planId: String(input.planId),
        stageId: String(input.stageId),
        expectedRevision: Number(input.expectedRevision),
        status: input.status as ProductionPlanStageStatus,
        runtimeRefs: input.runtimeRefs as ProductionPlanRuntimeRef[] | undefined,
        summary: input.summary == null ? undefined : String(input.summary),
        blockedReason: input.blockedReason == null ? undefined : String(input.blockedReason),
      });
      publish(context, plan);
      return { success: true, planId: plan.id, revision: plan.revision, plan, progress: productionPlanProgress(plan) };
    },
  });
}
