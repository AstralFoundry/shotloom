export type MediaType = 'image' | 'video' | 'audio' | 'text' | 'file';

/** 文件身份属于素材事实，素材库、画布读取与请求编译共用同一份格式表。 */
export const MEDIA_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  gif: 'image/gif', avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml',
  tif: 'image/tiff', tiff: 'image/tiff',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', m4v: 'video/x-m4v',
  mkv: 'video/x-matroska', avi: 'video/x-msvideo',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac',
  ogg: 'audio/ogg', flac: 'audio/flac',
  txt: 'text/plain', md: 'text/markdown', json: 'application/json',
  csv: 'text/csv', log: 'text/plain',
};

type MediaFile = { [key: string]: unknown };

export function mediaExtension(file: MediaFile | string): string {
  if (typeof file !== 'string') {
    const extension = String(file.ext || '').replace(/^\./, '').toLowerCase();
    if (/^[a-z0-9]+$/.test(extension)) return extension;
  }
  const candidates = typeof file === 'string' ? [file] : [
    file.filePath, file.path, file.fileName, file.name,
    file.url, file.remoteUrl, file.resourceUrl, file.previewUrl,
  ];
  for (const candidate of candidates) {
    const extension = /\.([a-z0-9]+)$/i.exec(String(candidate || '').split(/[?#]/)[0] || '')?.[1];
    if (extension) return extension.toLowerCase();
  }
  return '';
}

export function inferMediaType(file: MediaFile | string): MediaType {
  const hints = typeof file === 'string' ? [] : [file.resourceType, file.mimeType, file.type];
  for (const hint of hints) {
    const hinted = String(hint || '').toLowerCase();
    for (const kind of ['image', 'video', 'audio', 'text'] as const) {
      if (hinted === kind || hinted.startsWith(`${kind}/`)) return kind;
    }
    if (hinted === 'application/json') return 'text';
  }
  const mime = MEDIA_MIME_BY_EXTENSION[mediaExtension(file)] || '';
  if (mime === 'application/json') return 'text';
  return (mime.split('/')[0] || 'file') as MediaType;
}
