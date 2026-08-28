import { store, touchProject } from '@/store/projectStore';
import { desktopApi } from '@/services/desktopApi';
import { showToast } from '@/composables/useToast';
import { uid } from '@/utils/format';
import {
  buildGenerationPayload,
  generationUpstreamReadiness,
  summarizeGenerationPayload,
} from '@/utils/generationPayload';
import { DEFAULT_GENERATION_TIMEOUT_MS, nodeTypeLabel } from '@/store/nodeStore';
import { getModelCredentialStatus, settingsStore } from '@/store/settingsStore';
import {
  cancelRemoteGenerationTask,
  pollRemoteGenerationTask,
  submitRemoteGenerationTask,
} from '@/services/modelTaskService';
import {
  archiveGeneratedOutput,
  createMockGeneratedOutput,
  extractGeneratedFiles,
} from '@/services/generatedResultArchive';
import { evaluateGenerationTask } from '@/store/agentEvaluationStore';
import { generationOutputError } from '@/utils/generationResultValidation';
import { compactGeneratedOutput } from '@/utils/generatedOutputParsing.mjs';
import { reconcileOrphanedNodeTaskState } from '@/utils/taskStateReconciliation.mjs';
import { formatRemoteTaskError } from '@/utils/remoteTaskFormatting';

// ── Status helpers ──────────────────────────────────────────────────────────

/** 终态失败状态集合 */
export const failedTaskStatuses = new Set(['failed', 'timeout', 'cancelled', 'error']);

/**
 * 将任务状态标识映射为中文标签。
 * @param {string} status
 * @returns {string}
 */
export function statusLabel(status) {
  return {
    idle: '待命',
    queued: '排队中',
    running: '运行中',
    completed: '已完成',
    failed: '失败',
    timeout: '超时',
    cancelled: '已取消',
    error: '错误',
    partial_failed: '部分失败',
    stopped: '已停止',
    historical: '历史模型',
  }[status] || status;
}

/**
 * 将任务状态映射为 UI 色调标识。
 * @param {string} status
 * @returns {string} 'info' | 'warn' | 'good' | 'bad' | 'muted' | ''
 */
export function statusTone(status) {
  return {
    queued: 'info',
    running: 'warn',
    completed: 'good',
    failed: 'bad',
    timeout: 'bad',
    cancelled: 'muted',
    error: 'bad',
    partial_failed: 'warn',
    stopped: 'muted',
    historical: 'muted',
  }[status] || '';
}

// ── Timer management ────────────────────────────────────────────────────────

const activeTaskTimers = new Map();

/** @param {number} value @param {number} fallback @returns {number} */
function normalizedInteger(value, fallback) {
  const next = Number(value);
  return Number.isFinite(next) && next >= 0 ? Math.round(next) : fallback;
}

/**
 * 应用重启后不能重新获得完整 15 分钟额度。远端异步任务至少保留 65 秒，
 * 让恢复流程完成一次 60 秒上限的终态查询；同步无句柄任务不会走这里。
 */
function remainingTaskTimeoutMs(task, { resuming = false } = {}) {
  const timeoutMs = normalizedInteger(task?.timeoutMs, DEFAULT_GENERATION_TIMEOUT_MS);
  const startedAt = Date.parse(task?.startedAt || task?.createdAt || 0);
  const elapsed = Number.isFinite(startedAt) && startedAt > 0 ? Date.now() - startedAt : 0;
  return Math.max(resuming ? 65000 : 0, timeoutMs - Math.max(0, elapsed));
}

/**
 * 查找指定节点最近的一条任务记录。
 * @param {string} nodeId
 * @returns {Object|null}
 */
export function findLatestTaskForNode(nodeId) {
  return [...(store.project.tasks || [])]
    .filter((task) => task.nodeId === nodeId)
    .sort((a, b) => {
      const aTime = Date.parse(a.startedAt || a.createdAt || a.completedAt || 0) || 0;
      const bTime = Date.parse(b.startedAt || b.createdAt || b.completedAt || 0) || 0;
      return bTime - aTime;
    })[0] || null;
}

/**
 * 当前项目是否仍有生成请求在本窗口中执行。
 * 页面路由可以自由切换，但在这些请求终止前不能替换整个项目上下文。
 */
export function hasActiveGenerationTasks() {
  return (store.project.tasks || []).some((task) =>
    ['running', 'queued'].includes(task.status)
  );
}

/**
 * 判断任务是否来自节点当前配置之外的旧模型。
 * 历史任务仍保留用于审计，但不应被 UI 当成当前配置的失败状态。
 * @param {Object} task
 * @returns {boolean}
 */
export function isHistoricalModelTask(task) {
  if (!task?.nodeId || !task?.model) return false;
  const node = store.project.nodes.find((item) => item.id === task.nodeId);
  if (!node) return false;
  const currentModel = node.model || '';
  return Boolean(currentModel && currentModel !== task.model);
}

/**
 * 清除指定节点关联的活跃定时器（interval + timeout）。
 * @param {string} nodeId
 */
export function clearActiveTaskForNode(nodeId) {
  const active = activeTaskTimers.get(nodeId);
  if (!active) return;
  if (active.timer) window.clearInterval(active.timer);
  if (active.timeout) window.clearTimeout(active.timeout);
  active.controller?.abort();
  activeTaskTimers.delete(nodeId);
}

// ── Task lifecycle ──────────────────────────────────────────────────────────

/**
 * 完成一个成功任务：清理定时器，设置节点和任务状态为 completed。
 * @param {Object} node
 * @param {Object} task
 */
async function finishTaskSuccess(node, task, result = null) {
  clearActiveTaskForNode(node.id);
  node.status = 'completed';
  node.progress = 100;
  node.error = '';
  task.status = 'completed';
  task.progress = 100;
  task.error = '';
  task.completedAt = new Date().toISOString();
  task.result = result || {
    requestPayload: task.requestPayload || summarizeGenerationPayload(buildGenerationPayload(node, store.project)),
  };
  if (settingsStore.agentAutoEval) {
    task.agentEvaluation = evaluateGenerationTask({ project: store.project, node, task });
  }
  await desktopApi.notifyTask({ title: `${nodeTypeLabel(node.type)}完成`, body: node.title });
  touchProject();
}

/**
 * 以终态失败结束一个任务。
 * @param {Object} node
 * @param {Object} task
 * @param {string} status - 失败状态标识
 * @param {string} error - 错误信息
 */
function finishTaskFailure(node, task, status, error) {
  clearActiveTaskForNode(node.id);
  node.status = status;
  node.error = error;
  node.progress = Math.max(0, Math.min(99, node.progress || task.progress || 0));
  task.status = status;
  task.error = error;
  task.progress = node.progress;
  task.completedAt = new Date().toISOString();
  task.result = {
    ...(task.result || {}),
    requestPayload: task.requestPayload,
    error,
    status,
  };
  touchProject();
}

function applyRemoteTaskUpdate(node, task, remote) {
  const previous = {
    remoteTaskId: task.remoteTaskId || '',
    taskStatus: task.status,
    nodeStatus: node.status,
    taskProgress: Number(task.progress) || 0,
    nodeProgress: Number(node.progress) || 0,
  };
  if (remote.remoteTaskId) task.remoteTaskId = remote.remoteTaskId;
  if (remote.status === 'queued') {
    task.status = 'queued';
    node.status = 'running';
  } else if (remote.status && !['completed', 'failed', 'timeout', 'cancelled', 'error'].includes(remote.status)) {
    task.status = 'running';
    node.status = 'running';
  }
  const progress = Math.max(task.progress || 0, remote.progress || 0);
  task.progress = progress;
  node.progress = progress;
  const changed = previous.remoteTaskId !== (task.remoteTaskId || '')
    || previous.taskStatus !== task.status
    || previous.nodeStatus !== node.status
    || previous.taskProgress !== (Number(task.progress) || 0)
    || previous.nodeProgress !== (Number(node.progress) || 0);
  if (changed) {
    task.remote = {
      taskId: task.remoteTaskId,
      updatedAt: new Date().toISOString(),
    };
    touchProject({ sessionDelay: 500, coalesceSession: true });
  }
}

async function finishRemoteTaskIfTerminal(node, task, remote) {
  if (remote.status === 'completed') {
    let archivedFiles = [];
    let resultNodes = [];
    let generatedText = '';
    let archiveError = '';
    try {
      const archived = await archiveGeneratedOutput({
        project: store.project,
        node,
        task,
        output: remote.result,
      });
      archivedFiles = archived.archivedFiles || [];
      resultNodes = archived.resultNodes || [];
      generatedText = archived.text || '';
      let mediaContractError = '';
      if (node.type === 'videoGeneration' && archivedFiles[0]?.filePath) {
        const probe = await desktopApi.file.probeMedia?.(archivedFiles[0].filePath).catch(() => null);
        if (probe) {
          task.mediaProbe = probe;
          const requestedRatioParts = String(task.requestPayload?.aspectRatio || '').split(':').map(Number);
          const requestedRatio = requestedRatioParts[0] > 0 && requestedRatioParts[1] > 0
            ? requestedRatioParts[0] / requestedRatioParts[1]
            : null;
          const actualRatio = Number(probe.width) > 0 && Number(probe.height) > 0
            ? Number(probe.width) / Number(probe.height)
            : null;
          if (requestedRatio && actualRatio && Math.abs(actualRatio - requestedRatio) / requestedRatio > 0.08) {
            mediaContractError = `视频输出比例不符合请求：请求 ${task.requestPayload.aspectRatio}，实际 ${probe.width}x${probe.height}`;
          }
          const requestedDuration = Number(task.requestPayload?.duration);
          const actualDuration = Number(probe.duration);
          const durationTolerance = Math.max(1, requestedDuration * 0.25);
          if (!mediaContractError && requestedDuration > 0 && actualDuration > 0
            && Math.abs(actualDuration - requestedDuration) > durationTolerance) {
            mediaContractError = `视频输出时长不符合请求：请求 ${requestedDuration}s，实际 ${actualDuration.toFixed(2)}s`;
          }
        }
      }
      const outputError = generationOutputError(node.type, remote, archived) || mediaContractError;
      if (outputError) {
        task.result = {
          requestPayload: task.requestPayload,
          remoteTaskId: task.remoteTaskId || remote.remoteTaskId,
          output: remote.result,
          archivedFiles,
          resultNodes,
          archiveError: outputError,
          raw: remote.raw,
        };
        finishTaskFailure(node, task, 'failed', outputError);
        return true;
      }
    } catch (error) {
      archiveError = error?.message || '生成结果归档失败';
    }
    if (archiveError) {
      task.result = {
        requestPayload: task.requestPayload,
        remoteTaskId: task.remoteTaskId || remote.remoteTaskId,
        output: remote.result,
        archivedFiles,
        resultNodes,
        archiveError,
        raw: remote.raw,
      };
      finishTaskFailure(node, task, 'failed', archiveError);
      return true;
    }
    await finishTaskSuccess(node, task, {
      requestPayload: task.requestPayload,
      remoteTaskId: task.remoteTaskId || remote.remoteTaskId,
      output: compactGeneratedOutput(remote.result),
      archivedFiles,
      resultNodes,
      text: generatedText,
      archiveError,
      raw: compactGeneratedOutput(remote.raw),
    });
    return true;
  }
  if (['failed', 'timeout', 'cancelled', 'error'].includes(remote.status)) {
    finishTaskFailure(node, task, remote.status, remote.error || '远程模型任务失败');
    task.result = {
      ...(task.result || {}),
      requestPayload: task.requestPayload,
      remoteTaskId: task.remoteTaskId || remote.remoteTaskId,
      output: task.result?.output,
      raw: remote.raw,
    };
    return true;
  }
  return false;
}

function attachRemoteTaskPolling(node, task, controller, { immediate = false, resuming = false } = {}) {
  const active = activeTaskTimers.get(node.id) || {
    controller,
    taskId: task.id,
    timeout: window.setTimeout(() => {
      if (task.status === 'running' || task.status === 'queued') {
        finishTaskFailure(node, task, 'timeout', `生成超时（${task.timeoutMs || DEFAULT_GENERATION_TIMEOUT_MS}ms）`);
      }
    }, remainingTaskTimeoutMs(task, { resuming })),
  };
  activeTaskTimers.set(node.id, active);
  const intervalMs = Math.max(500, Number(settingsStore.modelPollIntervalMs) || 1500);
  const poll = async () => {
    if (active.polling || !task.remoteTaskId || !['running', 'queued'].includes(task.status)) return;
    active.polling = true;
    active.pollStartedAt = Date.now();
    try {
      const remote = await pollRemoteGenerationTask({
        settings: settingsStore,
        remoteTaskId: task.remoteTaskId,
        model: task.requestPayload?.model,
        modelContract: task.requestPayload?.modelContract,
        signal: controller.signal,
      });
      active.pollFailureCount = 0;
      delete task.lastPollError;
      applyRemoteTaskUpdate(node, task, remote);
      await finishRemoteTaskIfTerminal(node, task, remote);
    } catch (error) {
      if (controller.signal.aborted) return;
      active.pollFailureCount = Number(active.pollFailureCount || 0) + 1;
      task.lastPollError = formatRemoteTaskError(error) || '远程模型轮询失败';
      task.remote = {
        ...(task.remote || {}),
        taskId: task.remoteTaskId,
        pollFailureCount: active.pollFailureCount,
        lastPollError: task.lastPollError,
        updatedAt: new Date().toISOString(),
      };
      if (active.pollFailureCount >= 3) {
        finishTaskFailure(node, task, 'error', `远程模型连续轮询失败 3 次：${task.lastPollError}`);
      } else {
        touchProject();
      }
    } finally {
      active.polling = false;
      active.pollSettledAt = Date.now();
    }
  };
  active.timer = window.setInterval(poll, intervalMs);
  if (immediate) poll();
}

export function resumeRemoteTasks() {
  let resumed = 0;
  let reconciled = false;
  for (const node of store.project.nodes || []) {
    reconciled = reconcileOrphanedNodeTaskState(node, store.project.tasks || []) || reconciled;
  }
  if (reconciled) touchProject();
  const recoverableArchiveTasks = new Map();
  for (const task of store.project.tasks || []) {
    const recoverable = failedTaskStatuses.has(task.status)
      && task.result?.archiveError
      && !(task.result?.archivedFiles || []).length
      && extractGeneratedFiles(task.result?.output).length > 0
      && Number(task.archiveRecoveryCount || 0) < 2;
    if (!recoverable) continue;
    const previous = recoverableArchiveTasks.get(task.nodeId);
    const taskTime = Date.parse(task.completedAt || task.createdAt || 0) || 0;
    const previousTime = Date.parse(previous?.completedAt || previous?.createdAt || 0) || 0;
    if (!previous || taskTime > previousTime) recoverableArchiveTasks.set(task.nodeId, task);
  }
  for (const task of store.project.tasks || []) {
    const node = store.project.nodes.find((item) => item.id === task.nodeId);
    if (!node) continue;
    // 远端已经成功、仅本地归档失败时，复用保存下来的 URL/Base64。同一节点
    // 每次只恢复最新的一条，避免并发写入；后续轮次再依次保全更早结果。
    // 全程不重新提交模型任务，因此不会重复生成或计费。
    const recoverableArchive = failedTaskStatuses.has(task.status)
      && recoverableArchiveTasks.get(task.nodeId)?.id === task.id
      && task.result?.archiveError
      && !(task.result?.archivedFiles || []).length
      && extractGeneratedFiles(task.result?.output).length > 0
      && Number(task.archiveRecoveryCount || 0) < 2;
    if (recoverableArchive) {
      task.archiveRecoveryCount = Number(task.archiveRecoveryCount || 0) + 1;
      task.status = 'running';
      task.error = '';
      node.status = 'running';
      node.error = '';
      void finishRemoteTaskIfTerminal(node, task, {
        status: 'completed',
        progress: 100,
        remoteTaskId: task.remoteTaskId,
        result: task.result.output,
        raw: task.result.raw,
      });
      resumed += 1;
      continue;
    }
    if (!['running', 'queued'].includes(task.status)) continue;
    // 绝对任务截止时间优先于内存里的 active 标记。HMR 或底层 HTTP 挂死时，
    // 旧 controller/timer 可能仍留在 Map 中但永远不再回调；超过总时限后必须
    // 强制清理，不能因为 activeTaskTimers.has() 而永久跳过。
    if (remainingTaskTimeoutMs(task) <= 0) {
      const active = activeTaskTimers.get(node.id);
      if (!task.remoteTaskId) {
        finishTaskFailure(node, task, 'timeout', `生成超时（${task.timeoutMs || DEFAULT_GENERATION_TIMEOUT_MS}ms）`);
        continue;
      }
      // 有服务端句柄的视频可能已经在后台完成。总时限到期后先进行一次最终恢复查询。
      // HMR 会保留旧模块创建的 Map/定时器；旧版 expiredRecovery 没有起始时间，或
      // 新恢复查询超过 70 秒仍未结束时，都允许当前模块接管，避免永久跳过成功任务。
      const recoveryAge = Date.now() - Number(active?.recoveryStartedAt || 0);
      if (active?.expiredRecovery && recoveryAge >= 0 && recoveryAge < 70000) continue;
      clearActiveTaskForNode(node.id);
      const controller = new AbortController();
      node.status = task.status;
      node.error = '';
      attachRemoteTaskPolling(node, task, controller, { immediate: true, resuming: true });
      const recovery = activeTaskTimers.get(node.id);
      if (recovery) {
        recovery.expiredRecovery = true;
        recovery.recoveryStartedAt = Date.now();
      }
      resumed += 1;
      continue;
    }
    if (activeTaskTimers.has(node.id)) continue;
    if (task.runner === 'remote' && !task.remoteTaskId) {
      finishTaskFailure(node, task, 'error', '同步生成请求在应用重启后无法恢复，原请求已结束；请重试该节点');
      continue;
    }
    if (!task.remoteTaskId) continue;
    const controller = new AbortController();
    node.status = task.status;
    node.error = '';
    attachRemoteTaskPolling(node, task, controller, { immediate: true, resuming: true });
    resumed += 1;
  }
  return resumed;
}

async function startRemoteTask(node, task, requestPayload) {
  const controller = new AbortController();
  activeTaskTimers.set(node.id, {
    controller,
    taskId: task.id,
    timeout: window.setTimeout(() => {
      if (task.status === 'running' || task.status === 'queued') {
        finishTaskFailure(node, task, 'timeout', `生成超时（${task.timeoutMs}ms）`);
      }
    }, task.timeoutMs),
  });

  try {
    const submitted = await submitRemoteGenerationTask({
      settings: settingsStore,
      task,
      payload: requestPayload,
      signal: controller.signal,
    });
    // 第一次请求失败后用户可能已经点击重试。旧请求即使迟到，也不能覆盖新任务。
    const active = activeTaskTimers.get(node.id);
    if (!active || active.taskId !== task.id || !['running', 'queued'].includes(task.status)) return;
    applyRemoteTaskUpdate(node, task, submitted);
    if (await finishRemoteTaskIfTerminal(node, task, submitted)) return;
    attachRemoteTaskPolling(node, task, controller);
  } catch (error) {
    if (controller.signal.aborted) return;
    const active = activeTaskTimers.get(node.id);
    if (!active || active.taskId !== task.id) return;
    finishTaskFailure(node, task, 'error', formatRemoteTaskError(error) || '远程模型提交失败');
  }
}

// ── Public task API ─────────────────────────────────────────────────────────

/**
 * 启动节点生成任务：配置远程模型服务时走提交/轮询，否则使用本地 mock。
 * @param {Object} node - 节点对象
 * @param {{ onlyRetryFailed?: boolean, retryCount?: number }} [options]
 * @returns {Object|null} 创建的任务对象
 */
export function runNode(node, options = {}) {
  if (!node) {
    showToast('先选择节点');
    return null;
  }
  if (!['imageGeneration', 'videoGeneration', 'audioGeneration', 'textGeneration'].includes(node.type)) {
    showToast('当前节点类型不支持运行');
    return null;
  }
  reconcileOrphanedNodeTaskState(node, store.project.tasks || []);
  if (['running', 'queued'].includes(node.status)) {
    showToast('节点正在运行');
    return findLatestTaskForNode(node.id);
  }
  if (options.onlyRetryFailed && !['idle', ...failedTaskStatuses].includes(node.status || 'idle')) {
    return findLatestTaskForNode(node.id);
  }

  const credentialStatus = getModelCredentialStatus(node.model);
  if (!credentialStatus.available) {
    const error = `${credentialStatus.message}，请先在设置 → API 厂商中完成配置`;
    node.error = error;
    showToast(error);
    touchProject();
    return null;
  }

  const readiness = generationUpstreamReadiness(node, store.project);
  if (!readiness.ready) {
    const error = `上游输入尚未就绪：${readiness.issues.join('；')}`;
    node.error = error;
    showToast(error);
    touchProject();
    return null;
  }

  clearActiveTaskForNode(node.id);
  const now = new Date().toISOString();
  const retryCount = Number(options.retryCount ?? node.retryCount ?? 0);
  const maxRetries = normalizedInteger(node.maxRetries, 2);
  const timeoutMs = normalizedInteger(node.timeoutMs, DEFAULT_GENERATION_TIMEOUT_MS);
  let requestPayload;
  try {
    requestPayload = {
      ...summarizeGenerationPayload(buildGenerationPayload(node, store.project)),
    };
  } catch (error) {
    const message = `生成请求准备失败：${error?.message || '无法构造请求参数'}`;
    node.status = 'failed';
    node.progress = 0;
    node.error = message;
    showToast(message);
    touchProject();
    return null;
  }
  const useRemote = true;
  const task = {
    id: uid(),
    nodeId: node.id,
    title: node.title,
    type: node.type,
    model: requestPayload.model,
    requestPayload,
    runner: useRemote ? 'remote' : 'mock',
    status: 'running',
    progress: 0,
    retryCount,
    maxRetries,
    timeoutMs,
    startedAt: now,
    createdAt: now,
    error: '',
  };
  node.status = 'running';
  node.progress = 0;
  node.retryCount = retryCount;
  node.maxRetries = maxRetries;
  node.timeoutMs = timeoutMs;
  node.error = '';
  store.project.tasks.unshift(task);
  touchProject();

  if (useRemote) {
    startRemoteTask(node, task, requestPayload);
    return task;
  }

  const outcome = node.config?.mockOutcome || 'success';
  const timer = window.setInterval(async () => {
    if (task.status !== 'running') {
      clearActiveTaskForNode(node.id);
      return;
    }
    node.progress = Math.min(100, (node.progress || 0) + 20);
    task.progress = node.progress;
    if (outcome === 'failed' && node.progress >= 60) {
      finishTaskFailure(node, task, 'failed', '模拟生成失败');
      return;
    }
    if (outcome === 'error' && node.progress >= 40) {
      finishTaskFailure(node, task, 'error', '生成服务返回错误');
      return;
    }
    if (outcome === 'timeout') {
      node.progress = Math.min(95, node.progress);
      task.progress = node.progress;
      return;
    }
    if (node.progress >= 100) {
      const generated = createMockGeneratedOutput({ project: store.project, node, task });
      await finishTaskSuccess(node, task, {
        requestPayload: task.requestPayload,
        output: generated.output,
        archivedFiles: generated.archivedFiles,
        resultNodes: generated.resultNodes,
      });
    }
    touchProject();
  }, 450);
  const timeout = window.setTimeout(() => {
    if (task.status === 'running') {
      finishTaskFailure(node, task, 'timeout', `生成超时（${timeoutMs}ms）`);
    }
  }, timeoutMs);
  activeTaskTimers.set(node.id, { timer, timeout, taskId: task.id });
  return task;
}

/**
 * 取消指定任务（通过 taskId）。
 * @param {string} taskId
 * @returns {boolean} 是否成功取消
 */
export function cancelTask(taskId) {
  const task = store.project.tasks.find((item) => item.id === taskId);
  if (!task || !['running', 'queued'].includes(task.status)) return false;
  const node = store.project.nodes.find((item) => item.id === task.nodeId);
  if (task.runner === 'remote' && task.remoteTaskId) {
    cancelRemoteGenerationTask({
      settings: settingsStore,
      remoteTaskId: task.remoteTaskId,
    }).catch(() => {});
  }
  if (node) {
    finishTaskFailure(node, task, 'cancelled', '任务已取消');
  } else {
    task.status = 'cancelled';
    task.error = '任务已取消';
    task.completedAt = new Date().toISOString();
    touchProject();
  }
  return true;
}

/**
 * 取消指定节点的运行中任务。
 * @param {string} nodeId
 * @returns {boolean}
 */
export function cancelNode(nodeId) {
  const task = store.project.tasks.find((item) => item.nodeId === nodeId && ['running', 'queued'].includes(item.status));
  return task ? cancelTask(task.id) : false;
}

/**
 * 重试一个失败/超时/取消的任务。
 * @param {string} taskId
 * @returns {Object|null} 新创建的任务对象
 */
export function retryTask(taskId) {
  const task = store.project.tasks.find((item) => item.id === taskId);
  if (!task || !failedTaskStatuses.has(task.status)) return null;
  const node = store.project.nodes.find((item) => item.id === task.nodeId);
  if (!node) return null;
  const nextRetryCount = Number(task.retryCount || 0) + 1;
  const maxRetries = normalizedInteger(task.maxRetries ?? node.maxRetries, 2);
  if (nextRetryCount > maxRetries) {
    showToast('已达到最大重试次数');
    return null;
  }
  return runNode(node, { retryCount: nextRetryCount });
}

/**
 * 重试指定节点的失败任务。
 * @param {string} nodeId
 * @returns {Object|null}
 */
export function retryNode(nodeId) {
  const task = store.project.tasks.find((item) => item.nodeId === nodeId && failedTaskStatuses.has(item.status));
  return task ? retryTask(task.id) : null;
}

/**
 * 判断一个任务是否允许重试。
 * @param {Object} task
 * @returns {boolean}
 */
export function canRetryTask(task) {
  if (!task || !failedTaskStatuses.has(task.status) || isHistoricalModelTask(task)) return false;
  const maxRetries = normalizedInteger(task.maxRetries, 2);
  return Number(task.retryCount || 0) < maxRetries;
}

/**
 * 清除所有任务记录（取消运行中的任务并清空列表）。
 */
export function clearTasks() {
  for (const task of store.project.tasks) {
    if (['running', 'queued'].includes(task.status)) cancelTask(task.id);
  }
  store.project.tasks = [];
  touchProject();
}
