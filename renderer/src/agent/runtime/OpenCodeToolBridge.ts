import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { assertAgentProject } from '@/services/agentProjectIdentity';
import { registerDefaultAgentTools } from '../tools/registerDefaultTools';
import { listAgentTools, prepareAgentToolCall } from '../core/toolRegistry';
import { resolveAgentToolPolicy } from '../core/policyEngine';
import type { AgentToolContext, AgentToolReceipt, JsonObject } from '../core/types';
import { createAgentInteraction } from './runStore';
import { waitForAgentApproval } from './runtimeInteractions';
import { buildToolReceipt, receiptChangesProject } from './toolReceipts';

interface BridgeRun {
  context: AgentToolContext;
  model: string;
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

async function executeRequest(payload: { callId: string; name: string; arguments?: JsonObject }) {
  const run = activeRun;
  if (!run) throw new Error('Shotloom tool bridge has no active Agent run');
  const context: AgentToolContext = {
    ...run.context,
    turnId: `${run.context.requestId}:tool:${payload.callId}`,
  };
  assertAgentProject(context.projectKey);
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
    let result: any = await prepared.definition.execute(prepared.input, context);
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
    return result;
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
  unlisten = await listen<{ callId: string; name: string; arguments?: JsonObject }>('agent-tool-request', async ({ payload }) => {
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
  activeRun = run;
  await ensureListener();
  const tools = listAgentTools(run.context).map((tool) => ({
    name: tool.id,
    description: tool.description,
    inputSchema: tool.resolveInputSchema?.(run.context) || tool.inputSchema,
  }));
  await invoke('agent_runtime_register_tools', { tools });
}

export function deactivateOpenCodeToolBridge(requestId: string) {
  if (activeRun?.context.requestId === requestId) activeRun = null;
}
