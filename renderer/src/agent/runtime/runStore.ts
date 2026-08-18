import type { JsonObject } from '../core/types';
import type { AgentToolReceipt } from '../core/types';
import { assertAgentProject, getAgentProjectKey } from '@/services/agentProjectIdentity';
import { store, touchProject } from '@/store/projectStore';
import {
  expirePendingAgentApproval,
  expirePendingAgentClarification,
} from './runtimeInteractions';

export interface AgentRunContinuation extends JsonObject {
  toolCallId: string;
  toolName: string;
  model: string;
  conversationId: string;
  sessionMessages: JsonObject[];
  attachments: JsonObject[];
  nodeMentions: JsonObject[];
  successfulToolCallIds: string[];
  toolReceipts: AgentToolReceipt[];
  hasAppliedActions: boolean;
  activeProductionPlanId?: string;
  lastActionError: string;
  modelRounds: number;
}

export interface AgentRun extends JsonObject {
  id: string;
  status: string;
  conversationId?: string;
  projectKey?: string;
  modelRounds?: number;
  toolCallCount?: number;
  steps?: JsonObject[];
  pendingReasons?: JsonObject[];
  createdAt?: string;
  updatedAt?: string;
}

export type AgentInteractionKind = 'question' | 'tool_confirmation';
export type AgentInteractionStatus = 'pending' | 'resolved' | 'expired';

export interface AgentInteraction extends JsonObject {
  id: string;
  runId: string;
  conversationId: string;
  projectKey: string;
  kind: AgentInteractionKind;
  status: AgentInteractionStatus;
  payload: JsonObject;
  continuation: AgentRunContinuation;
  resolution?: JsonObject;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface CreateAgentInteractionInput {
  id: string;
  runId: string;
  conversationId: string;
  projectKey: string;
  kind: AgentInteractionKind;
  payload: JsonObject;
  continuation: AgentRunContinuation;
  expiresAt: string;
}

interface ProjectableRuntimeEvent extends JsonObject {
  type: string;
  requestId?: string;
  createdAt?: string;
}

function upsertStep(steps: JsonObject[], id: string, patch: JsonObject): JsonObject[] {
  const index = steps.findIndex((step) => String(step.id || '') === id);
  if (index < 0) return [...steps, { id, ...patch }];
  return steps.map((step, stepIndex) => stepIndex === index ? { ...step, ...patch } : step);
}

function projectAgentRun(
  current: AgentRun | undefined,
  event: ProjectableRuntimeEvent,
  projectKey: string,
): AgentRun {
  const now = String(event.createdAt || new Date().toISOString());
  const run: AgentRun = current
    ? { ...current }
    : {
        id: String(event.requestId || ''), runtime: 'opencode', status: 'running',
        projectKey, createdAt: now, steps: [], pendingReasons: [],
      };
  const steps = Array.isArray(run.steps) ? run.steps : [];

  switch (event.type) {
    case 'run_started':
      Object.assign(run, {
        runtime: 'opencode', status: 'running',
        title: String(event.title || 'Agent 任务'), conversationId: String(event.conversationId || ''),
        model: String(event.model || ''), modelRounds: Number(event.modelRounds || 0),
        openCodeSessionId: String(event.openCodeSessionId || ''),
        toolCallCount: Number(event.toolCallCount || 0), budget: event.budget || {},
        contextUsage: event.contextUsage || {}, steps: Array.isArray(event.steps) ? event.steps : [],
        pendingReasons: [], error: '',
      });
      break;
    case 'subagent_started': {
      const children = Array.isArray(run.children) ? run.children as JsonObject[] : [];
      run.children = upsertStep(children, String(event.childSessionId || ''), {
        title: String(event.title || '子任务'), status: 'running', startedAt: now,
      });
      break;
    }
    case 'subagent_completed':
    case 'subagent_failed': {
      const children = Array.isArray(run.children) ? run.children as JsonObject[] : [];
      run.children = upsertStep(children, String(event.childSessionId || ''), {
        status: event.type === 'subagent_completed' ? 'completed' : 'failed',
        error: String(event.error || ''), endedAt: now,
      });
      break;
    }
    case 'turn_start':
      Object.assign(run, { status: 'running', modelRounds: Number(event.turn || run.modelRounds || 0) });
      break;
    case 'context_usage':
      run.contextUsage = {
        estimatedTokens: Number(event.estimatedTokens || 0), inputLimit: Number(event.inputLimit || 0),
        inputBudget: Number(event.inputBudget || 0), outputReserve: Number(event.outputReserve || 0),
        ratio: Number(event.ratio || 0), includedHistoryCount: Number(event.includedHistoryCount || 0),
        droppedHistoryCount: Number(event.droppedHistoryCount || 0),
        compactedCurrentToolGroups: Number(event.compactedCurrentToolGroups || 0),
      };
      break;
    case 'tool_start': {
      const toolCallId = String(event.toolCallId || '');
      run.status = 'waiting_tool';
      run.toolCallCount = steps.some((step) => String(step.id || '') === toolCallId)
        ? Number(run.toolCallCount || 0) : Number(run.toolCallCount || 0) + 1;
      if (toolCallId) {
        run.steps = upsertStep(steps, toolCallId, {
          turnId: event.turnId, toolName: event.toolName, effect: event.effect,
          inputSummary: event.inputSummary, status: 'running', startedAt: event.startedAt || now,
        });
      }
      break;
    }
    case 'clarification_required':
      run.status = 'waiting_user';
      run.pendingReasons = [{
        id: String(event.interactionId || `question:${String(event.toolCallId || event.requestId || '')}`),
        kind: 'question', interactionId: event.interactionId, toolCallId: event.toolCallId, createdAt: now,
      }];
      break;
    case 'clarification_resolved':
      run.status = 'running';
      run.pendingReasons = [];
      break;
    case 'interaction_requested':
      if (event.kind === 'tool_confirmation') {
        run.status = 'waiting_approval';
        run.pendingReasons = [{
          id: `approval:${String(event.stepId || '')}`, kind: 'tool_confirmation',
          interactionId: event.interactionId, toolCallId: event.toolCallId, stepId: event.stepId, createdAt: now,
        }];
      }
      break;
    case 'interaction_resolved':
      run.status = 'running';
      run.pendingReasons = [];
      break;
    case 'tool_end': {
      const toolCallId = String(event.toolCallId || '');
      run.status = event.waitingFor === 'user_input' ? 'waiting_user' : 'running';
      run.toolCallCount = Math.max(Number(event.toolCallCount || 0), Number(run.toolCallCount || 0));
      run.pendingReasons = [];
      if (toolCallId) {
        run.steps = upsertStep(steps, toolCallId, {
          status: event.isError ? 'failed' : 'succeeded', pending: false,
          error: String(event.error || ''), receipt: event.receipt, endedAt: event.endedAt || now,
        });
      }
      break;
    }
    case 'run_status':
      run.status = String(event.status || run.status);
      run.toolCallCount = Number(event.toolCallCount || run.toolCallCount || 0);
      run.error = String(event.error || '');
      if (event.diagnosis) run.diagnosis = event.diagnosis;
      if (event.outcome) run.outcome = event.outcome;
      if (['completed', 'failed', 'cancelled', 'blocked'].includes(run.status)) {
        run.pendingReasons = [];
        run.completedAt = now;
      }
      break;
    case 'session_stalled':
      if (event.stalled === false) {
        if (run.status === 'stalled') run.status = 'running';
        delete run.stall;
      } else {
        run.status = 'stalled';
        run.stall = {
          silentMs: Number(event.silentMs || 0),
          watchdog: String(event.watchdog || 'no_progress'),
          detectedAt: now,
        };
      }
      break;
  }
  return { ...run, id: String(event.requestId || run.id), projectKey, updatedAt: now };
}

export interface StoredAgentRuntimeEvent extends JsonObject {
  id: string;
  runId: string;
  sessionId: string;
  sequence: number;
  type: string;
  createdAt: string;
}

const MAX_RUNS = 100;
const MAX_EVENTS = 2_000;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function projectRuns(): AgentRun[] {
  if (!Array.isArray(store.project.agentRuns)) store.project.agentRuns = [];
  return store.project.agentRuns as AgentRun[];
}

function projectEvents(): StoredAgentRuntimeEvent[] {
  if (!Array.isArray(store.project.agentRuntimeEvents)) store.project.agentRuntimeEvents = [];
  return store.project.agentRuntimeEvents as StoredAgentRuntimeEvent[];
}

function projectInteractions(): AgentInteraction[] {
  if (!Array.isArray(store.project.agentInteractions)) store.project.agentInteractions = [];
  return store.project.agentInteractions as AgentInteraction[];
}

export function listAgentRuns(): AgentRun[] {
  const projectKey = getAgentProjectKey();
  return clone(projectRuns().filter((run) => !run.projectKey || run.projectKey === projectKey));
}

export function getAgentRun(runId: string): AgentRun | undefined {
  const projectKey = getAgentProjectKey();
  return projectRuns().find((run) => run.id === runId && (!run.projectKey || run.projectKey === projectKey));
}

export function createAgentInteraction(
  input: CreateAgentInteractionInput,
): AgentInteraction {
  assertAgentProject(input.projectKey);
  const interactions = projectInteractions();
  const existing = interactions.find((item) => item.id === input.id);
  if (existing?.status === 'pending') return clone(existing);
  const now = new Date().toISOString();
  const interaction: AgentInteraction = {
    ...clone(input),
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };
  if (existing) Object.assign(existing, interaction);
  else interactions.unshift(interaction);
  if (interactions.length > 200) interactions.splice(200);
  touchProject({ sessionDelay: 0, coalesceSession: false });
  return clone(interaction);
}

export function getAgentInteraction(interactionId: string): AgentInteraction | undefined {
  expireAgentInteractions();
  const projectKey = getAgentProjectKey();
  const interaction = projectInteractions().find((item) =>
    item.id === interactionId && (!item.projectKey || item.projectKey === projectKey));
  return interaction ? clone(interaction) : undefined;
}

export function resolveAgentInteraction(interactionId: string, resolution: JsonObject): AgentInteraction {
  expireAgentInteractions();
  const interaction = projectInteractions().find((item) => item.id === interactionId);
  if (!interaction) throw new Error('这个 Agent 交互已经不存在');
  if (interaction.status === 'expired') throw new Error('这个 Agent 交互已经过期，请重新发起任务');
  if (interaction.status !== 'pending') return clone(interaction);
  Object.assign(interaction, {
    status: 'resolved',
    resolution: clone(resolution),
    updatedAt: new Date().toISOString(),
  });
  touchProject({ sessionDelay: 0, coalesceSession: false });
  return clone(interaction);
}

export function listAgentInteractions(options: { pendingOnly?: boolean } = {}): AgentInteraction[] {
  expireAgentInteractions();
  const projectKey = getAgentProjectKey();
  return clone(projectInteractions().filter((item) =>
    (!item.projectKey || item.projectKey === projectKey) && (!options.pendingOnly || item.status === 'pending')));
}

export function expireAgentInteractions(now = Date.now()): number {
  const expired = projectInteractions().filter((item) =>
    item.status === 'pending' && Date.parse(item.expiresAt) <= now);
  if (!expired.length) return 0;
  const updatedAt = new Date(now).toISOString();
  for (const interaction of expired) {
    interaction.status = 'expired';
    interaction.updatedAt = updatedAt;
    interaction.resolution = { error: '等待用户处理已过期' };
    if (interaction.kind === 'question') expirePendingAgentClarification(interaction.id);
    else expirePendingAgentApproval(interaction.runId, String(interaction.payload.stepId || ''));
    appendAgentRuntimeEvent(interaction.runId, interaction.conversationId, {
      type: 'run_status', status: 'blocked', error: '等待用户处理已过期', createdAt: updatedAt,
    }, interaction.projectKey);
  }
  touchProject({ sessionDelay: 0, coalesceSession: false });
  return expired.length;
}

export function getAgentRuntimeHealth() {
  const interactions = listAgentInteractions({ pendingOnly: true });
  const activeRuns = listAgentRuns().filter((run) =>
    !['completed', 'failed', 'cancelled', 'blocked', 'partial'].includes(run.status));
  const activeTasks = ((store.project.tasks as JsonObject[] | undefined) || []).filter((task) =>
    ['queued', 'running', 'pending'].includes(String(task.status || '')));
  const blockingReasons = [
    ...(activeRuns.length ? [`${activeRuns.length} 个 Agent 运行尚未结束`] : []),
    ...(interactions.length ? [`${interactions.length} 个问题或操作等待处理`] : []),
    ...(activeTasks.length ? [`${activeTasks.length} 个生成任务仍在运行`] : []),
  ];
  return {
    safeToClose: blockingReasons.length === 0,
    activeRunCount: activeRuns.length,
    pendingInteractionCount: interactions.length,
    activeTaskCount: activeTasks.length,
    blockingReasons,
  };
}

export function recoverInterruptedAgentRuns(previousRunId = ''): number {
  const recoverableStatuses = new Set(['running', 'waiting_tool']);
  const now = new Date().toISOString();
  let recovered = 0;
  for (const run of projectRuns()) {
    if (!recoverableStatuses.has(run.status)) continue;
    if (previousRunId && run.id !== previousRunId) continue;
    run.status = 'failed';
    run.error = 'Shotloom 上次未正常退出，本次运行未被自动重放，以避免重复写入或重复生成';
    run.completedAt = now;
    run.updatedAt = now;
    run.pendingReasons = [];
    recovered += 1;
  }
  if (recovered) touchProject({ sessionDelay: 0, coalesceSession: false });
  return recovered;
}

export function relieveAgentHistoryMemoryPressure(level: 'low' | 'critical'): JsonObject {
  const eventLimit = level === 'critical' ? 250 : 750;
  const runLimit = level === 'critical' ? 25 : 50;
  const events = projectEvents();
  const runs = projectRuns();
  const removedEvents = Math.max(0, events.length - eventLimit);
  const removedRuns = Math.max(0, runs.length - runLimit);
  if (removedEvents) events.splice(eventLimit);
  if (removedRuns) runs.splice(runLimit);
  const canvasHistory = Array.isArray(store.project.canvasHistory) ? store.project.canvasHistory : [];
  const redoHistory = Array.isArray(store.project.canvasRedoStack) ? store.project.canvasRedoStack : [];
  const historyLimit = level === 'critical' ? 1 : 3;
  const removedHistory = Math.max(0, canvasHistory.length - historyLimit)
    + Math.max(0, redoHistory.length - historyLimit);
  if (canvasHistory.length > historyLimit) canvasHistory.splice(0, canvasHistory.length - historyLimit);
  if (redoHistory.length > historyLimit) redoHistory.splice(0, redoHistory.length - historyLimit);
  if (removedEvents || removedRuns || removedHistory) touchProject({ sessionDelay: 0, coalesceSession: false });
  return { level, removedEvents, removedRuns, removedHistory };
}

export function appendAgentRuntimeEvent(
  runId: string,
  sessionId: string,
  event: JsonObject & { type: string },
  projectKey = getAgentProjectKey(),
): StoredAgentRuntimeEvent {
  assertAgentProject(projectKey);
  const events = projectEvents();
  const previousSequence = events.find((item) => item.runId === runId)?.sequence || 0;
  const stored: StoredAgentRuntimeEvent = {
    ...clone(event),
    id: `${runId}:event:${previousSequence + 1}`,
    runId,
    sessionId,
    sequence: previousSequence + 1,
    type: event.type,
    createdAt: String(event.createdAt || new Date().toISOString()),
  };
  events.unshift(stored);
  if (events.length > MAX_EVENTS) events.splice(MAX_EVENTS);
  const runs = projectRuns();
  const current = runs.find((run) => run.id === runId && run.projectKey === projectKey);
  const projected = projectAgentRun(current, stored, projectKey);
  if (current) Object.assign(current, projected);
  else runs.unshift(projected);
  if (runs.length > MAX_RUNS) runs.splice(MAX_RUNS);
  touchProject({ sessionDelay: 250, coalesceSession: true });
  return clone(stored);
}

export function listAgentRuntimeEvents(runId: string): StoredAgentRuntimeEvent[] {
  return clone(projectEvents()
    .filter((event) => event.runId === runId)
    .sort((left, right) => left.sequence - right.sequence));
}
