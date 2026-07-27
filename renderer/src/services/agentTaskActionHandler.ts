import {
  failedTaskStatuses,
  findLatestTaskForNode,
  runNode,
} from '@/store/taskStore';
import type { AgentAction, AgentActionResult } from './agentTypes';

type TaskAction = AgentAction & Record<string, any>;
type TaskActionContext = Record<string, any>;

const TASK_ACTIONS = new Set(['start_generation']);

function normalizedInteger(value: unknown, fallback: number): number {
  const next = Number(value);
  return Number.isFinite(next) && next >= 0 ? Math.round(next) : fallback;
}

export async function handleAgentTaskAction(
  action: TaskAction,
  { resolveNode }: TaskActionContext,
): Promise<AgentActionResult | null> {
  const type = action?.type;
  if (!TASK_ACTIONS.has(type)) return null;

  if (type === 'start_generation') {
    const node = resolveNode(action.nodeId);
    if (!node) return { applied: false };
    const currentStatus = node.status || 'idle';
    if (currentStatus === 'running') return { applied: false };
    if (currentStatus === 'completed' && action.force !== true) return { applied: false };
    const latestTask: any = findLatestTaskForNode(node.id);
    const nextRetryCount = failedTaskStatuses.has(currentStatus)
      ? Number(latestTask?.retryCount || node.retryCount || 0) + 1 : 0;
    const maxRetries = normalizedInteger(latestTask?.maxRetries ?? node.maxRetries, 2);
    if (failedTaskStatuses.has(currentStatus) && nextRetryCount > maxRetries) return { applied: false };
    let task: any = runNode(node, { onlyRetryFailed: action.force !== true, retryCount: nextRetryCount });
    if (!task) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      task = runNode(node, { onlyRetryFailed: action.force !== true, retryCount: nextRetryCount });
    }
    return { applied: Boolean(task), nodeId: node.id, taskId: task?.id || null };
  }
  return null;
}

// ── 自注册到 ActionRegistry ────────────────────────────────────────────────
