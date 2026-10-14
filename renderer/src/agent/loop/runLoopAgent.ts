import { invoke } from '@tauri-apps/api/core';
import { assertAgentProject, getAgentProjectIdentity, getAgentProjectKey } from '@/services/agentProjectIdentity';
import { desktopApi } from '@/services/desktopApi';
import { store } from '@/store/projectStore';
import { settingsStore } from '@/store/settingsStore';
import { canvasMutationFingerprint } from '@/utils/canvasMutationFingerprint.mjs';
import { agentDefinition } from '../agents/definitions.ts';
import { buildAgentSystemPrompt, buildRunContextBlock } from '../content/instructions';
import { resolveImageAttachments } from '../content/attachments';
import { registerDefaultAgentTools } from '../tools/registerDefaultTools';
import { appendAgentRuntimeEvent } from '../runtime/runStore';
import { diagnoseRuntimeFailure, RuntimeDiagnosticError } from '../runtime/runtimeDiagnostics';
import { activeProductionPlanSummary } from '../runtime/productionPlanStore';
import { runAgentLoop, type LoopModelCaller } from './agentLoop';
import { createStallWatchdog } from './stallWatchdog';
import { resolveLoopModelPlan, type LoopModelPlan } from './modelRequest';
import {
  closeDanglingToolCalls,
  loadConversationTranscript,
  saveConversationTranscript,
  type ChatMessage,
} from './transcript';
import type { AgentPromptPayload, AgentRunResult, AgentRuntimeEvent, AgentToolContext, AgentToolReceipt, JsonObject } from '../core/types';

/**
 * Agent 的唯一运行入口：模型循环、会话历史、上下文裁剪与子 Agent 都在这里驱动。
 *
 * 模型请求走渲染进程已有的流式网关（鉴权由 Rust 按 providerId 注入），模型可见历史由
 * 本模块自己读写并持久化在会话记录上；界面层只消费这里发出的事件流与诊断结果。
 */

const LOOP_RUNTIME_MODEL_CONTRACT = '模型循环、会话历史、上下文裁剪与子 Agent 全部由 Shotloom 自研 Agent Loop 管理；历史里的工具结果都是本地真实回执。超出上下文预算时，较早的对话会整组丢弃且不再对你可见，需要旧信息就用只读工具重新查看真实状态，不要假设自己记得全部历史。';
const INTERRUPTED_TOOL_NOTE = '这次工具调用因为本轮运行中断而没有执行，没有产生任何效果。';

const activeLoopRuns = new Map<string, AbortController>();

function uid(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function conversationRecord(conversationId: string): JsonObject | undefined {
  return (store.project.copilotConversations as JsonObject[] | undefined || [])
    .find((item) => String(item.id || '') === conversationId);
}

/**
 * 流式 Chat Completions 响应转成循环需要的结构。
 *
 * finish_reason 不在累加器的返回值里，只能从原始 SSE 事件取；它是"输出被截断"和
 * "正常结束"的唯一区别，靠猜会把截断的回复当成最终答案。
 */
function createModelCaller(signal: AbortSignal): LoopModelCaller {
  return async (body, onTextDelta) => {
    let finishReason = '';
    const response = await desktopApi.model.chatCompletionStream({ ...body, __signal: signal },
      (delta: string, rawEvent?: JsonObject) => {
        const reason = (rawEvent?.choices as Array<JsonObject> | undefined)?.[0]?.finish_reason;
        if (typeof reason === 'string' && reason) finishReason = reason;
        if (delta) onTextDelta(delta);
      }) as {
        choices?: Array<{ message?: { content?: string; tool_calls?: Array<JsonObject> } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
    const message = response?.choices?.[0]?.message || {};
    const toolCalls = ((message.tool_calls as Array<JsonObject> | undefined) || []).map((call, index) => ({
      id: String(call.id || `call-${index + 1}`),
      type: 'function' as const,
      function: {
        name: String((call.function as JsonObject | undefined)?.name || ''),
        arguments: String((call.function as JsonObject | undefined)?.arguments || '{}'),
      },
    }));
    return {
      text: typeof message.content === 'string' ? message.content : '',
      toolCalls,
      // provider 没上报 finish_reason 时只按已观察到的事实推断，不据此宣称正常结束。
      finishReason: finishReason || (toolCalls.length ? 'tool_calls' : 'stop'),
      usage: response?.usage ? {
        input: Number(response.usage.prompt_tokens || 0),
        output: Number(response.usage.completion_tokens || 0),
      } : undefined,
    };
  };
}

async function userMessage(text: string, attachments: JsonObject[]): Promise<ChatMessage> {
  const images = await resolveImageAttachments(attachments);
  if (!images.length) return { role: 'user', content: text };
  return {
    role: 'user',
    content: [
      { type: 'text', text },
      ...images.map((image) => ({ type: 'image_url' as const, image_url: { url: image.url } })),
    ],
  };
}

export async function runLoopAgent(
  payload: AgentPromptPayload = {},
  onEvent: (event: AgentRuntimeEvent) => void = () => undefined,
): Promise<AgentRunResult> {
  const requestId = String(payload.requestId || uid('agent'));
  if (activeLoopRuns.size) throw new Error('当前已有 Agent 正在运行，请等待完成或先取消');
  const controller = new AbortController();
  const projectKey = String(payload.projectKey || getAgentProjectKey());
  const projectIdentity = getAgentProjectIdentity();
  const conversationId = String(payload.conversationId || '');
  // 会话记录上的 agentId 决定本轮使用哪个 Agent 定义；未声明的 id 直接失败，
  // 不退回默认 Agent，避免错误配置静默获得另一套工具权限。
  const agentId = String(conversationRecord(conversationId)?.agentId || '');
  const agent = agentDefinition(agentId);
  const model = String(payload.model || settingsStore.agentPreferredTextModel || '');
  const message = String(payload.message || '').trim();
  assertAgentProject(projectKey, projectIdentity.instanceId, projectIdentity.generation);

  const emitEvent = (event: JsonObject & { type: string }) => {
    // 每条事件都带本轮身份；循环内部还会按 run 覆盖成子 Agent 的 agentId/agentSessionId。
    const runtimeEvent = {
      agentId, agentSessionId: requestId, ...event, requestId, sessionId: conversationId,
    } as AgentRuntimeEvent;
    appendAgentRuntimeEvent(requestId, conversationId, runtimeEvent, projectKey);
    onEvent(runtimeEvent);
  };
  // 卡住检测只认事件出口的动静：任何事件（包括子 Agent 的）都算活着。
  // 提示本身必须走原始出口，若它也重置静默计时，就永远到不了长时运行分类。
  const watchdog = createStallWatchdog({
    stalled: (silent) => emitEvent({
      type: 'session_stalled', stalled: true, ...silent, createdAt: new Date().toISOString(),
    }),
    recovered: () => emitEvent({ type: 'session_stalled', stalled: false, createdAt: new Date().toISOString() }),
  });
  const emit = (event: JsonObject & { type: string }) => {
    emitEvent(event);
    watchdog.activity();
  };
  const noteRecoveryState = (finished: boolean) => {
    void invoke('recovery_update_activity', {
      runtimeState: finished ? 'ready' : 'running',
      activeRunId: finished ? '' : requestId,
      activeProjectKey: finished ? '' : projectKey,
      lastError: '',
    }).catch(() => undefined);
  };

  const state = new Map<string, unknown>();
  const continuation = payload.continuation as JsonObject | undefined;
  const restoredReceipts = new Map<string, AgentToolReceipt>();
  for (const receipt of (continuation?.toolReceipts as AgentToolReceipt[] | undefined) || []) {
    if (receipt?.callId) restoredReceipts.set(receipt.callId, receipt);
  }
  state.set('successfulToolCallIds', new Set<string>(
    ((continuation?.successfulToolCallIds as string[] | undefined) || []).map(String),
  ));
  state.set('toolReceipts', restoredReceipts);
  if (continuation?.hasAppliedActions === true) state.set('hasAppliedActions', true);
  if (continuation?.activeProductionPlanId) state.set('activeProductionPlanId', String(continuation.activeProductionPlanId));
  state.set('expectedCanvasFingerprint', canvasMutationFingerprint(store.project));

  const toolContext: AgentToolContext = {
    requestId, turnId: `${requestId}:root`, projectKey,
    projectInstanceId: projectIdentity.instanceId,
    projectGeneration: projectIdentity.generation,
    conversationId, agentId, agentSessionId: requestId,
    signal: controller.signal, loadedSkillIds: new Set<string>(),
    attachments: payload.attachments || [],
    capabilities: { nodeExecution: settingsStore.agentCanRunNodes === true }, state, emit,
  };

  let plan: LoopModelPlan;
  try {
    registerDefaultAgentTools();
    plan = resolveLoopModelPlan(model);
  } catch (cause) {
    const diagnosis = diagnoseRuntimeFailure(cause);
    emit({ type: 'run_status', status: 'failed', error: diagnosis.message, diagnosis, createdAt: new Date().toISOString() });
    throw new RuntimeDiagnosticError(diagnosis);
  }

  activeLoopRuns.set(requestId, controller);
  emit({
    type: 'run_started', runtime: 'loop', mode: 'standard', title: message.slice(0, 80) || 'Agent 任务',
    conversationId, model, createdAt: new Date().toISOString(),
  });
  emit({ type: 'run_status', status: 'running', createdAt: new Date().toISOString() });
  noteRecoveryState(false);
  watchdog.start();

  let transcript: ChatMessage[] = loadConversationTranscript(conversationId);
  const commitTranscript = (messages: ChatMessage[]) => {
    transcript = messages;
    saveConversationTranscript(conversationId, messages);
  };

  try {
    const contextBlock = buildRunContextBlock({
      nodeMentions: payload.nodeMentions,
      attachments: payload.attachments,
      planSummary: activeProductionPlanSummary(conversationId),
    });
    const messages = [...transcript, await userMessage([message, contextBlock].filter(Boolean).join('\n\n'), payload.attachments || [])];
    const systemPrompt = buildAgentSystemPrompt(toolContext, LOOP_RUNTIME_MODEL_CONTRACT);
    const result = await runAgentLoop({
      agent,
      context: toolContext,
      plan,
      systemPrompt,
      messages,
      callModel: createModelCaller(controller.signal),
      emit,
      onMessagesChanged: commitTranscript,
    });
    let outcome = state.get('verifiedOutcome') as JsonObject | undefined;
    const reply = result.reply || String(outcome?.summary || '');
    if (state.get('hasAppliedActions') === true && !outcome) {
      const receipts = state.get('toolReceipts') as Map<string, AgentToolReceipt>;
      outcome = {
        status: 'partial',
        summary: reply || '项目操作已经执行，但 Agent 没有提交完整终态说明。',
        evidence: { toolCallIds: [...receipts.values()].filter((receipt) => receipt.applied).map((receipt) => receipt.callId) },
        remaining: ['需要根据当前画布和任务状态补充最终核验'],
      };
    }
    const outcomeStatus = String(outcome?.status || 'completed');
    const runStatus = outcomeStatus === 'partial' || outcomeStatus === 'blocked' ? outcomeStatus : 'completed';
    emit({ type: 'run_status', status: runStatus, outcome, createdAt: new Date().toISOString() });
    return {
      requestId,
      reply,
      model,
      toolCallCount: (state.get('successfulToolCallIds') as Set<string>).size,
      outcome,
    };
  } catch (cause) {
    const aborted = controller.signal.aborted || (cause instanceof Error && cause.name === 'AbortError');
    if (aborted) {
      emit({ type: 'run_status', status: 'cancelled', error: cause instanceof Error ? cause.message : String(cause), createdAt: new Date().toISOString() });
      throw cause;
    }
    const diagnosis = diagnoseRuntimeFailure(cause);
    emit({ type: 'run_status', status: 'failed', error: diagnosis.message, diagnosis, createdAt: new Date().toISOString() });
    throw new RuntimeDiagnosticError(diagnosis);
  } finally {
    watchdog.stop();
    // 中断可能停在 tool_calls 与工具结果之间；落盘的历史必须仍然对 provider 合法，
    // 并且明确写出"这次调用没有执行"，模型下一轮才不会把未执行的调用当成已完成。
    commitTranscript(closeDanglingToolCalls(transcript, INTERRUPTED_TOOL_NOTE));
    controller.abort();
    activeLoopRuns.delete(requestId);
    noteRecoveryState(true);
  }
}

export async function abortLoopAgent(requestId: string): Promise<boolean> {
  const controller = activeLoopRuns.get(requestId);
  if (!controller) return false;
  controller.abort();
  return true;
}
