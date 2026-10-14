import { assertAgentProject } from '@/services/agentProjectIdentity';
import { settingsStore } from '@/store/settingsStore';
import { prepareAgentToolCall } from '../core/toolRegistry';
import { resolveAgentToolPolicy } from '../core/policyEngine';
import type { AgentToolContext, AgentToolReceipt, JsonObject } from '../core/types';
import { createAgentInteraction } from './runStore';
import { waitForAgentApproval } from './runtimeInteractions';
import {
  createLoopGuardState,
  forgetToolCall,
  inspectToolCall,
  loopGuardMessage,
  recordToolCall,
  toolCallFingerprint,
  type LoopGuardState,
} from './loopGuard';
import { buildToolReceipt, receiptChangesProject } from './toolReceipts';
import { markToolCallStarted } from '../loop/transcript';
import { describeArgumentChanges, userOverrideNote } from '@/utils/toolArgumentDiff.mjs';

/**
 * Agent 工具的唯一执行管道。
 *
 * 权限确认、重复调用拦截、用户改参重校验、回执记账和 tool_start/tool_end 事件只有一份实现。
 * 模型循环不得自行调用 definition.execute，否则会绕过其中任何一层。
 */
export interface AgentToolRun {
  context: AgentToolContext;
  model: string;
}

export interface AgentToolCallRequest {
  callId: string;
  name: string;
  /**
   * 模型给出的原始 JSON 字符串，不在引擎层先 JSON.parse 再序列化回来：
   * toolRegistry 的 repair 路径（去掉控制字符、补逗号、截取首尾花括号）
   * 只在拿到真实文本时才可能生效。
   */
  argumentsJson: string;
}

function exposeToolCallId(result: unknown, toolCallId: string): Record<string, unknown> {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    return { ...(result as JsonObject), toolCallId };
  }
  return { value: result, toolCallId };
}

function continuation(run: AgentToolRun, toolCallId: string, toolName: string) {
  const receipts = (run.context.state.get('toolReceipts') as Map<string, AgentToolReceipt>) || new Map<string, AgentToolReceipt>();
  return {
    toolCallId, toolName, model: run.model,
    conversationId: run.context.conversationId, attachments: run.context.attachments,
    nodeMentions: [], successfulToolCallIds: [...((run.context.state.get('successfulToolCallIds') as Set<string>) || [])],
    toolReceipts: [...receipts.values()],
    hasAppliedActions: run.context.state.get('hasAppliedActions') === true,
    activeProductionPlanId: String(run.context.state.get('activeProductionPlanId') || '') || undefined,
    lastActionError: String(run.context.state.get('lastActionError') || ''), modelRounds: 0,
  };
}

const LOOP_GUARD_STATE_KEY = 'loopGuard';

interface GuardedToolCall {
  reject: boolean;
  message: string;
  /** 实际要执行的输入：用户改过参数时是重新校验后的新输入。 */
  input: JsonObject;
  overrideNote: string;
}

/**
 * 同一轮内用实质上相同的参数反复调用同一个工具时，先请用户裁决再执行。
 * 复用现有的 tool_confirmation 交互管道：面板、持久化、过期与中断处理都已具备。
 * `mode: 'decision'` 表示这里没有暂存的画布步骤，只请求"是否继续"。
 */
async function reviewRepeatedToolCall(
  run: AgentToolRun,
  context: AgentToolContext,
  callId: string,
  toolName: string,
  toolInput: JsonObject,
): Promise<GuardedToolCall> {
  const guard = (context.state.get(LOOP_GUARD_STATE_KEY) as LoopGuardState | undefined)
    || createLoopGuardState();
  context.state.set(LOOP_GUARD_STATE_KEY, guard);
  const fingerprint = toolCallFingerprint(toolName, toolInput);
  const { trip, count } = inspectToolCall(guard, fingerprint);
  if (!trip) {
    recordToolCall(guard, fingerprint);
    return { reject: false, message: '', input: toolInput, overrideNote: '' };
  }

  const stepId = `loop:${callId}`;
  const interactionId = `${context.requestId}:tool_confirmation:${stepId}`;
  const title = loopGuardMessage(toolName, count);
  createAgentInteraction({
    id: interactionId, runId: context.requestId, conversationId: context.conversationId,
    projectKey: context.projectKey, kind: 'tool_confirmation',
    payload: {
      toolCallId: callId, toolName, stepId, title, actionCount: 0,
      mode: 'decision', pendingArgs: toolInput,
    },
    continuation: continuation(run, callId, toolName),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString(),
  });
  context.emit({
    type: 'interaction_requested', interactionId, kind: 'tool_confirmation',
    toolCallId: callId, toolName, stepId, title, actionCount: 0,
    pendingArgs: toolInput,
    createdAt: new Date().toISOString(),
  });
  const resolution = await waitForAgentApproval(context.requestId, stepId, context.signal);
  context.emit({
    type: 'interaction_resolved', interactionId, kind: 'tool_confirmation',
    toolCallId: callId, stepId, approved: resolution.approved,
    createdAt: new Date().toISOString(),
  });
  if (!resolution.approved) {
    // 不清空历史：模型若无视回执继续重试，下一次相同调用会被立即拦下。
    return {
      reject: true,
      message: `${title}。用户已拒绝继续重复调用：请改用不同的工具或实质不同的输入，或停下来向用户确认；不要继续微调参数重试。`,
      input: toolInput,
      overrideNote: '',
    };
  }

  const modified = resolution.modifiedArgs;
  // 以"是否携带"判断有没有改过：用户在编辑器里清空成 {} 是有效修改，不能退回原参数。
  if (!modified) {
    forgetToolCall(guard, fingerprint);
    return { reject: false, message: '', input: toolInput, overrideNote: '' };
  }
  // 用户改过参数：按工具自己的 schema 重新校验，不能绕过注册表直接执行。
  let reprepared;
  try {
    reprepared = prepareAgentToolCall(toolName, JSON.stringify(modified), context);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    return {
      reject: true,
      message: `用户修改后的参数未通过校验：${reason}。这次调用没有执行，请向用户说明问题，不要用原参数重试。`,
      input: toolInput,
      overrideNote: '',
    };
  }
  forgetToolCall(guard, toolCallFingerprint(toolName, reprepared.input));
  return {
    reject: false,
    message: '',
    input: reprepared.input,
    overrideNote: userOverrideNote(describeArgumentChanges(toolInput, reprepared.input)),
  };
}

export async function executeAgentToolCall(
  run: AgentToolRun,
  call: AgentToolCallRequest,
): Promise<Record<string, unknown>> {
  const base = run.context;
  const context: AgentToolContext = { ...base, turnId: `${base.requestId}:tool:${call.callId}` };
  assertAgentProject(context.projectKey, context.projectInstanceId, context.projectGeneration);
  const prepared = prepareAgentToolCall(call.name, call.argumentsJson, context);
  const effect = prepared.definition.resolveEffect?.(prepared.input, context) || prepared.definition.effect;
  // “询问”模式：只对会改写项目/画布/启动媒体生成的关键工具申请审批；
  // 只读与 Agent 内部记账（read / agent_state_write）不打扰用户。
  const policy = resolveAgentToolPolicy(effect, {
    ...context,
    requireApproval: settingsStore.agentShellApproval === 'ask',
  });
  if (policy === 'deny') throw new Error('当前用户设置或权限不允许执行这个工具');
  if (policy === 'confirm') {
    const stepId = `policy:${call.callId}`;
    const interactionId = `${context.requestId}:tool_confirmation:${stepId}`;
    const title = prepared.definition.title || prepared.definition.id;
    createAgentInteraction({
      id: interactionId, runId: context.requestId, conversationId: context.conversationId,
      projectKey: context.projectKey, kind: 'tool_confirmation',
      payload: {
        toolCallId: call.callId, toolName: prepared.definition.id, stepId,
        title, actionCount: 0, mode: 'decision', pendingArgs: prepared.input,
      },
      continuation: continuation(run, call.callId, prepared.definition.id),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString(),
    });
    context.emit({
      type: 'interaction_requested', interactionId, kind: 'tool_confirmation',
      toolCallId: call.callId, toolName: prepared.definition.id, stepId, title, actionCount: 0,
      pendingArgs: prepared.input,
      createdAt: new Date().toISOString(),
    });
    const resolution = await waitForAgentApproval(context.requestId, stepId, context.signal);
    context.emit({
      type: 'interaction_resolved', interactionId, kind: 'tool_confirmation',
      toolCallId: call.callId, stepId, approved: resolution.approved,
      createdAt: new Date().toISOString(),
    });
    if (!resolution.approved) {
      throw new Error(resolution.error || `用户拒绝了「${title}」`);
    }
    // 用户在确认时改过参数：按工具自己的 schema 重新校验后执行，而不是用原参数。
    if (resolution.modifiedArgs) {
      const reprepared = prepareAgentToolCall(call.name, JSON.stringify(resolution.modifiedArgs), context);
      prepared.input = reprepared.input;
    }
  }
  const startedAt = new Date().toISOString();
  context.state.set('activeInteractionId', `${context.requestId}:question:${call.callId}`);
  context.state.set('activeInteractionContinuation', continuation(run, call.callId, prepared.definition.id));
  context.emit({
    type: 'tool_start', turnId: context.turnId, toolCallId: call.callId,
    toolName: prepared.definition.id, effect,
    inputSummary: prepared.inputSummary, startedAt,
  });
  try {
    // 循环拦截在 execute 之前完成，拒绝时把失败作为普通结果交给既有回执流程处理，
    // 保证 toolReceipts / lastActionError / tool_end 的记账与其它失败路径一致。
    const guarded = await reviewRepeatedToolCall(run, context, call.callId, prepared.definition.id, prepared.input);
    // 只有真的派发下去才算"已开始执行"；等待用户确认时被打断仍然可以原样重试。
    if (!guarded.reject) markToolCallStarted(context, call.callId);
    let result: any = guarded.reject
      ? { success: false, rejected: true, repeatedToolCall: true, error: guarded.message }
      : await prepared.definition.execute(guarded.input, context);
    if (guarded.overrideNote && result && typeof result === 'object' && !Array.isArray(result)) {
      // 把用户的手动修改明确告知模型，避免它用原参数再试一遍。
      result = { ...result, userOverrideNote: guarded.overrideNote };
    }
    if (result?.pending === true) {
      const step = result.step || {};
      const stepId = String(step.id || step.stepId || '');
      if (!stepId) throw new Error('待确认工具没有返回稳定 stepId');
      const interactionId = `${context.requestId}:tool_confirmation:${stepId}`;
      createAgentInteraction({
        id: interactionId, runId: context.requestId, conversationId: context.conversationId,
        projectKey: context.projectKey, kind: 'tool_confirmation',
        payload: {
          toolCallId: call.callId, toolName: prepared.definition.id, stepId,
          title: String(step.title || prepared.definition.title), actionCount: Number(step.actionCount || 0),
          mode: 'step',
        },
        continuation: continuation(run, call.callId, prepared.definition.id),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString(),
      });
      context.emit({
        type: 'interaction_requested', interactionId, kind: 'tool_confirmation',
        toolCallId: call.callId, toolName: prepared.definition.id, stepId,
        title: String(step.title || prepared.definition.title), actionCount: Number(step.actionCount || 0),
        createdAt: new Date().toISOString(),
      });
      const resolution = await waitForAgentApproval(context.requestId, stepId, context.signal);
      result = resolution.approved
        ? resolution.result
        : { success: false, rejected: true, error: resolution.error || '用户拒绝了本次操作' };
      context.emit({
        type: 'interaction_resolved', interactionId, kind: 'tool_confirmation',
        toolCallId: call.callId, stepId, approved: resolution.approved,
        createdAt: new Date().toISOString(),
      });
    }
    const receipt = buildToolReceipt(call.callId, prepared.definition.id, effect, result,
      prepared.definition.summarizeResult?.(result));
    const receipts = (context.state.get('toolReceipts') as Map<string, AgentToolReceipt>) || new Map<string, AgentToolReceipt>();
    receipts.set(call.callId, receipt);
    context.state.set('toolReceipts', receipts);
    if (receiptChangesProject(receipt)) context.state.set('hasAppliedActions', true);
    if (result?.success !== false) {
      const successful = (context.state.get('successfulToolCallIds') as Set<string>) || new Set<string>();
      successful.add(call.callId);
      context.state.set('successfulToolCallIds', successful);
    } else {
      context.state.set('lastActionError', String(result?.error || '工具执行失败'));
    }
    context.emit({
      type: 'tool_end', turnId: context.turnId, toolCallId: call.callId,
      toolName: prepared.definition.id, isError: result?.success === false,
      error: String(result?.error || ''), receipt,
      toolCallCount: ((context.state.get('successfulToolCallIds') as Set<string>) || new Set<string>()).size,
      endedAt: new Date().toISOString(),
    });
    return exposeToolCallId(result, call.callId);
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause);
    context.emit({
      type: 'tool_end', turnId: context.turnId, toolCallId: call.callId,
      toolName: prepared.definition.id, isError: true, error, endedAt: new Date().toISOString(),
    });
    throw cause;
  }
}
