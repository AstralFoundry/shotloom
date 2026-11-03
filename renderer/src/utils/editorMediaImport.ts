import { t } from '../i18n/index.ts';
import { inferMediaType, mediaExtension, MEDIA_MIME_BY_EXTENSION } from './mediaType.ts';

type MediaFacts = { duration: number; width: number; height: number };

export function inferEditorMediaType(path = ''): 'image' | 'audio' | 'video' {
  const type = inferMediaType(path);
  if (type === 'image' || type === 'audio' || type === 'video') return type;
  throw new Error(t("media.import.unsupportedFormat", { path }));
}

export function editorMediaMimeType(path = '', type: string = inferEditorMediaType(path)) {
  const extension = mediaExtension(path);
  if (extension === 'ogg' && type === 'video') return 'video/ogg';
  return MEDIA_MIME_BY_EXTENSION[extension] || `${type}/mp4`;
}

function mediaFacts(media: any, type: string) {
  return {
    duration: type === 'image' ? 0 : Number(media.duration) || 0,
    width: Number(media.videoWidth || media.naturalWidth) || 0,
    height: Number(media.videoHeight || media.naturalHeight) || 0,
  };
}

function factsAreUsable(facts: any, type: string) {
  if (type === 'image') return facts.width > 0 && facts.height > 0;
  return Number.isFinite(facts.duration) && facts.duration > 0;
}

async function probeUrl(type: string, url: string, createElement: (tag: string) => any, timeoutMs: number): Promise<MediaFacts> {
  if (!url) throw new Error(t("media.import.emptyUrl"));
  const media = createElement(type === 'image' ? 'img' : type);
  return new Promise((resolve, reject) => {
    let settled = false;
    const eventName = type === 'image' ? 'load' : 'loadedmetadata';
    const cleanup = () => {
      clearTimeout(timer);
      media.removeEventListener(eventName, loaded);
      media.removeEventListener('error', failed);
    };
    const finish = (callback: (value: any) => void, value: any) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const loaded = () => {
      const facts = mediaFacts(media, type);
      if (factsAreUsable(facts, type)) finish(resolve, facts);
      else finish(reject, new Error(t("media.import.incompleteMetadata")));
    };
    const failed = () => finish(reject, new Error(t("media.import.decodeFailed")));
    const timer = setTimeout(
      () => finish(reject, new Error(t("media.import.timeout"))),
      timeoutMs,
    );
    media.addEventListener(eventName, loaded, { once: true });
    media.addEventListener('error', failed, { once: true });
    if (type !== 'image') media.preload = 'metadata';
    media.src = url;
    if (type !== 'image') media.load?.();
  });
}

/**
 * WebView 的本地资源协议偶尔不会返回媒体元数据。先尝试稳定 URL，
 * 再用一次性的 Blob URL 读取文件头；Blob 只用于探测，不写入工程。
 */
export async function probeEditorMedia({
  type,
  sourceFile,
  sourceUrl,
  createElement = (tag: string) => document.createElement(tag),
  readArrayBuffer,
  probeNative,
  createObjectUrl = (blob: Blob) => URL.createObjectURL(blob),
  revokeObjectUrl = (url: string) => URL.revokeObjectURL(url),
  timeoutMs = 12_000,
}: {
  type: string;
  sourceFile?: string | null;
  sourceUrl?: string | null;
  createElement?: (tag: string) => any;
  readArrayBuffer?: ((path: string) => Promise<any>) | undefined;
  probeNative?: ((path: string | null | undefined) => Promise<any>) | undefined;
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
  timeoutMs?: number;
}) {
  const nativeFacts = await probeNative?.(sourceFile).catch(() => null);
  if (nativeFacts && factsAreUsable(nativeFacts, type)) {
    return {
      duration: Number(nativeFacts.duration) || 0,
      width: Number(nativeFacts.width) || 0,
      height: Number(nativeFacts.height) || 0,
    };
  }
  try {
    return await probeUrl(type, sourceUrl || '', createElement, timeoutMs);
  } catch (urlError) {
    if (!sourceFile || !readArrayBuffer) throw urlError;
    const buffer = await readArrayBuffer(sourceFile);
    if (!buffer?.byteLength) throw new Error(t("media.import.emptyFile"));
    const blobUrl = createObjectUrl(
      new Blob([buffer], { type: editorMediaMimeType(sourceFile, type) }),
    );
    try {
      return await probeUrl(type, blobUrl, createElement, timeoutMs);
    } finally {
      revokeObjectUrl(blobUrl);
    }
  }
}
