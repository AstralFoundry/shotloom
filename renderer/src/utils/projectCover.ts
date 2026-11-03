import { createNodeMediaCatalog } from './nodeMedia';

type RecordValue = Record<string, any>;
/** 从真实画布图片选一个稳定封面，不把素材库图片当成画布内容。 */
export function projectCoverSource(project: RecordValue | null | undefined): string {
  const catalog = createNodeMediaCatalog(project);
  for (const node of project?.nodes || []) {
    for (const media of [catalog.selected(node), ...catalog.outputs(node), node]) {
      const source = String(media?.filePath || media?.path || media?.url || media?.previewUrl || '');
      const image = media?.resourceType === 'image' || media?.mimeType?.startsWith('image/')
        || /\.(png|jpe?g|webp|gif|avif|bmp)(?:[?#]|$)/i.test(source) || source.startsWith('data:image/');
      if (source && image) return source;
    }
  }
  return '';
}
