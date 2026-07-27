import { upsertSkill } from '@/store/skillsStore';
import { upsertRecipe } from '@/store/recipesStore';
import { canRequestAgentClarification, registerAgentTool } from '../core/toolRegistry';
import type { AgentToolReceipt, JsonObject } from '../core/types';
import { waitForAgentClarification } from '../runtime/runtimeInteractions';
import { createAgentInteraction } from '../runtime/runStore';
import type { AgentRunContinuation } from '../runtime/runStore';
import { verifyAgentOutcome, type AgentOutcome } from '../runtime/runtimeVerification';
import { getProductionPlan } from '../runtime/productionPlanStore';
import { store } from '@/store/projectStore';

export function registerLifecycleTools(): void {
  registerAgentTool({
    id: 'request_clarification',
    title: '请求用户澄清',
    description: '只有缺少的信息会实质改变工作流或生成结果时使用。集中提交当前确实需要用户决定的问题，每题提供明确选项，可声明是否多选。调用后暂停同一次运行，收到完整回答后继续。',
    effect: 'agent_state_write',
    isAvailable: () => canRequestAgentClarification(),
    inputSchema: {
      type: 'object',
      required: ['questions'],
      properties: {
        questions: {
          type: 'array', minItems: 1,
          items: {
            type: 'object', required: ['id', 'question', 'options'],
            properties: {
              id: { type: 'string' },
              header: { type: 'string' },
              question: { type: 'string' },
              options: { type: 'array', items: { type: 'string' }, minItems: 2 },
              multiple: { type: 'boolean' },
              required: { type: 'boolean' },
            },
            additionalProperties: false,
          },
        },
        reason: { type: 'string' },
      },
      additionalProperties: false,
    },
    summarizeInput: (input) => String(((input.questions as JsonObject[] | undefined) || [])[0]?.question || '需要用户补充信息'),
    execute: async (input, context) => {
      const questionIds = new Set<string>();
      const questions = ((input.questions as JsonObject[] | undefined) || []).map((item, index) => {
        const options = [...new Set(((item.options as string[] | undefined) || [])
          .map((option) => String(option || '').trim())
          .filter(Boolean))];
        const question = String(item.question || '').trim();
        if (!question || options.length < 2) {
          throw new Error('每个澄清问题都必须包含明确问题和至少 2 个不重复选项');
        }
        const requestedId = String(item.id || '').trim();
        let id = requestedId || `question-${index + 1}`;
        let suffix = 2;
        while (questionIds.has(id)) {
          id = `${requestedId || `question-${index + 1}`}-${suffix}`;
          suffix += 1;
        }
        questionIds.add(id);
        return {
          id,
          header: String(item.header || '').trim(),
          question,
          options,
          multiple: item.multiple === true,
          required: item.required === true,
        };
      });
      const clarification = {
        interactionId: String(context.state.get('activeInteractionId') || ''),
        questions,
        reason: String(input.reason || '').trim(),
      };
      if (!clarification.interactionId) throw new Error('澄清交互没有稳定 interactionId');
      const continuation = context.state.get('activeInteractionContinuation') as AgentRunContinuation | undefined;
      if (!continuation) throw new Error('澄清交互没有可恢复的运行检查点');
      createAgentInteraction({
        id: clarification.interactionId,
        runId: context.requestId,
        conversationId: context.conversationId,
        projectKey: context.projectKey,
        kind: 'question',
        payload: {
          toolCallId: continuation.toolCallId,
          toolName: continuation.toolName,
          questions,
          reason: clarification.reason,
        },
        continuation,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString(),
      });
      const waiting = waitForAgentClarification(clarification.interactionId, context.signal);
      context.emit({
        type: 'clarification_required', runId: context.requestId,
        ...clarification, createdAt: new Date().toISOString(),
      });
      const response = await waiting;
      context.emit({
        type: 'clarification_resolved', runId: context.requestId,
        interactionId: clarification.interactionId,
        answers: response.answers, skipped: response.skipped, createdAt: new Date().toISOString(),
      });
      let instruction = `用户的回答：${JSON.stringify(response.answers)}。请根据回答的完整语义沿用当前运行上下文继续。`;
      if (response.skipped) instruction = '用户跳过了这个问题，请使用已知信息和安全默认值继续。';
      return {
        success: true,
        clarification: { ...clarification, answers: response.answers, skipped: response.skipped },
        instruction,
      };
    },
  });

  registerAgentTool({
    id: 'report_outcome',
    title: '报告最终结果',
    description: '本轮真实修改项目、画布或启动任务后，结束前调用。提交完成、部分完成或阻塞状态，以及可核验的节点、任务和成功工具调用证据。纯聊天或解释不调用。',
    effect: 'agent_state_write',
    inputSchema: {
      type: 'object',
      required: ['status', 'summary', 'evidence'],
      properties: {
        status: { type: 'string', enum: ['completed', 'partial', 'blocked'] },
        summary: { type: 'string' },
        evidence: {
          type: 'object',
          properties: {
            nodeIds: { type: 'array', items: { type: 'string' } },
            taskIds: { type: 'array', items: { type: 'string' } },
            toolCallIds: { type: 'array', items: { type: 'string' } },
          },
          additionalProperties: false,
        },
        remaining: { type: 'array', items: { type: 'string' } },
      },
      additionalProperties: false,
    },
    summarizeInput: (input) => String(input.status || 'outcome'),
    execute: (input, context) => {
      const outcome = input as AgentOutcome;
      const verification = verifyAgentOutcome({
        project: store.project,
        outcome,
        hasAppliedActions: context.state.get('hasAppliedActions') === true,
        toolReceipts: context.state.get('toolReceipts') as Map<string, AgentToolReceipt> || new Map<string, AgentToolReceipt>(),
        productionPlan: getProductionPlan(String(context.state.get('activeProductionPlanId') || '')),
      });
      if (verification.success) context.state.set('verifiedOutcome', outcome);
      return { success: verification.success, outcome, issues: verification.issues };
    },
  });

  registerAgentTool({
    id: 'save_skill_bundle',
    title: '保存 Skill 与关联 Recipes',
    description: '仅当用户明确要求创建或更新 Skill 时使用。按唯一 Shotloom 结构保存一个自定义 Skill 和它关联的 Recipes。',
    effect: 'project_write',
    inputSchema: {
      type: 'object',
      required: ['skill', 'recipes'],
      properties: {
        skill: {
          type: 'object',
          required: ['id', 'name', 'description', 'category', 'triggers', 'instructions', 'recipeIds'],
          properties: {
            id: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' },
            category: { type: 'string' }, version: { type: 'number' }, instructions: { type: 'string' },
            triggers: {
              type: 'object', required: ['keywords'],
              properties: { keywords: { type: 'array', items: { type: 'string' } } }, additionalProperties: false,
            },
            recipeIds: { type: 'array', items: { type: 'string' } },
          },
          additionalProperties: false,
        },
        recipes: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'name', 'description', 'generationType', 'operationTypes', 'systemPrompt', 'requiredElements'],
            properties: {
              id: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' },
              generationType: { type: 'string', enum: ['image', 'video', 'audio', 'text'] },
              operationTypes: { type: 'array', items: { type: 'string' } }, systemPrompt: { type: 'string' },
              requiredElements: { type: 'array', items: { type: 'string' } }, version: { type: 'number' },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
    summarizeInput: (input) => String((input.skill as JsonObject)?.id || 'skill bundle'),
    execute: async (input, context) => {
      const recipes = (input.recipes as JsonObject[]) || [];
      for (const recipe of recipes) await upsertRecipe(recipe);
      const skill = await upsertSkill(input.skill as JsonObject);
      context.emit({
        type: 'skill_studio_result', skillId: String(skill.id), recipeIds: recipes.map((recipe) => String(recipe.id)),
        createdAt: new Date().toISOString(),
      });
      return { success: true, skill, recipes };
    },
  });
}
