import { desktopApi } from '@/services/desktopApi';
import type { JsonObject } from '../core/types';

/**
 * 附件到"模型可直接引用的图片"的唯一解析路径。
 *
 * 两个引擎必须看到同一份素材：本地文件统一读成 data URL，远程地址原样保留，
 * 读不出来的本地文件直接失败而不是静默丢掉，否则模型会在回执里声称看到了并不存在的图。
 */
export interface ResolvedImageAttachment {
  mime: string;
  filename: string;
  url: string;
}

function attachmentString(attachment: JsonObject, ...keys: string[]) {
  for (const key of keys) {
    const value = attachment[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function attachmentMime(attachment: JsonObject) {
  const declared = attachmentString(attachment, 'mimeType', 'mime');
  if (declared) return declared;
  const source = attachmentString(attachment, 'fileName', 'name', 'filePath', 'path', 'url').toLowerCase();
  const extensionMimes: Record<string, string> = {
    '.avif': 'image/avif', '.gif': 'image/gif', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg',
    '.png': 'image/png', '.webp': 'image/webp',
  };
  return Object.entries(extensionMimes).find(([extension]) => source.split(/[?#]/)[0].endsWith(extension))?.[1] || '';
}

function arrayBufferDataUrl(buffer: ArrayBuffer, mime: string) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

export async function resolveImageAttachments(attachments: JsonObject[] = []): Promise<ResolvedImageAttachment[]> {
  const resolved: ResolvedImageAttachment[] = [];
  for (const attachment of attachments) {
    const mime = attachmentMime(attachment);
    if (!mime.startsWith('image/')) continue;
    const filename = attachmentString(attachment, 'fileName', 'name') || 'attachment';
    const remoteUrl = attachmentString(attachment, 'url');
    if (/^(?:data:|https?:\/\/)/i.test(remoteUrl)) {
      resolved.push({ mime, filename, url: remoteUrl });
      continue;
    }
    const filePath = attachmentString(attachment, 'filePath', 'path');
    if (!filePath) continue;
    const buffer = await desktopApi.file.readArrayBuffer(filePath);
    if (!buffer?.byteLength) throw new Error(`无法读取附件：${filename}`);
    resolved.push({ mime, filename, url: arrayBufferDataUrl(buffer, mime) });
  }
  return resolved;
}
