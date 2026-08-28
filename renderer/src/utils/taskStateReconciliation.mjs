const ACTIVE_TASK_STATUSES = new Set(['running', 'queued']);

function taskTimestamp(task) {
  return Date.parse(task?.startedAt || task?.createdAt || task?.completedAt || 0) || 0;
}

/**
 * 节点运行态必须有活跃任务作为事实依据。异步保存或页面恢复可能留下孤立的
 * running 状态，此时用当前模型最近的终态任务还原节点，而不是继续展示假进度。
 */
export function reconcileOrphanedNodeTaskState(node, tasks = []) {
  if (!node || !ACTIVE_TASK_STATUSES.has(node.status)) return false;
  const nodeTasks = tasks.filter((task) => task?.nodeId === node.id);
  if (nodeTasks.some((task) => ACTIVE_TASK_STATUSES.has(task.status))) return false;

  const latestCurrentModelTask = nodeTasks
    .filter((task) => !task?.model || !node.model || task.model === node.model)
    .sort((a, b) => taskTimestamp(b) - taskTimestamp(a))[0];

  if (!latestCurrentModelTask) {
    node.status = 'idle';
    node.progress = 0;
    node.error = '';
    return true;
  }

  node.status = latestCurrentModelTask.status || 'idle';
  node.progress = Math.max(0, Math.min(100, Number(latestCurrentModelTask.progress) || 0));
  node.error = latestCurrentModelTask.error || '';
  return true;
}
