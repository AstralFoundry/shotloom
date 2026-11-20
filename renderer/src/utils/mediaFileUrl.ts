import { convertFileSrc } from '@tauri-apps/api/core';
import { cloudEnabled, cloudOrigin } from './cloudConfig';
const signedMedia = new Map<string, { url: string; expires: number }>();
export function clearSignedMedia() { signedMedia.clear(); }
export function rememberSignedMedia(path: string, url: string) {
  if (signedMedia.size >= 500) signedMedia.delete(signedMedia.keys().next().value!);
  signedMedia.set(path, { url, expires: Date.now() + 120000 });
}
export function cachedSignedMedia(path: string): string | undefined {
  const signed = signedMedia.get(path);
  return signed && signed.expires > Date.now() ? signed.url : undefined;
}

/** Persist the bucket/key reference; resolve a fresh private URL for playback. */
export function mediaFileUrl(path: string): string {
  if (path.startsWith('cloud://')) {
    const signed = cachedSignedMedia(path);
    if (signed) return signed;
    const source = new URL(path);
    return `${cloudOrigin}/api/files/content?bucket=${encodeURIComponent(source.hostname)}&key=${encodeURIComponent(source.pathname.slice(1))}`;
  }
  if (cloudEnabled && /^https?:/.test(path)) return `${cloudOrigin}/api/files/remote?url=${encodeURIComponent(path)}`;
  if (/^(https?:|blob:|data:)/.test(path)) return path;
  return convertFileSrc(path);
}
