export const DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS = 120_000;
export const IMAGE_PROVIDER_REQUEST_TIMEOUT_MS = 900_000;

export function providerRequestTimeoutMs(taskType, requestedTimeoutMs) {
  const isImage = taskType === 'imageGeneration';
  const fallback = isImage
    ? IMAGE_PROVIDER_REQUEST_TIMEOUT_MS
    : DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS;
  const requested = Number(requestedTimeoutMs);
  const resolved = Number.isFinite(requested) && requested > 0 ? requested : fallback;
  return Math.min(resolved, fallback);
}
