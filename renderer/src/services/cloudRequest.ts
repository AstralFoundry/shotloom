import { cloudOrigin } from '../utils/cloudConfig';
import { recordPerformanceMetric } from './performanceMetrics';
import { clearSignedMedia } from '../utils/mediaFileUrl';
export { cloudEnabled, cloudOrigin } from '../utils/cloudConfig';

// Keep an open workspace bound to its original account across login recovery.
let sessionUserId: string | undefined;
let sessionExpired = false;
let sessionCheck: Promise<void> | undefined;
let sessionVersion = 0;
const readEpochs = new Map<string, number>();
const reads = new Map<string, Promise<unknown>>();
const summaries = new Map<string, {data: unknown; expires: number}>();
function requestScope(path: string) {
  const [root, id] = path.split('?')[0]!.slice(1).split('/');
  return root === 'project' || root === 'catalog' ? `${root}/${id}` : root === 'library-folders' || root === 'projects' ? 'projects' : root === 'auth' ? 'auth' : root!;
}
function invalidateRequestReads(path: string) {
  const scopes = [requestScope(path), ...(path.startsWith('/project/') ? ['projects'] : [])];
  for (const scope of scopes) readEpochs.set(scope, (readEpochs.get(scope) || 0) + 1);
  for (const key of reads.keys()) if (scopes.includes(JSON.parse(key)[1])) reads.delete(key);
  for (const key of summaries.keys()) if (scopes.includes(JSON.parse(key)[1])) summaries.delete(key);
}
type CloudUser = { id: string; username?: string; email?: string };
let sessionRead: Promise<CloudUser> | undefined;
let cachedSession: { user: CloudUser; expires: number } | undefined;
const hintKey = `shotloom:session-user:${cloudOrigin}`;
// A tab-local user ID is only a display hint; HttpOnly cookies still authorize every request.
export function readCloudUserHint(): string | undefined {
  try { return window.sessionStorage.getItem(hintKey) || undefined; } catch { return; }
}
function rememberCloudUser(id?: string) {
  try {
    if (id) window.sessionStorage.setItem(hintKey, id);
    else window.sessionStorage.removeItem(hintKey);
  } catch { /* Storage restrictions must not block session recovery. */ }
}
export function bindCloudUser(id: string, recovered = false): boolean {
  if (sessionUserId && sessionUserId !== id) return false;
  if (sessionUserId === id && !sessionExpired && !recovered) return true;
  sessionUserId = id;
  sessionExpired = false;
  sessionVersion++;
  clearSignedMedia();
  reads.clear();
  summaries.clear();
  sessionCheck = undefined;
  sessionRead = undefined;
  return true;
}
export function cloudUserHeaders(): Record<string, string> {
  return sessionUserId ? { 'x-shotloom-user': sessionUserId } : {};
}

function expireSession() {
  if (sessionExpired || typeof window === 'undefined') return;
  sessionExpired = true;
  summaries.clear();
  clearSignedMedia();
  cachedSession = undefined;
  rememberCloudUser();
  window.dispatchEvent(new Event('shotloom-session-expired'));
}

export function readCloudSession(force = false): Promise<CloudUser> {
  if (sessionRead) return sessionRead;
  if (!force && !sessionExpired && cachedSession && cachedSession.expires > Date.now()) return Promise.resolve(cachedSession.user);
  const version = sessionVersion;
  const read = (async () => {
    const response = await fetch(`${cloudOrigin}/api/auth/me`, {
      credentials: 'include', headers: cloudUserHeaders(), signal: AbortSignal.timeout(15000),
    });
    const result = await response.json();
    if (!response.ok || !result.success || typeof result.data?.id !== 'string') {
      throw Object.assign(new Error(result.message || `HTTP ${response.status}`), { status: response.status, code: result.code });
    }
    if (sessionUserId && result.data.id !== sessionUserId) throw Object.assign(new Error('Account changed'), { status: 409, code: 'ACCOUNT_CHANGED' });
    if (version === sessionVersion) {
      cachedSession = { user: result.data, expires: Date.now() + 30000 };
      rememberCloudUser(result.data.id);
    }
    return result.data as CloudUser;
  })().catch(error => {
    if (version === sessionVersion && (error.status === 401 || error.code === 'ACCOUNT_CHANGED')) expireSession();
    throw error;
  }).finally(() => { if (sessionRead === read) sessionRead = undefined; });
  sessionRead = read;
  return read;
}

export function verifyCloudSession(): Promise<void> {
  if (sessionCheck) return sessionCheck;
  const version = sessionVersion;
  const check = (async () => {
    try {
      await readCloudSession(true);
    } catch (cause) {
      const error = cause as { status?: number; code?: string };
      if (version === sessionVersion && (error.status === 401 || error.code === 'ACCOUNT_CHANGED')) expireSession();
      // An unavailable auth endpoint does not prove the session expired.
    }
  })().finally(() => { if (sessionCheck === check) sessionCheck = undefined; });
  sessionCheck = check;
  return check;
}

export type CloudRequestOptions = { signal?: AbortSignal; timeoutMs?: number; force?: boolean; cacheMs?: number };
export function cloudRequest<T>(path: string, method = 'GET', value?: unknown, options: CloudRequestOptions = {}): Promise<T> {
  const version = sessionVersion;
  if (method !== 'GET') invalidateRequestReads(path);
  const scope = requestScope(path), epoch = readEpochs.get(scope) || 0;
  const key = JSON.stringify([version, scope, epoch, path]);
  const cache = method === 'GET' && Boolean(options.cacheMs);
  if (options.force) summaries.delete(key);
  const saved = cache && !options.force && !options.signal?.aborted && summaries.get(key);
  if (saved && saved.expires > Date.now()) return Promise.resolve(structuredClone(saved.data) as T);
  const share = method === 'GET' && !options.signal && !options.force;
  const pending = share && reads.get(key);
  if (pending) return pending as Promise<T>;
  const started = performance.now();
  const request = (async () => {
    const timeout = method === 'GET' ? AbortSignal.timeout(options.timeoutMs ?? 15000) : undefined;
    const signal = timeout && options.signal ? AbortSignal.any([timeout, options.signal]) : timeout || options.signal;
    const response = await fetch(`${cloudOrigin}/api${path}`, {
      method, credentials: 'include', ...(signal ? { signal } : {}),
      headers: { ...cloudUserHeaders(), ...(options.force ? { 'Cache-Control': 'no-cache' } : {}), ...(value === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(value === undefined ? {} : { body: JSON.stringify(value) }),
    });
    const result = await response.json() as { success: boolean; message: string; code?: string; data: T };
    const resource = performance.getEntriesByName(response.url || `${cloudOrigin}/api${path}`).at(-1) as PerformanceResourceTiming | undefined;
    recordPerformanceMetric('cloud-request', started, { method, path: path.split('?')[0], status: response.status, requestId: response.headers.get('x-request-id'), serverTiming: response.headers.get('server-timing'), encodedBytes: resource?.encodedBodySize, decodedBytes: resource?.decodedBodySize, transferBytes: resource?.transferSize });
    if (version === sessionVersion && response.status === 401) {
      if (path === '/auth/me') expireSession();
      else {
        const verification = verifyCloudSession();
        if (signal) await new Promise<void>((resolve, reject) => {
          const abort = () => reject(signal.reason);
          if (signal.aborted) return abort();
          signal.addEventListener('abort', abort, { once: true });
          verification.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
        });
        else await verification;
      }
    }
    if (version === sessionVersion && response.status === 409 && result.code === 'ACCOUNT_CHANGED') expireSession();
    if (version === sessionVersion && path === '/auth/me' && response.ok && result.success) sessionExpired = false;
    if (!response.ok || !result.success) throw Object.assign(new Error(result.message || `HTTP ${response.status}`), { status: response.status, code: result.code });
    if (method === 'GET' && (version !== sessionVersion || epoch !== (readEpochs.get(scope) || 0))) throw Object.assign(new Error('Read invalidated; refresh to load current data'), { code: 'STALE_RESPONSE' });
    if (cache) {
      if (summaries.size >= 64) summaries.delete(summaries.keys().next().value!);
      summaries.set(key, {data: structuredClone(result.data), expires: Date.now() + options.cacheMs!});
    }
    if (path === '/auth/logout') { rememberCloudUser(); cachedSession = undefined; reads.clear(); summaries.clear(); clearSignedMedia(); }
    if (method !== 'GET' && typeof window !== 'undefined' && new URLSearchParams(window.location?.search).get('native') === 'embedded') window.ReactNativeWebView?.postMessage(JSON.stringify({ type: 'workspace-mutated', path }));
    return result.data;
  })().finally(() => {
    if (reads.get(key) === request) reads.delete(key);
    if (method !== 'GET') invalidateRequestReads(path);
  });
  if (share) reads.set(key, request);
  return request;
}
