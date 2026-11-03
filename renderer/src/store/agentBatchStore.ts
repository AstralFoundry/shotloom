import { t } from '../i18n/index.ts';
import { isActiveTaskStatus, isFailedTaskStatus, isTerminalTaskStatus } from '@/domain/tasks/TaskStatus';
import { uid } from '@/utils/format';

type MutableProject = Record<string, any>;
type AgentBatch = Record<string, any>;

const MAX_AGENT_BATCHES = 12;

function ensureAgentBatches(project: MutableProject): AgentBatch[] {
  if (!Array.isArray(project.agentBatches)) project.agentBatches = [];
  return project.agentBatches;
}

function taskCounts(project: MutableProject, batch: AgentBatch) {
  const taskIds = new Set<string>(batch.startedTaskIds || []);
  const tasks = (project.tasks || []).filter((task: any) => taskIds.has(task.id));
  return {
    total: tasks.length,
    running: tasks.filter((task: any) => isActiveTaskStatus(task.status)).length,
    completed: tasks.filter((task: any) => task.status === 'completed').length,
    failed: tasks.filter((task: any) => isFailedTaskStatus(task.status)).length,
    cancelled: tasks.filter((task: any) => task.status === 'cancelled').length,
    terminal: tasks.filter((task: any) => isTerminalTaskStatus(task.status)).length,
  };
}

export function summarizeAgentBatch(project: MutableProject, batch: AgentBatch): AgentBatch {
  const counts = taskCounts(project, batch);
  let status = batch.status || 'applied';
  if (batch.undoneAt) status = 'undone';
  else if (counts.total && counts.running) status = 'running';
  else if (counts.total && counts.failed) status = 'failed';
  else if (counts.total && counts.cancelled === counts.total) status = 'cancelled';
  else if (counts.total && counts.terminal === counts.total) status = 'completed';
  return {
    ...batch,
    status,
    taskCounts: counts,
  };
}

export function listAgentBatches(project: MutableProject): AgentBatch[] {
  return ensureAgentBatches(project)
    .map((batch) => summarizeAgentBatch(project, batch))
    .sort((a, b) => Date.parse(b.createdAt || '') - Date.parse(a.createdAt || ''));
}

export function findAgentBatch(project: MutableProject, batchId: string): AgentBatch | null {
  const batch = ensureAgentBatches(project).find((item) => item.id === batchId || item.batchId === batchId);
  return batch ? summarizeAgentBatch(project, batch) : null;
}

export function recordAgentBatch(project: MutableProject, payload: AgentBatch = {}): AgentBatch {
  const batches = ensureAgentBatches(project);
  const id = payload.batchId || uid();
  const now = new Date().toISOString();
  const batch = {
    id,
    batchId: id,
    type: 'agent-batch',
    title: payload.title || t("ui.agentBatchStore.text.9ea96d4e"),
    source: payload.source || 'external-agent',
    createdNodeIds: [...(payload.createdNodeIds || [])],
    changedNodeIds: [...(payload.changedNodeIds || [])],
    startedTaskIds: [...(payload.startedTaskIds || [])],
    actionResults: payload.actionResults || [],
    summary: payload.summary || {},
    projectKey: payload.projectKey || '',
    createdAt: now,
    updatedAt: now,
    status: payload.status || 'applied',
  };
  batches.unshift(batch);
  batches.splice(MAX_AGENT_BATCHES);
  return summarizeAgentBatch(project, batch);
}
