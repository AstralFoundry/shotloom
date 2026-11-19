// Native screens and legacy WebView bridges share this user-facing API boundary.
export function nativeRequestAllowed(method: string, path: string): boolean {
  const [pathname, query] = path.split('?');
  if (!pathname || path.includes('#') || path.includes('\\')) return false;
  const queryKeys = pathname === '/auth/usage' ? ['page', 'page_size'] : ['/feedback', '/notifications'].includes(pathname) ? ['offset', 'limit', 'kind', 'status'] : [];
  if (query && [...new URLSearchParams(query).keys()].some(key => !queryKeys.includes(key))) return false;
  const uuid = '[0-9a-fA-F-]{36}';
  if (method === 'GET') return ['/auth/me', '/auth/account', '/auth/usage', '/projects', '/library-folders', '/catalog/skills', '/feedback', '/notifications', '/settings/mobile', '/models'].includes(pathname)
    || new RegExp(`^/feedback/${uuid}$`).test(pathname);
  if (method === 'POST') return ['/feedback', '/auth/logout', '/library-folders'].includes(pathname);
  if (method === 'PATCH') return pathname === '/settings/mobile';
  return method === 'PUT' && (pathname === '/catalog/skills' || pathname === '/notifications/read-all' || new RegExp(`^/notifications/${uuid}/read$`).test(pathname));
}
export type NativeRequest = { id: string; method: string; path: string; value?: unknown };
export type NativeReply = { type: 'response'; id: string; data?: unknown; error?: string; status?: number };
