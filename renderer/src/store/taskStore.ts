import { t } from '../i18n/index.ts';
import { recordDiagnosticEvent } from '@/services/diagnosticsService';
import { isActiveTaskStatus } from '@/domain/tasks/TaskStatus';
import {
  createSubmissionId,
  resolveSubmission,
  submissionFingerprint,
} from '@/domain/tasks/Submission';
// task/node/remote 回执保留扩展字段；任务状态的公共定义由领域模块维护。
import { store, touchProject } from '@/store/projectStore';
import { desktopApi } from '@/services/desktopApi';
import { showToast } from '@/store/notificationStore';
import { uid } from '@/utils/format';
import {
  buildGenerationPayload,
  generationUpstreamReadiness,
  summarizeGenerationPayload,
} from '@/domain/graph/generationPayload';
import { DEFAULT_GENERATION_TIMEOUT_MS, nodeTypeLabel } from '@/store/nodeStore';
import { getModelCredentialStatus, settingsStore } from '@/store/settingsStore';
import {
  cancelRemoteGenerationTask,
  pollRemoteGenerationTask,
  submitRemoteGenerationTask,
} from '@/services/modelTaskService';
import {
  archiveGeneratedOutput,
  extractGeneratedFiles,
} from '@/services/generatedResultArchive';
import { evaluateGenerationTask } from '@/store/agentEvaluationStore';
import { generationOutputError } from '@/utils/generationResultValidation';
import { compactGeneratedOutput } from '@/utils/generatedOutputParsing.ts';
import { reconcileOrphanedNodeTaskState } from '@/domain/tasks/taskStateReconciliation.ts';
import { formatRemoteTaskError } from '@/utils/remoteTaskFormatting';

type AnyRecord = Record<string, any>;

// ── Status helpers ──────────────────────────────────────────────────────────

// Kept as a compatibility export for existing retry callers; cancellation is retryable.
export { RETRYABLE_TASK_STATUSES as failedTaskStatuses, statusLabel, statusTone } from '@/domain/tasks/TaskStatus';
import { RETRYABLE_TASK_STATUSES as failedTaskStatuses } from '@/domain/tasks/TaskStatus';

// ── Timer management ────────────────────────────────────────────────────────

const activeTaskTimers = new Map<string, AnyRecord>();

/**
 * 切换/关闭项目时，先停止所有进行中任务的本地定时器与轮询，再替换 store.project。
 * 这样旧项目的任务既不会把结果写进新打开的项目（跨项目污染），也不会在原来
 * 的项目上留下永不回收的定时器；重新打开原项目时由 resumeRemoteTasks 续跑。
 */
export function stopActiveTaskPolling() {
  for (const nodeId of [...activeTaskTimers.keys()]) clearActiveTaskForNode(nodeId);
}

/** @param {number} value @param {number} fallback @returns {number} */
function normalizedInteger(value: unknown, fallback: number) {
  const next = Number(value);
  return Number.isFinite(next) && next >= 0 ? Math.round(next) : fallback;
}

/**
 * 应用重启后不能重新获得完整 15 分钟额度。远端异步任务至少保留 65 秒，
 * 让恢复流程完成一次 60 秒上限的终态查询；同步无句柄任务不会走这里。
 */
function remainingTaskTimeoutMs(task: AnyRecord | null | undefined, { resuming = false }: { resuming?: boolean } = {}) {
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
export function findLatestTaskForNode(nodeId: string): AnyRecord | null {
  return ((store.project.tasks || []) as AnyRecord[])
    .filter((task: AnyRecord) => task.nodeId === nodeId)
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
  return ((store.project.tasks || []) as AnyRecord[]).some((task: AnyRecord) =>
    isActiveTaskStatus(task.status)
  );
}

/**
 * 判断任务是否来自节点当前配置之外的旧模型。
 * 历史任务仍保留用于审计，但不应被 UI 当成当前配置的失败状态。
 * @param {Object} task
 * @returns {boolean}
 */
export function isHistoricalModelTask(task: AnyRecord | null | undefined) {
  if (!task?.nodeId || !task?.model) return false;
  const node = (store.project.nodes as AnyRecord[]).find((item: AnyRecord) => item.id === task.nodeId);
  if (!node) return false;
  const currentModel = node.model || '';
  return Boolean(currentModel && currentModel !== task.model);
}

const REMOTE_TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const SUBMIT_STAGE_ERROR_PATTERN = /模型网络请求失败|error sending request|远程模型提交失败|提交失败|超时|timeout|timed out|remote model submission failed|model network request failed/i;

/**
 * 失败任务是否可以用厂商任务 ID 找回。
 * 只针对提交阶段没拿到 remoteTaskId 的远程任务；已有 remoteTaskId 的任务走正常轮询/恢复。
 */
export function canAdoptRemoteTask(task: AnyRecord | null | undefined) {
  return Boolean(
    task
    && failedTaskStatuses.has(task.status)
    && !task.remoteTaskId
    && !isHistoricalModelTask(task)
    && SUBMIT_STAGE_ERROR_PATTERN.test(String(task.error || '')),
  );
}

/**
 * 清除指定节点关联的活跃定时器（interval + timeout）。
 * @param {string} nodeId
 */
export function clearActiveTaskForNode(nodeId: string) {
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
async function finishTaskSuccess(node: AnyRecord, task: AnyRecord, result: AnyRecord | null = null) {
  clearActiveTaskForNode(node.id);
  node.status = 'completed';
  node.progress = 100;
  node.error = '';
  task.status = 'completed';
  task.progress = 100;
  task.error = '';
  task.completedAt = new Date().toISOString();
  task.result = result || {};
  if (settingsStore.agentAutoEval) {
    task.agentEvaluation = evaluateGenerationTask({ project: store.project, node, task });
  }
  await desktopApi.notifyTask({ title: t("ui.taskStore.text.583fb8d4", { value0: nodeTypeLabel(node.type) }), body: node.title });
  touchProject();
}

/**
 * 以终态失败结束一个任务。
 * @param {Object} node
 * @param {Object} task
 * @param {string} status - 失败状态标识
 * @param {string} error - 错误信息
 */
function finishTaskFailure(node: AnyRecord, task: AnyRecord, status: string, error: string) {
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
    error,
    status,
  };
  recordDiagnosticEvent({
    level: 'error',
    category: 'task',
    name: 'task-failed',
    data: {
      taskId: task.id,
      nodeId: task.nodeId,
      type: task.type,
      model: task.model,
      status,
      attempt: task.attempt,
    },
  });
  touchProject();
}

function applyRemoteTaskUpdate(node: AnyRecord, task: AnyRecord, remote: AnyRecord) {
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
    touchProject({ sessionDelay: 500, coalesceSession: true });
  }
}

async function finishRemoteTaskIfTerminal(node: AnyRecord, task: AnyRecord, remote: AnyRecord, owningProjectId = store.project?.id || '') {
  if (remote.status === 'completed') {
    // 任务所属项目已被切走：此时 store.project 指向另一个项目，任何归档写入
    // 都会污染它。保持节点状态并停止本地轮询，避免跨项目写入。
    if ((store.project?.id || '') !== owningProjectId) {
      node.status = 'failed';
      node.error = t("ui.taskStore.text.9064425e");
      touchProject();
      return true;
    }
    let archivedFiles: AnyRecord[] = [];
    let resultNodes: AnyRecord[] = [];
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
          const requestedRatioParts = String(task.requestPayload?.aspectRatio || '').split(':').map(Number);
          const requestedRatioW = requestedRatioParts[0] as number;
          const requestedRatioH = requestedRatioParts[1] as number;
          const requestedRatio = requestedRatioW > 0 && requestedRatioH > 0
            ? requestedRatioW / requestedRatioH
            : null;
          const actualRatio = Number(probe.width) > 0 && Number(probe.height) > 0
            ? Number(probe.width) / Number(probe.height)
            : null;
          if (requestedRatio && actualRatio && Math.abs(actualRatio - requestedRatio) / requestedRatio > 0.08) {
            mediaContractError = t("ui.taskStore.text.3925cb5f", { value0: task.requestPayload.aspectRatio, value1: probe.width, value2: probe.height });
          }
          const requestedDuration = Number(task.requestPayload?.duration);
          const actualDuration = Number(probe.duration);
          const durationTolerance = Math.max(1, requestedDuration * 0.25);
          if (!mediaContractError && requestedDuration > 0 && actualDuration > 0
            && Math.abs(actualDuration - requestedDuration) > durationTolerance) {
            mediaContractError = t("ui.taskStore.text.4d58de63", { value0: requestedDuration, value1: actualDuration.toFixed(2) });
          }
        }
      }
      const outputError = generationOutputError(node.type, remote, archived) || mediaContractError;
      if (outputError) {
        task.result = {
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
      archiveError = (error as AnyRecord)?.message || t("ui.taskStore.text.32da42c9");
    }
    if (archiveError) {
      task.result = {
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
    finishTaskFailure(node, task, remote.status, remote.error || t("ui.taskStore.text.c0c8405a"));
    task.result = {
      ...(task.result || {}),
      remoteTaskId: task.remoteTaskId || remote.remoteTaskId,
      output: task.result?.output,
      raw: remote.raw,
    };
    return true;
  }
  return false;
}

function attachRemoteTaskPolling(node: AnyRecord, task: AnyRecord, controller: AbortController, { immediate = false, resuming = false }: { immediate?: boolean; resuming?: boolean } = {}) {
  const active = activeTaskTimers.get(node.id) || {
    controller,
    taskId: task.id,
    timeout: window.setTimeout(() => {
      if (isActiveTaskStatus(task.status)) {
        finishTaskFailure(node, task, 'timeout', t("ui.taskStore.text.3afed47e", { value0: task.timeoutMs || DEFAULT_GENERATION_TIMEOUT_MS }));
      }
    }, remainingTaskTimeoutMs(task, { resuming })),
  };
  activeTaskTimers.set(node.id, active);
  const intervalMs = Math.max(500, Number(settingsStore.modelPollIntervalMs) || 1500);
  const owningProjectId = store.project?.id || '';
  const poll = async () => {
    if ((store.project?.id || '') !== owningProjectId) {
      clearActiveTaskForNode(node.id);
      return;
    }
    if (active.polling || !task.remoteTaskId || !isActiveTaskStatus(task.status)) return;
    active.polling = true;
    active.pollStartedAt = Date.now();
    try {
      const remote = await pollRemoteGenerationTask({
        remoteTaskId: task.remoteTaskId,
        modelContract: task.requestPayload?.modelContract,
        signal: controller.signal,
      });
      active.pollFailureCount = 0;
      delete task.lastPollError;
      applyRemoteTaskUpdate(node, task, remote);
      await finishRemoteTaskIfTerminal(node, task, remote, owningProjectId);
    } catch (error) {
      if (controller.signal.aborted) return;
      active.pollFailureCount = Number(active.pollFailureCount || 0) + 1;
      task.lastPollError = formatRemoteTaskError(error) || t("ui.taskStore.text.a35c88be");
      if (active.pollFailureCount >= 3) {
        finishTaskFailure(node, task, 'error', t("ui.taskStore.text.ca2687ad", { value0: task.lastPollError }));
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
  for (const node of (store.project.nodes || []) as AnyRecord[]) {
    reconciled = reconcileOrphanedNodeTaskState(node, (store.project.tasks || []) as AnyRecord[]) || reconciled;
  }
  if (reconciled) touchProject();
  const recoverableArchiveTasks = new Map<string, AnyRecord>();
  for (const task of (store.project.tasks || []) as AnyRecord[]) {
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
  for (const task of (store.project.tasks || []) as AnyRecord[]) {
    const node = (store.project.nodes as AnyRecord[]).find((item: AnyRecord) => item.id === task.nodeId);
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
    if (!isActiveTaskStatus(task.status)) continue;
    // 绝对任务截止时间优先于内存里的 active 标记。HMR 或底层 HTTP 挂死时，
    // 旧 controller/timer 可能仍留在 Map 中但永远不再回调；超过总时限后必须
    // 强制清理，不能因为 activeTaskTimers.has() 而永久跳过。
    if (remainingTaskTimeoutMs(task) <= 0) {
      const active = activeTaskTimers.get(node.id);
      if (!task.remoteTaskId) {
        finishTaskFailure(node, task, 'timeout', t("ui.taskStore.text.3afed47e", { value0: task.timeoutMs || DEFAULT_GENERATION_TIMEOUT_MS }));
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
    if (!task.remoteTaskId) {
      finishTaskFailure(node, task, 'error', t("ui.taskStore.text.e14ca195"));
      continue;
    }
    const controller = new AbortController();
    node.status = task.status;
    node.error = '';
    attachRemoteTaskPolling(node, task, controller, { immediate: true, resuming: true });
    resumed += 1;
  }
  return resumed;
}

async function startRemoteTask(node: AnyRecord, task: AnyRecord, requestPayload: AnyRecord) {
  const controller = new AbortController();
  activeTaskTimers.set(node.id, {
    controller,
    taskId: task.id,
    timeout: window.setTimeout(() => {
      if (isActiveTaskStatus(task.status)) {
        finishTaskFailure(node, task, 'timeout', t("ui.taskStore.text.3afed47e", { value0: task.timeoutMs }));
      }
    }, task.timeoutMs),
  });

  try {
    const submitted = await submitRemoteGenerationTask({
      task,
      payload: requestPayload,
      signal: controller.signal,
    });
    // 第一次请求失败后用户可能已经点击重试。旧请求即使迟到，也不能覆盖新任务。
    const active = activeTaskTimers.get(node.id);
    if (!active || active.taskId !== task.id || !isActiveTaskStatus(task.status)) return;
    applyRemoteTaskUpdate(node, task, submitted);
    if (await finishRemoteTaskIfTerminal(node, task, submitted)) return;
    attachRemoteTaskPolling(node, task, controller);
  } catch (error) {
    if (controller.signal.aborted) return;
    const active = activeTaskTimers.get(node.id);
    if (!active || active.taskId !== task.id) return;
    finishTaskFailure(node, task, 'error', formatRemoteTaskError(error) || t("ui.taskStore.text.fee54fe0"));
  }
}

// ── Public task API ─────────────────────────────────────────────────────────

/**
 * 启动节点生成任务：通过真实模型服务提交并跟踪结果。
 * @param {Object} node - 节点对象
 * @param {{ onlyRetryFailed?: boolean, retryCount?: number }} [options]
 * @returns {Object|null} 创建的任务对象
 */
export function runNode(node: AnyRecord | null | undefined, options: AnyRecord = {}): AnyRecord | null {
  if (!node) {
    showToast(t("ui.taskStore.text.2d62db18"));
    return null;
  }
  if (!['imageGeneration', 'videoGeneration', 'audioGeneration', 'textGeneration'].includes(node.type)) {
    showToast(t("ui.taskStore.text.33c1a883"));
    return null;
  }
  reconcileOrphanedNodeTaskState(node, (store.project.tasks || []) as AnyRecord[]);
  if (isActiveTaskStatus(node.status)) {
    showToast(t("ui.taskStore.text.0e11dfc3"));
    return findLatestTaskForNode(node.id);
  }
  if (options.onlyRetryFailed && !['idle', ...failedTaskStatuses].includes(node.status || 'idle')) {
    return findLatestTaskForNode(node.id);
  }

  // 同一次提交被重复触发（双击、Agent 重放、恢复流程）时先认领已在跑的任务。
  // 这一步不编译请求，所以即使凭据缺失也能安全地短路，不会再发出第二个任务。
  const submissionId = createSubmissionId(options.submissionId || uid());
  const replay = resolveSubmission(store.project.tasks as AnyRecord[], { submissionId });
  if (replay.action === 'reuse') {
    showToast(t("ui.taskStore.submission.reused"));
    return replay.task;
  }

  const credentialStatus = getModelCredentialStatus(node.model);
  if (!credentialStatus.available) {
    const error = t("errors.1c827b494a", { value0: credentialStatus.message });
    node.error = error;
    showToast(error);
    touchProject();
    return null;
  }

  const readiness = generationUpstreamReadiness(node, store.project);
  if (!readiness.ready) {
    const error = t("ui.taskStore.text.0c5b3cbd", { value0: readiness.issues.join('；') });
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
  let requestPayload: AnyRecord;
  try {
    requestPayload = {
      ...summarizeGenerationPayload(buildGenerationPayload(node, store.project)),
    };
  } catch (error) {
    const message = t("ui.taskStore.text.45fcb232", { value0: (error as AnyRecord)?.message || t("ui.taskStore.text.962f78af") });
    node.status = 'failed';
    node.progress = 0;
    node.error = message;
    showToast(message);
    touchProject();
    return null;
  }
  // 参数编译完成后才能判定「同一编号是否换了内容」：同编号不同指纹说明调用方
  // 复用了一个已经发过别的内容的编号，直接拒绝，避免拿旧身份发出新请求。
  const requestFingerprint = submissionFingerprint(requestPayload);
  const submission = resolveSubmission(store.project.tasks as AnyRecord[], { submissionId, fingerprint: requestFingerprint });
  if (submission.action === 'conflict') {
    const message = t("ui.taskStore.submission.conflict");
    node.error = message;
    showToast(message);
    touchProject();
    return null;
  }
  const attempt = submission.action === 'retry' ? submission.attempt : 1;
  const task: AnyRecord = {
    id: uid(),
    nodeId: node.id,
    title: node.title,
    type: node.type,
    model: requestPayload.model,
    requestPayload,
    submissionId,
    requestFingerprint,
    attempt,
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

  startRemoteTask(node, task, requestPayload);
  return task;
}

/**
 * 取消指定任务（通过 taskId）。
 * @param {string} taskId
 * @returns {boolean} 是否成功取消
 */
export function cancelTask(taskId: string) {
  const task = (store.project.tasks as AnyRecord[]).find((item: AnyRecord) => item.id === taskId);
  if (!task || !isActiveTaskStatus(task.status)) return false;
  const node = (store.project.nodes as AnyRecord[]).find((item: AnyRecord) => item.id === task.nodeId);
  if (task.remoteTaskId) {
    cancelRemoteGenerationTask({
      remoteTaskId: task.remoteTaskId,
      modelContract: task.requestPayload?.modelContract,
    }).then((confirmed: boolean) => {
      // 上游异步任务没有可声明的取消端点时，本地停止轮询并不影响远端任务：
      // 如实告知用户，避免误以为已停止计费/执行。
      if (!confirmed) showToast(t("ui.taskStore.text.63150ca0"));
    }).catch(() => {});
  }
  if (node) {
    finishTaskFailure(node, task, 'cancelled', t("ui.taskStore.text.6df9b765"));
  } else {
    task.status = 'cancelled';
    task.error = t("ui.taskStore.text.6df9b765");
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
export function cancelNode(nodeId: string) {
  const task = (store.project.tasks as AnyRecord[]).find((item: AnyRecord) => item.nodeId === nodeId && isActiveTaskStatus(item.status));
  return task ? cancelTask(task.id) : false;
}

/**
 * 重试一个失败/超时/取消的任务。
 * @param {string} taskId
 * @returns {Object|null} 新创建的任务对象
 */
export function retryTask(taskId: string): AnyRecord | null {
  const task = (store.project.tasks as AnyRecord[]).find((item: AnyRecord) => item.id === taskId);
  if (!task || !failedTaskStatuses.has(task.status)) return null;
  const node = (store.project.nodes as AnyRecord[]).find((item: AnyRecord) => item.id === task.nodeId);
  if (!node) return null;
  const nextRetryCount = Number(task.retryCount || 0) + 1;
  const maxRetries = normalizedInteger(task.maxRetries ?? node.maxRetries, 2);
  if (nextRetryCount > maxRetries) {
    showToast(t("ui.taskStore.text.6a4eab5f"));
    return null;
  }
  return runNode(node, { retryCount: nextRetryCount, submissionId: task.submissionId });
}

/**
 * 重试指定节点的失败任务。
 * @param {string} nodeId
 * @returns {Object|null}
 */
export function retryNode(nodeId: string): AnyRecord | null {
  const task = (store.project.tasks as AnyRecord[]).find((item: AnyRecord) => item.nodeId === nodeId && failedTaskStatuses.has(item.status));
  return task ? retryTask(task.id) : null;
}

/**
 * 用厂商后台的任务 ID 认领一个提交阶段丢失响应的任务。
 * 只查询并归档远程结果，不重新提交生成，避免重复计费。
 */
export async function adoptRemoteTask(taskId: string, remoteTaskId: string) {
  const task = (store.project.tasks as AnyRecord[]).find((item: AnyRecord) => item.id === taskId);
  if (!task) return { success: false, error: t("ui.taskStore.text.d7cdbde2") };
  const node = (store.project.nodes as AnyRecord[]).find((item: AnyRecord) => item.id === task.nodeId);
  if (!node) return { success: false, error: t("ui.taskStore.text.5f6ee5eb") };
  if (!canAdoptRemoteTask(task)) {
    return { success: false, error: task.remoteTaskId ? t("ui.taskStore.text.87b72789") : t("ui.taskStore.text.ac205af3") };
  }
  const remoteId = String(remoteTaskId || '').trim();
  if (!REMOTE_TASK_ID_PATTERN.test(remoteId)) {
    return { success: false, error: t("ui.taskStore.text.7406d106") };
  }
  const modelContract = task.requestPayload?.modelContract;
  if (!modelContract?.isAsync || !modelContract?.taskEndpoint?.path) {
    return { success: false, error: t("ui.taskStore.text.76aa9c8d") };
  }

  clearActiveTaskForNode(node.id);
  task.remoteTaskId = remoteId;
  task.status = 'running';
  task.progress = 0;
  task.error = '';
  task.startedAt = new Date().toISOString();
  delete task.completedAt;
  task.manualRecoveryAt = new Date().toISOString();
  task.result = { ...(task.result || {}), manualRecovery: true, error: '' };
  node.status = 'running';
  node.progress = 0;
  node.error = '';
  touchProject();

  const controller = new AbortController();
  activeTaskTimers.set(node.id, {
    controller,
    taskId: task.id,
    timeout: window.setTimeout(() => {
      if (isActiveTaskStatus(task.status)) {
        finishTaskFailure(node, task, 'timeout', t("ui.taskStore.text.3afed47e", { value0: task.timeoutMs || DEFAULT_GENERATION_TIMEOUT_MS }));
      }
    }, remainingTaskTimeoutMs(task, { resuming: true })),
  });

  try {
    const remote = await pollRemoteGenerationTask({
      remoteTaskId: remoteId,
      modelContract,
      signal: controller.signal,
    });
    const active = activeTaskTimers.get(node.id);
    if (active) active.pollFailureCount = 0;
    applyRemoteTaskUpdate(node, task, remote);
    const terminal = await finishRemoteTaskIfTerminal(node, task, remote, store.project?.id || '');
    if (!terminal && isActiveTaskStatus(task.status)) {
      attachRemoteTaskPolling(node, task, controller, { immediate: false, resuming: true });
    }
    return { success: true, task, remote };
  } catch (error) {
    if (controller.signal.aborted) return { success: false, error: t("ui.taskStore.text.b63c506c") };
    // 单次查询失败不立刻判死：挂回正常轮询，由它按 3 次失败/总时限收口。
    task.lastPollError = formatRemoteTaskError(error) || t("ui.taskStore.text.a35c88be");
    touchProject();
    attachRemoteTaskPolling(node, task, controller, { immediate: false, resuming: true });
    showToast(t("ui.taskStore.text.7c50287a", { value0: task.lastPollError }));
    return { success: true, warning: task.lastPollError };
  }
}

/**
 * 判断一个任务是否允许重试。
 * @param {Object} task
 * @returns {boolean}
 */
export function canRetryTask(task: AnyRecord | null | undefined) {
  if (!task || !failedTaskStatuses.has(task.status) || isHistoricalModelTask(task)) return false;
  const maxRetries = normalizedInteger(task.maxRetries, 2);
  return Number(task.retryCount || 0) < maxRetries;
}

/**
 * 清除所有任务记录（取消运行中的任务并清空列表）。
 */
export function clearTasks() {
  for (const task of (store.project.tasks as AnyRecord[])) {
    if (isActiveTaskStatus(task.status)) cancelTask(task.id);
  }
  store.project.tasks = [];
  touchProject();
}
