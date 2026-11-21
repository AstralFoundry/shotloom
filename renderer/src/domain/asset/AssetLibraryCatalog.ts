export type AssetMediaKind = 'image' | 'video' | 'audio' | 'text' | 'file';
type AssetRecord = Record<string, unknown>;

export function assetLibraryKey(item: AssetRecord): string {
  return String(item.assetId || item.id || item.path || item.name || '');
}

export function assetMediaKind(item: AssetRecord): AssetMediaKind {
  const type = String(item.resourceType || '').toLowerCase();
  const mime = String(item.mimeType || '').toLowerCase();
  const extension = String(item.ext || item.name || item.path || '').split('.').pop()?.toLowerCase();
  const extensions: Record<Exclude<AssetMediaKind, 'file'>, string[]> = {
    image: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp', 'svg'],
    video: ['mp4', 'mov', 'webm', 'm4v'],
    audio: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'],
    text: ['txt', 'md', 'json', 'csv', 'log'],
  };
  for (const kind of ['image', 'video', 'audio', 'text'] as const) {
    if (type === kind || mime.startsWith(`${kind}/`) || extensions[kind].includes(extension || '')) return kind;
  }
  return 'file';
}

export function assetMatchesSearch(item: AssetRecord, query: string): boolean {
  const keyword = query.trim().toLocaleLowerCase();
  if (!keyword) return true;
  const tags = Array.isArray(item.tags) ? item.tags : [];
  return [item.name, item.note, ...tags].filter(Boolean).join(' ').toLocaleLowerCase().includes(keyword);
}
