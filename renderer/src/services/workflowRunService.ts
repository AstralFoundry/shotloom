/**
 * 工作流实例执行：按拓扑顺序提交生成步骤，等待终态后推进。
 *
 * 只复用现有的节点运行与任务状态机：每一步提交都走 `runNode`（带提交编号），
 * 等待终态靠任务记录轮询，不另开一套执行器。失败即停，已完成步骤不会被重跑。
 */

import { isActiveTaskStatus } from '@/domain/tasks/TaskStatus';
import { DEFAULT_GENERATION_TIMEOUT_MS } from '@/store/nodeStore';
import { store, touchProject } from '@/store/projectStore';
import { runNode, cancelNode } from '@/store/taskStore';
import type { WorkflowInstanceRecord, WorkflowInstanceStep } from '@/services/workflowInstanceService';

type AnyRecord = Record<string, any>;

export interface WorkflowTaskTerminal {
  status: string;
  error?: string;
}

export interface WorkflowExecutor {
  findNode: (nodeId: string) => AnyRecord | null;
  runNode: (node: AnyRecord) => AnyRecord | null;
  cancelNode: (nodeId: string) => boolean;
  waitForTask: (taskId: string, signal: AbortSignal) => Promise<WorkflowTaskTerminal>;
}

export interface RunWorkflowOptions {
  executor?: Partial<WorkflowExecutor>;
  signal?: AbortSignal;
  pollIntervalMs?: number;
  taskTimeoutMs?: number;
}

const activeRuns = new Map<string, AbortController>();

function instances(): WorkflowInstanceRecord[] {
  const project = store.project as AnyRecord;
  if (!Array.isArray(project.workflowInstances)) project.workflowInstances = [];
  return project.workflowInstances as WorkflowInstanceRecord[];
}

export function findWorkflowInstance(instanceId: string): WorkflowInstanceRecord | null {
  return instances().find((instance) => instance.id === instanceId) || null;
}

function nodeById(nodeId: string): AnyRecord | null {
  return ((store.project.nodes || []) as AnyRecord[]).find((node) => node.id === nodeId) || null;
}

/** 默认等待：轮询任务记录直到终态；不新建第二套状态来源。 */
function makeWaitForTask(pollIntervalMs: number, taskTimeoutMs: number) {
  return (taskId: string, signal: AbortSignal): Promise<WorkflowTaskTerminal> => new Promise((resolve) => {
    const startedAt = Date.now();
    const tick = () => {
      if (signal.aborted) {
        resolve({ status: 'cancelled', error: 'aborted' });
        return;
      }
      const task = ((store.project.tasks || []) as AnyRecord[]).find((item) => item.id === taskId);
      if (!task) {
        resolve({ status: 'error', error: 'missing-task' });
        return;
      }
      if (!isActiveTaskStatus(task.status)) {
        resolve({ status: String(task.status), ...(task.error ? { error: String(task.error) } : {}) });
        return;
      }
      if (Date.now() - startedAt > taskTimeoutMs) {
        resolve({ status: 'timeout', error: 'timeout' });
        return;
      }
      setTimeout(tick, pollIntervalMs);
    };
    tick();
  });
}

function stepOf(instance: WorkflowInstanceRecord, stepId: string): WorkflowInstanceStep {
  if (!instance.steps) instance.steps = {};
  if (!instance.steps[stepId]) instance.steps[stepId] = { status: 'pending' };
  return instance.steps[stepId] as WorkflowInstanceStep;
}

function markStep(instance: WorkflowInstanceRecord, stepId: string, patch: Partial<WorkflowInstanceStep>) {
  const step = stepOf(instance, stepId);
  Object.assign(step, patch);
  // exactOptionalPropertyTypes：清空时间戳要删字段，而不是写 undefined。
  if ('completedAt' in patch && patch.completedAt === undefined) delete step.completedAt;
  touchProject();
}

/**
 * 执行（或继续执行）一个实例。
 *
 * 已完成的节点直接跳过，所以重试只需要把失败步骤改回 pending 再调一次。
 */
export async function runWorkflowInstance(
  instanceId: string,
  options: RunWorkflowOptions = {},
): Promise<{ ok: boolean; instance?: WorkflowInstanceRecord; error?: string }> {
  const instance = findWorkflowInstance(instanceId);
  if (!instance) return { ok: false, error: 'missing-instance' };
  if (activeRuns.has(instanceId)) return { ok: false, error: 'already-running' };

  const pollIntervalMs = options.pollIntervalMs ?? 400;
  const executor: WorkflowExecutor = {
    findNode: options.executor?.findNode || nodeById,
    runNode: options.executor?.runNode || ((node) => runNode(node)),
    cancelNode: options.executor?.cancelNode || ((nodeId) => cancelNode(nodeId)),
    waitForTask: options.executor?.waitForTask
      || makeWaitForTask(pollIntervalMs, options.taskTimeoutMs ?? DEFAULT_GENERATION_TIMEOUT_MS),
  };

  const controller = new AbortController();
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  activeRuns.set(instanceId, controller);
  instance.status = 'running';
  touchProject();

  const order = Array.isArray(instance.executionOrder) ? instance.executionOrder : [];
  for (const stepId of order) {
    if (controller.signal.aborted) {
      instance.status = 'cancelled';
      break;
    }
    const nodeId = instance.nodeIds[stepId];
    const node = nodeId ? executor.findNode(nodeId) : null;
    if (!node) {
      markStep(instance, stepId, { status: 'failed', error: 'missing-node', completedAt: new Date().toISOString() });
      instance.status = 'failed';
      break;
    }
    if (node.status === 'completed') {
      markStep(instance, stepId, { status: 'completed', completedAt: new Date().toISOString() });
      continue;
    }
    markStep(instance, stepId, {
      status: 'running',
      error: '',
      startedAt: new Date().toISOString(),
      completedAt: undefined,
    });

    const task = executor.runNode(node);
    if (!task?.id) {
      markStep(instance, stepId, { status: 'failed', error: 'submit-failed', completedAt: new Date().toISOString() });
      instance.status = 'failed';
      break;
    }
    markStep(instance, stepId, { taskId: String(task.id) });

    const terminal = await executor.waitForTask(String(task.id), controller.signal);
    if (terminal.status === 'completed') {
      markStep(instance, stepId, { status: 'completed', completedAt: new Date().toISOString() });
      continue;
    }
    if (terminal.status === 'cancelled') {
      markStep(instance, stepId, { status: 'cancelled', error: terminal.error || 'cancelled', completedAt: new Date().toISOString() });
      instance.status = 'cancelled';
      break;
    }
    markStep(instance, stepId, {
      status: 'failed',
      error: terminal.error ? `${terminal.status}:${terminal.error}` : terminal.status,
      completedAt: new Date().toISOString(),
    });
    instance.status = 'failed';
    break;
  }

  if (instance.status === 'running') instance.status = 'completed';
  activeRuns.delete(instanceId);
  touchProject();
  return { ok: instance.status === 'completed', instance };
}

/** 重试：失败的步骤回到 pending，已完成的步骤保留；随后再次执行。 */
export async function retryWorkflowInstance(
  instanceId: string,
  options: RunWorkflowOptions = {},
): Promise<{ ok: boolean; instance?: WorkflowInstanceRecord; error?: string }> {
  const instance = findWorkflowInstance(instanceId);
  if (!instance) return { ok: false, error: 'missing-instance' };
  if (activeRuns.has(instanceId)) return { ok: false, error: 'already-running' };
  for (const step of Object.values(instance.steps || {})) {
    if (step.status === 'failed' || step.status === 'cancelled') {
      step.status = 'pending';
      step.error = '';
      delete step.taskId;
    }
  }
  instance.status = 'planned';
  touchProject();
  return runWorkflowInstance(instanceId, options);
}

/** 取消：先中止等待，再让当前节点回到可重试状态。 */
export function cancelWorkflowInstance(instanceId: string): boolean {
  const instance = findWorkflowInstance(instanceId);
  if (!instance) return false;
  const controller = activeRuns.get(instanceId);
  controller?.abort();
  const runningStepId = Object.entries(instance.steps || {})
    .find(([, step]) => step.status === 'running')?.[0];
  if (runningStepId) {
    const nodeId = instance.nodeIds[runningStepId];
    if (nodeId) cancelNode(nodeId);
    markStep(instance, runningStepId, { status: 'cancelled', completedAt: new Date().toISOString() });
  }
  instance.status = 'cancelled';
  activeRuns.delete(instanceId);
  touchProject();
  return true;
}

export function workflowInstanceProgress(instance: WorkflowInstanceRecord) {
  const order = Array.isArray(instance.executionOrder) ? instance.executionOrder : [];
  const steps = order.map((stepId) => instance.steps?.[stepId]?.status || 'pending');
  const completed = steps.filter((status) => status === 'completed').length;
  return { completed, total: order.length, steps };
}
