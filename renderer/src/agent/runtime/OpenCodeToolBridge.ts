import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { assertAgentProject } from '@/services/agentProjectIdentity';
import { registerDefaultAgentTools } from '../tools/registerDefaultTools';
import { listAgentTools, prepareAgentToolCall } from '../core/toolRegistry';
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
import { describeArgumentChanges, userOverrideNote } from '@/utils/toolArgumentDiff.mjs';

interface BridgeRun {
  context: AgentToolContext;
  model: string;
}

function exposeToolCallId(result: unknown, toolCallId: string) {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    return { ...(result as JsonObject), toolCallId };
  }
  return { value: result, toolCallId };
}

let activeRun: BridgeRun | null = null;
let unlisten: UnlistenFn | null = null;

function continuation(run: BridgeRun, toolCallId: string, toolName: string) {
  const receipts = (run.context.state.get('toolReceipts') as Map<string, AgentToolReceipt>) || new Map<string, AgentToolReceipt>();
  return {
    toolCallId, toolName, model: run.model,
    conversationId: run.context.conversationId, sessionMessages: [], attachments: run.context.attachments,
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
  run: BridgeRun,
  context: AgentToolContext,
  payload: { callId: string },
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

  const stepId = `loop:${payload.callId}`;
  const interactionId = `${context.requestId}:tool_confirmation:${stepId}`;
  const title = loopGuardMessage(toolName, count);
  createAgentInteraction({
    id: interactionId, runId: context.requestId, conversationId: context.conversationId,
    projectKey: context.projectKey, kind: 'tool_confirmation',
    payload: {
      toolCallId: payload.callId, toolName, stepId, title, actionCount: 0,
      mode: 'decision', pendingArgs: toolInput,
    },
    continuation: continuation(run, payload.callId, toolName),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString(),
  });
  context.emit({
    type: 'interaction_requested', interactionId, kind: 'tool_confirmation',
    toolCallId: payload.callId, toolName, stepId, title, actionCount: 0,
    pendingArgs: toolInput,
    createdAt: new Date().toISOString(),
  });
  const resolution = await waitForAgentApproval(context.requestId, stepId, context.signal);
  context.emit({
    type: 'interaction_resolved', interactionId, kind: 'tool_confirmation',
    toolCallId: payload.callId, stepId, approved: resolution.approved,
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

async function executeRequest(payload: { requestId: string; callId: string; name: string; arguments?: JsonObject }) {
  const run = activeRun;
  if (!run || run.context.requestId !== payload.requestId) throw new Error('Shotloom tool transport has no matching active Agent run');
  run.context.signal.throwIfAborted();
  const context: AgentToolContext = {
    ...run.context,
    turnId: `${run.context.requestId}:tool:${payload.callId}`,
  };
  assertAgentProject(context.projectKey, context.projectInstanceId, context.projectGeneration);
  const prepared = prepareAgentToolCall(payload.name, JSON.stringify(payload.arguments || {}), context);
  const effect = prepared.definition.resolveEffect?.(prepared.input, context) || prepared.definition.effect;
  const policy = resolveAgentToolPolicy(effect, context);
  if (policy === 'deny') throw new Error('当前用户设置或权限不允许执行这个工具');
  const startedAt = new Date().toISOString();
  context.state.set('activeInteractionId', `${context.requestId}:question:${payload.callId}`);
  context.state.set('activeInteractionContinuation', continuation(run, payload.callId, prepared.definition.id));
  context.emit({
    type: 'tool_start', turnId: context.turnId, toolCallId: payload.callId,
    toolName: prepared.definition.id, effect,
    inputSummary: prepared.inputSummary, startedAt,
  });
  try {
    // 循环拦截在 execute 之前完成，拒绝时把失败作为普通结果交给既有回执流程处理，
    // 保证 toolReceipts / lastActionError / tool_end 的记账与其它失败路径一致。
    const guarded = await reviewRepeatedToolCall(
      run, context, payload, prepared.definition.id, prepared.input,
    );
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
          toolCallId: payload.callId, toolName: prepared.definition.id, stepId,
          title: String(step.title || prepared.definition.title), actionCount: Number(step.actionCount || 0),
          mode: 'step',
        },
        continuation: continuation(run, payload.callId, prepared.definition.id),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString(),
      });
      context.emit({
        type: 'interaction_requested', interactionId, kind: 'tool_confirmation',
        toolCallId: payload.callId, toolName: prepared.definition.id, stepId,
        title: String(step.title || prepared.definition.title), actionCount: Number(step.actionCount || 0),
        createdAt: new Date().toISOString(),
      });
      const resolution = await waitForAgentApproval(context.requestId, stepId, context.signal);
      result = resolution.approved
        ? resolution.result
        : { success: false, rejected: true, error: resolution.error || '用户拒绝了本次操作' };
      context.emit({
        type: 'interaction_resolved', interactionId, kind: 'tool_confirmation',
        toolCallId: payload.callId, stepId, approved: resolution.approved,
        createdAt: new Date().toISOString(),
      });
    }
    const receipt = buildToolReceipt(payload.callId, prepared.definition.id, effect, result);
    const receipts = (context.state.get('toolReceipts') as Map<string, AgentToolReceipt>) || new Map<string, AgentToolReceipt>();
    receipts.set(payload.callId, receipt);
    context.state.set('toolReceipts', receipts);
    if (receiptChangesProject(receipt)) context.state.set('hasAppliedActions', true);
    if (result?.success !== false) {
      const successful = (context.state.get('successfulToolCallIds') as Set<string>) || new Set<string>();
      successful.add(payload.callId);
      context.state.set('successfulToolCallIds', successful);
    } else {
      context.state.set('lastActionError', String(result?.error || '工具执行失败'));
    }
    context.emit({
      type: 'tool_end', turnId: context.turnId, toolCallId: payload.callId,
      toolName: prepared.definition.id, isError: result?.success === false,
      error: String(result?.error || ''), receipt,
      toolCallCount: ((context.state.get('successfulToolCallIds') as Set<string>) || new Set<string>()).size,
      endedAt: new Date().toISOString(),
    });
    return exposeToolCallId(result, payload.callId);
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause);
    context.emit({
      type: 'tool_end', turnId: context.turnId, toolCallId: payload.callId,
      toolName: prepared.definition.id, isError: true, error, endedAt: new Date().toISOString(),
    });
    throw cause;
  }
}

async function ensureListener() {
  if (unlisten) return;
  unlisten = await listen<{ requestId: string; callId: string; name: string; arguments?: JsonObject }>('agent-tool-request', async ({ payload }) => {
    try {
      const result = await executeRequest(payload);
      await invoke('agent_tool_reply', { callId: payload.callId, result, error: null });
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : String(cause);
      await invoke('agent_tool_reply', { callId: payload.callId, result: null, error }).catch(() => undefined);
    }
  });
}

export async function activateOpenCodeToolBridge(run: BridgeRun) {
  registerDefaultAgentTools();
  if (activeRun && activeRun.context.requestId !== run.context.requestId) {
    throw new Error('Shotloom tool transport already has an active Agent run');
  }
  activeRun = run;
  await ensureListener();
  const tools = listAgentTools(run.context).map((tool) => ({
    name: tool.id,
    description: tool.description,
    inputSchema: tool.resolveInputSchema?.(run.context) || tool.inputSchema,
  }));
  await invoke('agent_runtime_register_tools', { tools, requestId: run.context.requestId });
  return tools;
}

export async function deactivateOpenCodeToolBridge(requestId: string) {
  if (activeRun?.context.requestId === requestId) activeRun = null;
  await invoke('agent_runtime_release_tool_run', { requestId }).catch(() => undefined);
}
