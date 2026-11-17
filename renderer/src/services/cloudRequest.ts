import { cloudOrigin } from '../utils/cloudConfig';
export { cloudEnabled, cloudOrigin } from '../utils/cloudConfig';

// Keep an open workspace bound to its original account across login recovery.
let sessionUserId: string | undefined;
export function bindCloudUser(id: string): boolean {
  if (sessionUserId && sessionUserId !== id) return false;
  sessionUserId = id;
  return true;
}
export function cloudUserHeaders(): Record<string, string> {
  return sessionUserId ? { 'x-shotloom-user': sessionUserId } : {};
}

export async function cloudRequest<T>(path: string, method = 'GET', value?: unknown): Promise<T> {
  const response = await fetch(`${cloudOrigin}/api${path}`, {
    method, credentials: 'include',
    headers: { ...cloudUserHeaders(), ...(value === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
  const result = await response.json() as { success: boolean; message: string; data: T };
  if (response.status === 401 && typeof window !== 'undefined') window.dispatchEvent(new Event('shotloom-session-expired'));
  if (response.status === 409 && (result as { code?: string }).code === 'ACCOUNT_CHANGED' && typeof window !== 'undefined') window.dispatchEvent(new Event('shotloom-session-expired'));
  if (!response.ok || !result.success) throw Object.assign(new Error(result.message || `HTTP ${response.status}`), { status: response.status });
  if (method !== 'GET' && typeof window !== 'undefined' && new URLSearchParams(window.location?.search).get('native') === 'embedded') window.ReactNativeWebView?.postMessage(JSON.stringify({ type: 'workspace-mutated' }));
  return result.data;
}
