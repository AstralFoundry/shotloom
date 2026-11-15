import { convertFileSrc } from '@tauri-apps/api/core';
import { cloudEnabled, cloudOrigin } from './cloudConfig';

/** Persist the bucket/key reference; resolve a fresh private URL for playback. */
export function mediaFileUrl(path: string): string {
  if (path.startsWith('cloud://')) {
    const source = new URL(path);
    return `${cloudOrigin}/api/files/content?bucket=${encodeURIComponent(source.hostname)}&key=${encodeURIComponent(source.pathname.slice(1))}`;
  }
  if (cloudEnabled && /^https?:/.test(path)) return `${cloudOrigin}/api/files/remote?url=${encodeURIComponent(path)}`;
  if (/^(https?:|blob:|data:)/.test(path)) return path;
  return convertFileSrc(path);
}
