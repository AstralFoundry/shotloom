export interface AgentClarificationAnswer {
  answers: Array<{ questionId: string; values: string[] }>;
  skipped: boolean;
}

export interface AgentApprovalResolution {
  approved: boolean;
  result?: unknown;
  error?: string;
}

interface PendingInteraction<T> {
  resolve: (value: T) => void;
  reject: (cause: Error) => void;
  cleanup: () => void;
}

const pendingClarifications = new Map<string, PendingInteraction<AgentClarificationAnswer>>();
const pendingApprovals = new Map<string, PendingInteraction<AgentApprovalResolution>>();

export function hasPendingAgentClarification(interactionId: string): boolean {
  return pendingClarifications.has(interactionId);
}

function waitForInteraction<T>(
  registry: Map<string, PendingInteraction<T>>,
  key: string,
  signal: AbortSignal,
  replacedMessage: string,
): Promise<T> {
  const previous = registry.get(key);
  if (previous) {
    previous.cleanup();
    previous.reject(new Error(replacedMessage));
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      registry.delete(key);
      reject(new DOMException('Agent run aborted', 'AbortError'));
    };
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    registry.set(key, { resolve, reject, cleanup });
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function resolveInteraction<T>(
  registry: Map<string, PendingInteraction<T>>,
  key: string,
  value: T,
): boolean {
  const pending = registry.get(key);
  if (!pending) return false;
  registry.delete(key);
  pending.cleanup();
  pending.resolve(value);
  return true;
}

function rejectInteraction<T>(
  registry: Map<string, PendingInteraction<T>>,
  key: string,
  message: string,
): boolean {
  const pending = registry.get(key);
  if (!pending) return false;
  registry.delete(key);
  pending.cleanup();
  pending.reject(new Error(message));
  return true;
}

export function expirePendingAgentClarification(interactionId: string): boolean {
  return rejectInteraction(pendingClarifications, interactionId, '等待用户回答已过期');
}

export function waitForAgentClarification(interactionId: string, signal: AbortSignal): Promise<AgentClarificationAnswer> {
  return waitForInteraction(
    pendingClarifications,
    interactionId,
    signal,
    '新的澄清问题已替换上一个未回答问题',
  );
}

export function submitAgentClarification(
  interactionId: string,
  answers: Array<{ questionId: string; values: string[] }>,
  skipped = false,
): boolean {
  const normalized = (Array.isArray(answers) ? answers : []).map((answer) => ({
    questionId: String(answer.questionId || '').trim(),
    values: [...new Set((answer.values || []).map((value) => String(value || '').trim()).filter(Boolean))],
  })).filter((answer) => answer.questionId && answer.values.length);
  if (!skipped && !normalized.length) return false;
  return resolveInteraction(pendingClarifications, interactionId, { answers: normalized, skipped });
}

function approvalKey(runId: string, stepId: string): string {
  return `${runId}\0${stepId}`;
}

export function hasPendingAgentApproval(runId: string, stepId: string): boolean {
  return pendingApprovals.has(approvalKey(runId, stepId));
}

export function expirePendingAgentApproval(runId: string, stepId: string): boolean {
  return rejectInteraction(pendingApprovals, approvalKey(runId, stepId), '等待用户确认已过期');
}

export function waitForAgentApproval(
  runId: string,
  stepId: string,
  signal: AbortSignal,
): Promise<AgentApprovalResolution> {
  return waitForInteraction(
    pendingApprovals,
    approvalKey(runId, stepId),
    signal,
    '新的工具确认已替换上一个未处理确认',
  );
}

export function submitAgentApproval(
  runId: string,
  stepId: string,
  resolution: AgentApprovalResolution,
): boolean {
  return resolveInteraction(pendingApprovals, approvalKey(runId, stepId), resolution);
}
