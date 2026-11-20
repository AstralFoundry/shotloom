// Internal display data only; authentication and execution checks never use this cache.
import { createHash } from 'node:crypto';
import { cacheResult, sharedRead } from './requestMetrics';
export function userReadKey(user: string, session: string, token: string) {
  return `user:${user}:${session}:${createHash('sha256').update(token).digest('hex')}:`;
}
const reads = new Map<string, { promise: Promise<unknown>; expires: number }>();
export function invalidateReads(prefix: string) {
  for (const key of reads.keys()) if (key.startsWith(prefix)) reads.delete(key);
}
export function cachedRead<T>(key: string, ttlMs: number, load: () => Promise<T>, force = false): Promise<T> {
  const cached = reads.get(key);
  if (!force && cached && cached.expires > Date.now()) { cacheResult(true); return cached.promise as Promise<T>; }
  cacheResult(false);
  if (reads.size >= 256) reads.delete(reads.keys().next().value!);
  const entry = { promise: undefined as unknown as Promise<T>, expires: Infinity };
  entry.promise = Promise.resolve().then(() => sharedRead(load)).then(value => {
    if (reads.get(key) === entry) entry.expires = Date.now() + ttlMs;
    return value;
  }).catch(error => {
    if (reads.get(key) === entry) reads.delete(key);
    throw error;
  });
  reads.set(key, entry);
  return entry.promise;
}
