export function normalizeRemoteStatus(status = '') {
  const value = String(status || '').toLowerCase();
  if (['succeeded', 'success', 'done'].includes(value)) return 'completed';
  if (['failure', 'fail'].includes(value)) return 'failed';
  if (['queued', 'pending'].includes(value)) return 'queued';
  if (['processing', 'generating'].includes(value)) return 'running';
  return value || 'running';
}

export function formatRemoteTaskError(error = '') {
  const message = typeof error === 'string' ? error : error?.message || JSON.stringify(error || '');
  if (message.includes('RPC Internal Error') || message.includes('algo_code":100402')) {
    return '上游视频算法服务内部异常（algo_code 100402）：请求参数已通过校验，但服务执行失败；本次任务已终止，可稍后重试';
  }
  return message;
}
