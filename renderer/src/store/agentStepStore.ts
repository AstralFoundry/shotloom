import { uid } from '@/utils/format';
import { canvasMutationFingerprint } from '@/utils/canvasMutationFingerprint.mjs';

export { canvasMutationFingerprint } from '@/utils/canvasMutationFingerprint.mjs';

type MutableProject = Record<string, any>;
type AgentStep = Record<string, any>;
type StepMutationResult = { ok: boolean; error?: string; step?: AgentStep };

const MAX_AGENT_STEPS = 50;

function ensureAgentSteps(project: MutableProject): AgentStep[] {
  if (!Array.isArray(project.agentSteps)) project.agentSteps = [];
  return project.agentSteps;
}

export function listAgentSteps(project: MutableProject, status = ''): AgentStep[] {
  return ensureAgentSteps(project)
    .filter((step) => !status || step.status === status)
    .sort((a, b) => Date.parse(b.createdAt || '') - Date.parse(a.createdAt || ''));
}

export function findAgentStep(project: MutableProject, stepId: string): AgentStep | null {
  return ensureAgentSteps(project).find((step) => step.id === stepId || step.stepId === stepId) || null;
}

export function createPendingAgentStep(project: MutableProject, request: Record<string, any> = {}): AgentStep {
  const steps = ensureAgentSteps(project);
  const id = request.stepId || uid();
  const now = new Date().toISOString();
  const actions = Array.isArray(request.actions) ? request.actions : [];
  const step = {
    id,
    stepId: id,
    type: 'agent-step-confirmation',
    title: request.title || request.name || 'Agent 操作确认',
    source: request.source || 'external-agent',
    conversationId: String(request.conversationId || ''),
    runId: String(request.runId || ''),
    status: 'pending',
    actionCount: actions.length,
    canvasFingerprint: canvasMutationFingerprint(project),
    request: {
      ...request,
      confirmed: true,
      requireConfirmation: false,
    },
    createdAt: now,
    updatedAt: now,
  };
  steps.unshift(step);
  steps.splice(MAX_AGENT_STEPS);
  return step;
}

export function markAgentStep(project: MutableProject, stepId: string, status: string, patch: AgentStep = {}): StepMutationResult {
  const step = findAgentStep(project, stepId);
  if (!step) return { ok: false, error: '确认步骤不存在' };
  if (step.status !== 'pending') return { ok: false, error: '确认步骤已处理', step };
  Object.assign(step, patch, {
    status,
    updatedAt: new Date().toISOString(),
  });
  return { ok: true, step };
}

export function claimAgentStep(project: MutableProject, stepId: string): StepMutationResult {
  const step = findAgentStep(project, stepId);
  if (!step) return { ok: false, error: '确认步骤不存在' };
  if (step.status !== 'pending') return { ok: false, error: '确认步骤已处理或正在执行', step };
  step.status = 'executing';
  step.executingAt = new Date().toISOString();
  step.updatedAt = step.executingAt;
  return { ok: true, step };
}

export function completeClaimedAgentStep(project: MutableProject, stepId: string, status: string, patch: AgentStep = {}): StepMutationResult {
  const step = findAgentStep(project, stepId);
  if (!step) return { ok: false, error: '确认步骤不存在' };
  if (step.status !== 'executing') return { ok: false, error: '确认步骤不在执行中', step };
  Object.assign(step, patch, {
    status,
    updatedAt: new Date().toISOString(),
  });
  return { ok: true, step };
}
