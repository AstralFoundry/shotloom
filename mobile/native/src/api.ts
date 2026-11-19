import { nativeRequestAllowed, type NativeReply, type NativeRequest } from '../../../shared/nativeBridge';

export class NativeApi {
  private cache = new Map<string, { value: unknown; expires: number }>();
  private reads = new Map<string, Promise<unknown>>();
  private pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private suspended = false;
  private queued = new Map<string, NativeRequest>();
  constructor(private send: (request: NativeRequest) => void, private uuid: () => string) {}
  cached<T>(path: string): T | undefined { return this.cache.get(path)?.value as T | undefined; }
  setCached<T>(path: string, value: T) {
    this.reads.delete(path);
    if (!this.cache.has(path) && this.cache.size >= 64) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(path, { value, expires: Date.now() + 60000 });
  }
  invalidate(paths?: string[]) {
    for (const key of new Set([...this.cache.keys(), ...this.reads.keys()])) {
      const path = key.split('?')[0]!;
      if (!paths || paths.some(prefix => path === prefix || path.startsWith(`${prefix}/`))) {
        this.cache.delete(key); this.reads.delete(key);
      }
    }
  }
  invalidateWrite(path: string) {
    if (path.startsWith('/notifications/')) this.invalidate(['/notifications']);
    else if (path === '/feedback') this.invalidate(['/feedback', '/notifications']);
    else if (path === '/library-folders') this.invalidate(['/library-folders', '/projects']);
    else if (path.startsWith('/project/')) this.invalidate(['/projects']);
    else if (path === '/catalog/skills' || path === '/settings/mobile') this.invalidate([path]);
    else this.invalidate();
  }
  read<T>(path: string, force = false): Promise<T> {
    const cached = this.cache.get(path);
    if (path !== '/auth/me' && !force && cached && cached.expires > Date.now()) return Promise.resolve(cached.value as T);
    const pending = this.reads.get(path);
    if (pending) return pending as Promise<T>;
    const request = this.request<T>(path).then(value => {
      if (this.reads.get(path) === request) {
        if (this.cache.size >= 64) this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(path, { value, expires: Date.now() + 60000 });
      }
      return value;
    }).finally(() => { if (this.reads.get(path) === request) this.reads.delete(path); });
    this.reads.set(path, request);
    return request;
  }
  request<T>(path: string, method = 'GET', value?: unknown): Promise<T> {
    if (!nativeRequestAllowed(method, path)) return Promise.reject(new Error('Request is unavailable'));
    if (method !== 'GET') this.invalidateWrite(path);
    const id = this.uuid();
    const response = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); this.queued.delete(id); reject(new Error('Connection timed out. Please retry.')); }, 30000);
      this.pending.set(id, { resolve: result => resolve(result as T), reject, timer });
      const request = { id, method, path, ...(value === undefined ? {} : { value }) };
      if (this.suspended) this.queued.set(id, request); else this.dispatch(request);
    });
    return method === 'GET' ? response : response.finally(() => this.invalidateWrite(path));
  }
  receive(reply: NativeReply) {
    this.queued.delete(reply.id);
    const pending = this.pending.get(reply.id);
    if (!pending) return false;
    clearTimeout(pending.timer); this.pending.delete(reply.id);
    if (reply.error) pending.reject(Object.assign(new Error(reply.error), { status: reply.status }));
    else pending.resolve(reply.data);
    return true;
  }
  private dispatch(request: NativeRequest) {
    try { this.send(request); }
    catch (error) { this.receive({ type: 'response', id: request.id, error: error instanceof Error ? error.message : String(error) }); }
  }
  pause() { this.suspended = true; this.disconnect(); }
  resume() {
    this.suspended = false;
    const queued = [...this.queued.values()]; this.queued.clear();
    for (const request of queued) if (this.pending.has(request.id)) this.dispatch(request);
  }
  disconnect() {
    for (const [id] of this.pending) this.receive({ type: 'response', id, error: 'Connection interrupted. Please retry.' });
  }
}

export async function nativeFetch<T>(origin: string, path: string, method = 'GET', value?: unknown, token?: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(`${origin}/api${path}`, {
      method, credentials: 'omit', signal: controller.signal,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(value === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(value === undefined ? {} : { body: JSON.stringify(value) }),
    });
    const result = await response.json();
    if (!response.ok || result.success !== true) throw Object.assign(new Error(result.message || `HTTP ${response.status}`), { status: response.status, code: result.code });
    return result.data as T;
  } finally { clearTimeout(timer); }
}

export function createNativeApi(origin: string, token: string, uuid: () => string, expired: () => void): NativeApi {
  const api = new NativeApi(request => {
    void nativeFetch(origin, request.path, request.method, request.value, token)
      .then(data => api.receive({ type: 'response', id: request.id, data }))
      .catch(error => {
        if (!api.receive({ type: 'response', id: request.id, error: error.message, status: error.status })) return;
        if (error.code === 'ACCOUNT_CHANGED' || (error.status === 401 && request.path === '/auth/me')) expired();
        // An upstream service can reject its token while the application session is still valid.
        else if (error.status === 401) void api.read('/auth/me').catch(() => {});
      });
  }, uuid);
  return api;
}
