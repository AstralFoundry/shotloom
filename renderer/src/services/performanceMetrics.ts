export interface PerformanceMetric {
  name: string;
  durationMs: number;
  at: string;
  detail?: Record<string, unknown>;
}

const MAX_METRICS = 500;
const metrics: PerformanceMetric[] = [];

export function recordPerformanceMetric(
  name: string,
  startedAt: number,
  detail?: Record<string, unknown>,
): PerformanceMetric {
  const metric = {
    name,
    durationMs: Math.max(0, performance.now() - startedAt),
    at: new Date().toISOString(),
    ...(detail ? { detail } : {}),
  };
  metrics.push(metric);
  if (metrics.length > MAX_METRICS) metrics.splice(0, metrics.length - MAX_METRICS);
  return metric;
}

export function listPerformanceMetrics(name?: string): PerformanceMetric[] {
  return metrics.filter((metric) => !name || metric.name === name).map((metric) => ({
    ...metric,
    ...(metric.detail ? { detail: { ...metric.detail } } : {}),
  }));
}

export function clearPerformanceMetrics(): void {
  metrics.length = 0;
}
