// Native screens can only access the user-facing APIs through the authenticated WebView.
export function nativeRequestAllowed(method: string, path: string): boolean {
  const [pathname, query] = path.split('?');
  if (!pathname || path.includes('#') || path.includes('\\')) return false;
  if (query && [...new URLSearchParams(query).keys()].some(key => !['offset', 'limit', 'kind', 'status'].includes(key))) return false;
  const uuid = '[0-9a-fA-F-]{36}';
  if (method === 'GET') return ['/auth/me', '/projects', '/feedback', '/notifications'].includes(pathname)
    || new RegExp(`^/feedback/${uuid}$`).test(pathname);
  if (method === 'POST') return pathname === '/feedback' || pathname === '/auth/logout';
  return method === 'PUT' && (pathname === '/notifications/read-all' || new RegExp(`^/notifications/${uuid}/read$`).test(pathname));
}
export type NativeRequest = { id: string; method: string; path: string; value?: unknown };
export type NativeReply = { type: 'response'; id: string; data?: unknown; error?: string; status?: number };
