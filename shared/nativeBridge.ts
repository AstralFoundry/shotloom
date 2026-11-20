// Native screens and legacy WebView bridges share this user-facing API boundary.
export function nativeRequestAllowed(method: string, path: string): boolean {
  const [pathname, query] = path.split('?');
  if (!pathname || path.includes('#') || path.includes('\\')) return false;
  const queryKeys = pathname === '/projects/page' ? ['folder','search','sort','offset','limit'] : pathname === '/catalog/skills/page' ? ['search','sort','offset','limit'] : pathname === '/auth/usage' ? ['page', 'page_size'] : ['/feedback', '/notifications'].includes(pathname) ? ['offset', 'limit', 'kind', 'status'] : [];
  if (query && [...new URLSearchParams(query).keys()].some(key => !queryKeys.includes(key))) return false;
  const uuid = '[0-9a-fA-F-]{36}';
  if (method === 'GET') return ['/auth/me', '/auth/account', '/auth/usage', '/auth/topup/options', '/projects', '/projects/page', '/library-folders', '/catalog/skills', '/feedback', '/notifications', '/notifications/unread', '/settings/mobile', '/models'].includes(pathname)
    || new RegExp(`^/(feedback|project)/${uuid}$`).test(pathname) || new RegExp(`^/project/${uuid}/summary$`).test(pathname)
    || ['/catalog/skills/page','/catalog/skills/versioned'].includes(pathname) || /^\/catalog\/skills\/item\/[^/]+$/.test(pathname);
  if (method === 'POST') return ['/feedback', '/auth/logout', '/auth/topup', '/library-folders'].includes(pathname);
  if (method === 'PATCH') return ['/settings/mobile','/catalog/skills'].includes(pathname) || new RegExp(`^/(library-folders|project)/${uuid}$`).test(pathname);
  if (method === 'DELETE') return new RegExp(`^/(project|library-folders)/${uuid}$`).test(pathname);
  return method === 'PUT' && (pathname === '/catalog/skills' || pathname === '/notifications/read-all' || new RegExp(`^/project/${uuid}$`).test(pathname) || new RegExp(`^/notifications/${uuid}/read$`).test(pathname));
}
export type NativeRequest = { id: string; method: string; path: string; value?: unknown; force?: boolean };
export type NativeReply = { type: 'response'; id: string; data?: unknown; error?: string; status?: number };
