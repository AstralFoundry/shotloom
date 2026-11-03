import { t } from '../i18n/index.ts';
export function normalizeRemoteStatus(status: unknown = '') {
  const value = String(status || '').toLowerCase();
  if (['succeeded', 'success', 'done'].includes(value)) return 'completed';
  if (['failure', 'fail'].includes(value)) return 'failed';
  if (['queued', 'pending'].includes(value)) return 'queued';
  if (['processing', 'generating'].includes(value)) return 'running';
  return value || 'running';
}

export function formatRemoteTaskError(error: unknown = ''): string {
  const message =
    typeof error === 'string'
      ? error
      : (error as { message?: string } | null)?.message || JSON.stringify(error || '');
  if (message.includes('RPC Internal Error') || message.includes('algo_code":100402')) {
    return t("model.task.videoAlgorithmFailed");
  }
  return message;
}
