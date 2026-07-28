export const RESOURCE_FILE_EXTENSIONS = Object.freeze({
  image: Object.freeze(['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp', 'svg']),
  video: Object.freeze(['mp4', 'mov', 'webm', 'm4v']),
  audio: Object.freeze(['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac']),
  text: Object.freeze(['txt', 'md', 'json', 'csv', 'log']),
});

const RESOURCE_FILE_LABELS = Object.freeze({
  image: '图片',
  video: '视频',
  audio: '音频',
  text: '文本',
});

export function resourceFileDialogFilters(resourceType) {
  const extensions = RESOURCE_FILE_EXTENSIONS[resourceType];
  if (!extensions) return undefined;
  return [{ name: RESOURCE_FILE_LABELS[resourceType], extensions: [...extensions] }];
}
