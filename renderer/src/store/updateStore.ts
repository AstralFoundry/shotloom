import { t } from '../i18n/index.ts';
import { reactive } from '@/store/domainReactivity';
import { desktopApi } from '@/services/desktopApi';

// 更新事件与回执来自 Rust 侧，字段按调用场景变化，因此事件与结果按 AnyRecord 处理。
type AnyRecord = Record<string, any>;

interface UpdateProgress {
  received: number;
  total: number;
  percent: number;
}

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 2_000;
let operationId = 0;
let retryTimer: number | null = null;

export const updateStore = reactive({
  phase: 'idle',
  info: null as AnyRecord | null,
  progress: null as UpdateProgress | null,
  error: '',
  notice: '',
  warning: '',
  dialogOpen: false,
  checking: false,
  retryCount: 0,
  cancellable: false,
  recoveryMode: false,
});

function transition(event: AnyRecord): AnyRecord {
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
      return { phase: 'available', info: event.info, progress: null, cancellable: false, warning: t("ui.updateStore.text.543c1a43") };
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

function dispatch(event: AnyRecord) {
  Object.assign(updateStore, transition(event));
}

function clearRetry() {
  if (retryTimer) window.clearTimeout(retryTimer);
  retryTimer = null;
}

function scheduleRetry(
  action: (options?: AnyRecord) => Promise<AnyRecord>,
  error: string,
  fallbackPhase: string,
) {
  const retryCount = updateStore.retryCount + 1;
  if (retryCount > MAX_RETRIES) {
    dispatch({ type: 'FAILED', error, fallbackPhase, recoveryMode: true, retryCount: MAX_RETRIES });
    return false;
  }
  const delay = Math.min(RETRY_BASE_MS * (2 ** (retryCount - 1)), 30_000);
  dispatch({ type: 'FAILED', error: t("ui.updateStore.text.6447c966", { value0: String(error), value1: String(Math.round(delay / 1000)) }), fallbackPhase, retryCount });
  clearRetry();
  retryTimer = window.setTimeout(() => {
    retryTimer = null;
    void action({ automaticRetry: true });
  }, delay);
  return true;
}

function applyAvailable(info: AnyRecord | null | undefined, phase = 'available') {
  dispatch({ type: 'AVAILABLE', info: info || null, downloaded: phase === 'ready' });
  if (info) updateStore.dialogOpen = true;
}

export async function checkForUpdate({
  openWhenNone = false,
}: { openWhenNone?: boolean; automaticRetry?: boolean } = {}): Promise<AnyRecord> {
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
      scheduleRetry(checkForUpdate, t("ui.updateStore.text.05c77d3e"), 'idle');
    } else {
      dispatch({ type: 'UP_TO_DATE', message: openWhenNone ? t("ui.updateStore.text.db620f17") : '' });
    }
    return result;
  } catch (cause) {
    if (currentOperation !== operationId) return { hasUpdate: false, cancelled: true };
    const error = cause instanceof Error ? cause.message || '' : '';
    scheduleRetry(checkForUpdate, error || t("ui.updateStore.text.05c77d3e"), 'idle');
    return { hasUpdate: false, downloaded: false, info: null, error: error || t("ui.updateStore.text.05c77d3e") };
  } finally {
    if (currentOperation === operationId) updateStore.checking = false;
  }
}

export async function downloadUpdate(): Promise<AnyRecord> {
  const currentOperation = ++operationId;
  clearRetry();
  dispatch({ type: 'DOWNLOAD_STARTED' });
  const result = await desktopApi.update.download((progress: UpdateProgress) => {
    if (currentOperation === operationId) dispatch({ type: 'DOWNLOAD_PROGRESS', progress });
  });
  if (currentOperation !== operationId) return { ok: false, cancelled: true };
  if (!result.ok) {
    if (result.cancelled) dispatch({ type: 'DOWNLOAD_CANCELLED' });
    else scheduleRetry(downloadUpdate, result.error || t("ui.updateStore.text.e0dab22b"), 'available');
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
  if (updateStore.phase !== 'downloading') return { ok: false, error: t("ui.updateStore.text.e6f31f7e") };
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
  if (freshness.warning) updateStore.warning = t("ui.updateStore.text.7d066d15");
  dispatch({ type: 'INSTALL_STARTED' });
  const result = await desktopApi.update.executeRestart();
  if (!result.ok) {
    dispatch({
      type: 'FAILED', fallbackPhase: 'ready', recoveryMode: true,
      error: result.error || t("ui.updateStore.text.d5b1f890"),
    });
  }
  return result;
}
