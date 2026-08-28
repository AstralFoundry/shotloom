import { reactive } from '@/store/domainReactivity';
import { desktopApi } from '@/services/desktopApi';

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 2_000;
let operationId = 0;
let retryTimer = null;

export const updateStore = reactive({
  phase: 'idle',
  info: null,
  progress: null,
  error: '',
  notice: '',
  warning: '',
  dialogOpen: false,
  checking: false,
  retryCount: 0,
  cancellable: false,
  recoveryMode: false,
});

function transition(event) {
  switch (event.type) {
    case 'CHECK_STARTED':
      return { phase: 'checking', checking: true, error: '', notice: '', warning: '', progress: null, recoveryMode: false };
    case 'AVAILABLE':
      return { phase: event.downloaded ? 'ready' : 'available', checking: false, info: event.info, error: '', notice: '', retryCount: 0 };
    case 'UP_TO_DATE':
      return { phase: 'idle', checking: false, info: null, error: '', notice: event.message || '', retryCount: 0 };
    case 'DOWNLOAD_STARTED':
      return { phase: 'downloading', progress: { received: 0, total: 0, percent: 0 }, error: '', notice: '', cancellable: true };
    case 'DOWNLOAD_PROGRESS':
      return { progress: event.progress };
    case 'DOWNLOAD_CANCELLED':
      return { phase: 'available', progress: null, cancellable: false, error: '' };
    case 'DOWNLOADED':
      return { phase: 'ready', info: event.info, progress: event.progress, cancellable: false, error: '', notice: '', retryCount: 0 };
    case 'SUPERSEDED':
      return { phase: 'available', info: event.info, progress: null, cancellable: false, warning: '已发现更新的版本，请重新下载。' };
    case 'INSTALL_STARTED':
      return { phase: 'installing', error: '', cancellable: false };
    case 'FAILED':
      return {
        phase: event.recoveryMode ? 'recovering' : event.fallbackPhase || 'idle',
        checking: false,
        cancellable: false,
        error: event.error,
        notice: '',
        recoveryMode: event.recoveryMode === true,
        retryCount: event.retryCount ?? updateStore.retryCount,
      };
    default:
      return {};
  }
}

function dispatch(event) {
  Object.assign(updateStore, transition(event));
}

function clearRetry() {
  if (retryTimer) window.clearTimeout(retryTimer);
  retryTimer = null;
}

function scheduleRetry(action, error, fallbackPhase) {
  const retryCount = updateStore.retryCount + 1;
  if (retryCount > MAX_RETRIES) {
    dispatch({ type: 'FAILED', error, fallbackPhase, recoveryMode: true, retryCount: MAX_RETRIES });
    return false;
  }
  const delay = Math.min(RETRY_BASE_MS * (2 ** (retryCount - 1)), 30_000);
  dispatch({ type: 'FAILED', error: `${error}，${Math.round(delay / 1000)} 秒后重试`, fallbackPhase, retryCount });
  clearRetry();
  retryTimer = window.setTimeout(() => {
    retryTimer = null;
    void action({ automaticRetry: true });
  }, delay);
  return true;
}

function applyAvailable(info, phase = 'available') {
  dispatch({ type: 'AVAILABLE', info: info || null, downloaded: phase === 'ready' });
  if (info) updateStore.dialogOpen = true;
}

export async function checkForUpdate({ openWhenNone = false, automaticRetry = false } = {}) {
  const currentOperation = ++operationId;
  clearRetry();
  updateStore.dialogOpen = true;
  dispatch({ type: 'CHECK_STARTED' });
  try {
    const result = await desktopApi.update.check();
    if (currentOperation !== operationId) return result;
    if (result.info) {
      applyAvailable(result.info, result.downloaded ? 'ready' : 'available');
    } else if (result.error) {
      scheduleRetry(checkForUpdate, '检查更新失败，请稍后重试', 'idle');
    } else {
      dispatch({ type: 'UP_TO_DATE', message: openWhenNone ? '当前已是最新版本' : '' });
    }
    return result;
  } catch (cause) {
    if (currentOperation !== operationId) return { hasUpdate: false, cancelled: true };
    const error = cause?.message || '检查更新失败，请稍后重试';
    scheduleRetry(checkForUpdate, error, 'idle');
    return { hasUpdate: false, downloaded: false, info: null, error };
  } finally {
    if (currentOperation === operationId) updateStore.checking = false;
  }
}

export async function downloadUpdate({ automaticRetry = false } = {}) {
  const currentOperation = ++operationId;
  clearRetry();
  dispatch({ type: 'DOWNLOAD_STARTED' });
  const result = await desktopApi.update.download((progress) => {
    if (currentOperation === operationId) dispatch({ type: 'DOWNLOAD_PROGRESS', progress });
  });
  if (currentOperation !== operationId) return { ok: false, cancelled: true };
  if (!result.ok) {
    if (result.cancelled) dispatch({ type: 'DOWNLOAD_CANCELLED' });
    else scheduleRetry(downloadUpdate, result.error || '下载失败', 'available');
  } else {
    applyAvailable(result.info || updateStore.info, 'ready');
    const fileSize = result.info?.fileSize || updateStore.progress?.total || 0;
    dispatch({
      type: 'DOWNLOADED',
      info: result.info || updateStore.info,
      progress: { received: fileSize, total: fileSize, percent: 100 },
    });
  }
  return result;
}

export async function cancelUpdateDownload() {
  if (updateStore.phase !== 'downloading') return { ok: false, error: '当前没有下载任务' };
  operationId += 1;
  clearRetry();
  const result = await desktopApi.update.cancelDownload();
  dispatch({ type: 'DOWNLOAD_CANCELLED' });
  return result;
}

export async function executeUpdateRestart() {
  clearRetry();
  const freshness = await desktopApi.update.checkFreshness();
  if (freshness.superseded) {
    dispatch({ type: 'SUPERSEDED', info: freshness.info });
    return { ok: false, superseded: true };
  }
  if (freshness.warning) updateStore.warning = '无法确认是否有更新版本，将继续安装已验证的安装包。';
  dispatch({ type: 'INSTALL_STARTED' });
  const result = await desktopApi.update.executeRestart();
  if (!result.ok) {
    dispatch({
      type: 'FAILED', fallbackPhase: 'ready', recoveryMode: true,
      error: result.error || '启动安装失败，请重新下载或使用完整安装包恢复',
    });
  }
  return result;
}
