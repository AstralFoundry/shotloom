import { badRequest } from './errors';

// Only gateway relay namespaces may receive the user's OAuth credential.
export function relayPath(path: string, provider: string, scope: string): string {
  if (!path.startsWith('/') || path.startsWith('//') || /[\\?#%\x00-\x20]/.test(path)
    || path.split('/').some(part => part === '.' || part === '..')) throw badRequest('转发路径无效');
  const roots: Record<string, string> = { bytedance: '/api/v3', kling: '/kling/v1', minimax: '/hailuo' };
  const prefix = scope === 'origin' ? '' : scope === 'root' ? roots[provider] || '/v1' : '/v1';
  const target = path.startsWith(`${prefix}/`) ? path : `${prefix}${path}`;
  if (!/^\/(?:v1\/|v1beta\/models(?:\/|$)|api\/v3\/(?:contents\/generations\/tasks|images\/generations)(?:\/|$)|kling\/v1\/videos\/)/.test(target)
    && !/^\/hailuo\/v[12]\/(?:video_generation|query\/video_generation(?:\/[^/]+)?|files\/retrieve)$/.test(target)) {
    throw badRequest('此接口不属于可用的 new-api 转发协议');
  }
  return target;
}
