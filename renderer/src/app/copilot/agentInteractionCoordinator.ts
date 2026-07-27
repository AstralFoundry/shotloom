import type { JsonObject } from '../../agent/core/types';
import {
  hasPendingAgentApproval,
  hasPendingAgentClarification,
  submitAgentApproval,
  submitAgentClarification,
} from '../../agent/runtime/runtimeInteractions';
import {
  getAgentInteraction,
  resolveAgentInteraction,
} from '../../agent/runtime/runStore';
import type { AgentInteraction } from '../../agent/runtime/runStore';
import {
  executeAgentApproveStep,
  executeAgentRejectStep,
} from '../../services/agent/agentCanvasExecutor';

export interface AgentResumeRequest {
  conversationId: string;
  payload: {
    text: string;
    model: string;
    attachments: JsonObject[];
    nodeMentions: JsonObject[];
    continuation: JsonObject;
  };
}

const resolvingInteractions = new Set<string>();

function recoveryRequest(
  interaction: AgentInteraction,
  result: JsonObject,
  succeeded: boolean,
  text: string,
): AgentResumeRequest {
  const checkpoint = interaction.continuation;
  if (!checkpoint.conversationId || !checkpoint.toolCallId || !checkpoint.toolName) {
    throw new Error('该 Agent 没有可恢复的 OpenCode 会话信息');
  }
  return {
    conversationId: checkpoint.conversationId,
    payload: {
      text: `${text}\n\n这是上次中断的 ${checkpoint.toolName} 工具结果：${JSON.stringify(result)}。请在原 OpenCode 会话中核验当前画布后继续，不要重复已成功的操作。`,
      model: checkpoint.model,
      attachments: checkpoint.attachments,
      nodeMentions: checkpoint.nodeMentions,
      continuation: checkpoint,
    },
  };
}

function pendingInteraction(interactionId: string, kind: AgentInteraction['kind']): AgentInteraction {
  const interaction = getAgentInteraction(interactionId);
  if (!interaction || interaction.kind !== kind) throw new Error('这个 Agent 交互已经不存在');
  if (interaction.status === 'expired') throw new Error('这个 Agent 交互已经过期，请重新发起任务');
  if (interaction.status !== 'pending') throw new Error('这个 Agent 交互已经处理过了');
  return interaction;
}

export async function resolveToolConfirmation(
  interactionId: string,
  approved: boolean,
  allowRecovery = true,
) {
  const interaction = pendingInteraction(interactionId, 'tool_confirmation');
  const stepId = String(interaction.payload.stepId || '');
  if (!stepId) throw new Error('工具确认缺少 stepId');
  if (!hasPendingAgentApproval(interaction.runId, stepId) && !allowRecovery) {
    throw new Error('当前有另一个 Agent 正在运行，请等它完成后再处理这个历史确认');
  }
  if (resolvingInteractions.has(interactionId)) throw new Error('该工具确认正在处理中');
  resolvingInteractions.add(interactionId);
  try {
    const execution = approved
      ? await executeAgentApproveStep({ stepId })
      : await executeAgentRejectStep({ stepId, reason: '用户拒绝' });
    const rawResult = approved ? ((execution as JsonObject).result || execution) : execution;
    const result = (rawResult && typeof rawResult === 'object' ? rawResult : {}) as JsonObject;
    const resolvedResult = approved
      ? result
      : { ...result, success: false, rejected: true, error: '用户拒绝了本次操作' };
    resolveAgentInteraction(interactionId, { approved, result: resolvedResult });
    const deliveredToLiveRun = submitAgentApproval(interaction.runId, stepId, {
      approved,
      result: resolvedResult,
      error: approved ? String((execution as JsonObject).error || '') : '用户拒绝了本次操作',
    });
    return deliveredToLiveRun
      ? { deliveredToLiveRun }
      : {
          deliveredToLiveRun,
          resume: recoveryRequest(
            interaction,
            resolvedResult,
            approved && resolvedResult.success === true,
            approved
              ? '工具确认已处理。请基于真实执行结果继续原任务，不要重复已完成的操作。'
              : '工具确认已被用户拒绝。请基于该结果调整原任务或报告明确的阻塞终态。',
          ),
        };
  } finally {
    resolvingInteractions.delete(interactionId);
  }
}

export function resolveClarification(
  interactionId: string,
  answers: Array<{ questionId: string; values: string[] }>,
  skipped = false,
  allowRecovery = true,
) {
  const interaction = pendingInteraction(interactionId, 'question');
  if (!hasPendingAgentClarification(interactionId) && !allowRecovery) {
    throw new Error('当前有另一个 Agent 正在运行，请等它完成后再回答这个历史问题');
  }
  const questions = (interaction.payload.questions as JsonObject[] | undefined) || [];
  const normalized = questions.flatMap((question) => {
    const answer = answers.find((item) => item.questionId === String(question.id || ''));
    const allowed = new Set(((question.options as string[] | undefined) || []).map(String));
    const values = [...new Set((answer?.values || []).map(String).filter((value) => allowed.has(value)))];
    if (!question.multiple && values.length > 1) throw new Error(`问题“${String(question.question || '')}”只能选择一项`);
    return values.length ? [{ questionId: String(question.id), values }] : [];
  });
  const requiredIds = new Set(questions
    .filter((question) => question.required === true)
    .map((question) => String(question.id || '')));
  const answeredIds = new Set(normalized.map((answer) => answer.questionId));
  const missingRequired = [...requiredIds].filter((questionId) => !answeredIds.has(questionId));
  if (!skipped && missingRequired.length) throw new Error('请回答必答问题后继续');
  const result: JsonObject = {
    success: true,
    clarification: { questions, answers: normalized, skipped },
    instruction: skipped
      ? '用户跳过了这些问题，请使用最合理的默认值继续。'
      : `用户的回答：${JSON.stringify(normalized)}。请沿用当前运行上下文继续。`,
  };
  resolveAgentInteraction(interactionId, { answers: normalized, skipped });
  const deliveredToLiveRun = submitAgentClarification(interactionId, normalized, skipped);
  return deliveredToLiveRun
    ? { deliveredToLiveRun }
    : {
        deliveredToLiveRun,
        resume: recoveryRequest(
          interaction,
          result,
          true,
          skipped
            ? '澄清问题已跳过。请使用安全默认值继续原任务。'
            : '澄清问题已回答。请基于这些回答继续原任务，不要重复询问。',
        ),
      };
}
