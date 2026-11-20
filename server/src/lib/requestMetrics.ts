import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from './types';

const requests = new AsyncLocalStorage<{ timings: Map<string, number>; hits: number; misses: number; force: boolean; signal: AbortSignal; deadline: number; ended: boolean }>();
export function cacheResult(hit: boolean) { const context = requests.getStore(); if (context) { if (hit) context.hits++; else context.misses++; } }
export function forceRead() { return requests.getStore()?.force ?? false; }
export function requestSignal() { const context=requests.getStore(); return context?.ended ? undefined : context?.signal; }
// Shared reads keep the original deadline, while an individual HTTP disconnect only cancels its caller.
export function sharedRead<T>(read: () => T): T {
  const parent = requests.getStore(), context = parent?.ended ? undefined : parent;
  const deadline = context?.deadline ?? Date.now() + 15000;
  return requests.run({ timings: new Map(), hits: 0, misses: 0, force: false, ...context, deadline, ended: false,
    signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) }, read);
}
export async function timed<T>(name: string, read: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try { return await read(); }
  finally {
    const context = requests.getStore();
    if (context) context.timings.set(name, (context.timings.get(name) || 0) + performance.now() - started);
  }
}
export const requestMetrics: MiddlewareHandler<AppEnv> = async (c, next) => {
  const started = performance.now(), id = randomUUID();
  c.header('X-Request-Id', id);
  const signal = c.req.method === 'GET' && !c.req.path.startsWith('/api/agent/') && !c.req.path.startsWith('/api/relay/')
    ? AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(15000)]) : c.req.raw.signal;
  await requests.run({ timings: new Map(), hits: 0, misses: 0, force: /(?:^|,)\s*no-cache\b/i.test(c.req.header('cache-control') || ''), signal, deadline: Date.now() + 15000, ended: false }, async () => {
    try { await next(); }
    finally {
      requests.getStore()!.ended = true;
      const duration = performance.now() - started;
      const metrics = [...requests.getStore()!.timings].map(([name, ms]) => `${name};dur=${ms.toFixed(1)}`);
      const { hits, misses } = requests.getStore()!;
      metrics.push(`cache;desc="hit=${hits} miss=${misses}"`);
      c.header('Server-Timing', [...metrics, `total;dur=${duration.toFixed(1)}`].join(', '), { append: true });
      if (process.env.NODE_ENV !== 'test') {
        const entry = { requestId: id, method: c.req.method, route: c.req.routePath, status: c.res.status, durationMs: Math.round(duration), cacheHits: hits, cacheMisses: misses };
        if (c.res.body && c.res.headers.get('content-type')?.includes('application/json')) {
          let bytes = 0;
          const stream = c.res.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) { bytes += chunk.byteLength; controller.enqueue(chunk); },
            flush() { console.log(JSON.stringify({ ...entry, bytes })); },
          }));
          c.res = new Response(stream, { status: c.res.status, headers: c.res.headers });
        } else console.log(JSON.stringify({ ...entry, bytes: c.res.headers.get('content-length') }));
      }
    }
  });
};
