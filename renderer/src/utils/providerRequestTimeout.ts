export const DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS = 120_000;
export const IMAGE_PROVIDER_REQUEST_TIMEOUT_MS = 900_000;
// 视频提交要上传参考图并等待厂商创建任务，2 分钟在多图场景下过短；
// 任务本身仍受 15 分钟总时限约束，这里只放宽“提交并拿到 taskId”的窗口。
export const VIDEO_PROVIDER_REQUEST_TIMEOUT_MS = 300_000;

export function providerRequestTimeoutMs(taskType: string, requestedTimeoutMs: unknown) {
  const fallback = taskType === 'imageGeneration'
    ? IMAGE_PROVIDER_REQUEST_TIMEOUT_MS
    : taskType === 'videoGeneration'
      ? VIDEO_PROVIDER_REQUEST_TIMEOUT_MS
      : DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS;
  const requested = Number(requestedTimeoutMs);
  const resolved = Number.isFinite(requested) && requested > 0 ? requested : fallback;
  return Math.min(resolved, fallback);
}
