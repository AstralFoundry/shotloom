import { store } from '@/store/projectStore';
import { selectedNodeMedia } from '@/utils/nodeMedia';
import { useMediaPreviewCache } from './useMediaPreviewCache';

type AnyRecord = Record<string, any>;

/** 画布节点产出的统一缩略图：图片走媒体缓存，视频取首帧由调用方的媒体类型决定。 */
export function NodeThumb({ nodeId, className = 'node-thumb', empty, mediaKind = 'image' }: { nodeId: string; className?: string; empty?: string; mediaKind?: 'image' | 'video' }) {
  const node = (store.project.nodes as AnyRecord[]).find((item) => item.id === nodeId);
  const media = node ? selectedNodeMedia(node, store.project) : null;
  const path = String(media?.filePath || media?.path || '');
  const { url } = useMediaPreviewCache({
    path,
    kind: mediaKind,
    mimeType: String(media?.mimeType || ''),
    maxSize: 320,
    revision: String(media?.updatedAt || media?.importedAt || node?.status || ''),
    fallbackUrl: String(media?.url || media?.previewUrl || ''),
  });
  if (!node || !url) return <span className={`${className}-empty`}>{empty}</span>;
  if (mediaKind === 'video') return <video className={className} src={url} muted playsInline preload="metadata" />;
  return <img className={className} src={url} alt={String(node.title || '')} loading="lazy" />;
}
