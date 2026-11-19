import { cloudOrigin } from '../utils/cloudConfig';
export { cloudEnabled, cloudOrigin } from '../utils/cloudConfig';

// Keep an open workspace bound to its original account across login recovery.
let sessionUserId: string | undefined;
let sessionExpired = false;
let sessionCheck: Promise<void> | undefined;
let sessionVersion = 0;
type CloudUser = { id: string; username?: string; email?: string };
let sessionRead: Promise<CloudUser> | undefined;
let cachedSession: { user: CloudUser; expires: number } | undefined;
export function bindCloudUser(id: string): boolean {
  if (sessionUserId && sessionUserId !== id) return false;
  sessionUserId = id;
  sessionExpired = false;
  sessionVersion++;
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
  cachedSession = undefined;
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
    if (version === sessionVersion) cachedSession = { user: result.data, expires: Date.now() + 30000 };
    return result.data as CloudUser;
  })().finally(() => { if (sessionRead === read) sessionRead = undefined; });
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

export async function cloudRequest<T>(path: string, method = 'GET', value?: unknown): Promise<T> {
  const version = sessionVersion;
  const response = await fetch(`${cloudOrigin}/api${path}`, {
    method, credentials: 'include',
    headers: { ...cloudUserHeaders(), ...(value === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
  const result = await response.json() as { success: boolean; message: string; data: T };
  if (version === sessionVersion && response.status === 401) {
    if (path === '/auth/me') expireSession();
    else await verifyCloudSession();
  }
  if (version === sessionVersion && response.status === 409 && (result as { code?: string }).code === 'ACCOUNT_CHANGED') expireSession();
  if (version === sessionVersion && path === '/auth/me' && response.ok && result.success) sessionExpired = false;
  if (!response.ok || !result.success) throw Object.assign(new Error(result.message || `HTTP ${response.status}`), { status: response.status });
  if (method !== 'GET' && typeof window !== 'undefined' && new URLSearchParams(window.location?.search).get('native') === 'embedded') window.ReactNativeWebView?.postMessage(JSON.stringify({ type: 'workspace-mutated', path }));
  return result.data;
}
