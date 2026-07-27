import { uid } from '@/utils/format';

type MutableProject = Record<string, any>;
type AgentBatch = Record<string, any>;

const terminalStatuses = new Set(['completed', 'failed', 'timeout', 'cancelled', 'error']);
const MAX_AGENT_BATCHES = 12;
const batchSnapshots = new Map<string, {
  beforeNodes: any[]; beforeEdges: any[]; afterNodes: any[]; afterEdges: any[];
}>();

function ensureAgentBatches(project: MutableProject): AgentBatch[] {
  if (!Array.isArray(project.agentBatches)) project.agentBatches = [];
  return project.agentBatches;
}

function taskCounts(project: MutableProject, batch: AgentBatch) {
  const taskIds = new Set<string>(batch.startedTaskIds || []);
  const tasks = (project.tasks || []).filter((task: any) => taskIds.has(task.id));
  return {
    total: tasks.length,
    running: tasks.filter((task: any) => ['running', 'queued'].includes(task.status)).length,
    completed: tasks.filter((task: any) => task.status === 'completed').length,
    failed: tasks.filter((task: any) => ['failed', 'timeout', 'error'].includes(task.status)).length,
    cancelled: tasks.filter((task: any) => task.status === 'cancelled').length,
    terminal: tasks.filter((task: any) => terminalStatuses.has(task.status)).length,
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
  const {
    beforeNodes: _beforeNodes,
    beforeEdges: _beforeEdges,
    afterNodes: _afterNodes,
    afterEdges: _afterEdges,
    ...publicBatch
  } = batch;
  return {
    ...publicBatch,
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
    title: payload.title || 'Agent 批量操作',
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
  batchSnapshots.set(id, {
    beforeNodes: payload.beforeNodes || [], beforeEdges: payload.beforeEdges || [],
    afterNodes: payload.afterNodes || [], afterEdges: payload.afterEdges || [],
  });
  batches.unshift(batch);
  const removed = batches.splice(MAX_AGENT_BATCHES);
  removed.forEach((item) => batchSnapshots.delete(String(item.id || item.batchId || '')));
  return summarizeAgentBatch(project, batch);
}

export function undoAgentBatch(project: MutableProject, batchId: string, options: { cancelTask?: (taskId: string) => unknown } = {}) {
  const batch = ensureAgentBatches(project).find((item) => item.id === batchId || item.batchId === batchId);
  if (!batch || batch.undoneAt) return { ok: false, error: batch ? '批次已撤销' : '批次不存在' };
  const snapshot = batchSnapshots.get(String(batch.id || batch.batchId || ''));
  if (!snapshot) {
    return { ok: false, error: '批次缺少可撤销快照' };
  }
  const currentState = JSON.stringify({ nodes: project.nodes || [], edges: project.edges || [] });
  const expectedState = JSON.stringify({ nodes: snapshot.afterNodes, edges: snapshot.afterEdges });
  if (currentState !== expectedState) {
    return { ok: false, error: '该批次之后画布已有其他修改，无法安全撤销' };
  }

  for (const taskId of batch.startedTaskIds || []) options.cancelTask?.(taskId);
  project.nodes = JSON.parse(JSON.stringify(snapshot.beforeNodes));
  project.edges = JSON.parse(JSON.stringify(snapshot.beforeEdges));
  batch.status = 'undone';
  batch.undoneAt = new Date().toISOString();
  batch.updatedAt = batch.undoneAt;
  return { ok: true, batch: summarizeAgentBatch(project, batch) };
}
