import { t } from '@/i18n';
import { inferFileResourceType, registerImportedMaterial } from '@/store/assetStore';
import { addCanvasEdge } from '@/store/canvasGraphStore';
import { recordCanvasHistory } from '@/store/canvasHistoryStore';
import { addNode } from '@/store/nodeStore';
import { store, touchProject } from '@/store/projectStore';
import { createNodeMediaCatalog } from '@/utils/nodeMedia';
import { desktopApi } from './desktopApi';

type MediaNode = Record<string, any>;
export type CanvasVideoSource = { node: MediaNode; path: string };

const mergingProjects = new WeakSet<object>();

export function canvasVideoSources(nodeIds: string[]): CanvasVideoSource[] {
  const ids = new Set(nodeIds.filter(Boolean));
  if (!ids.size) return [];
  const nodes = new Map<string, MediaNode>((store.project.nodes as MediaNode[]).map((node) => [node.id, node]));
  const mediaCatalog = createNodeMediaCatalog(store.project);
  return [...ids].flatMap((id) => {
    const node = nodes.get(id);
    if (!node || node.archived) return [];
    const media = mediaCatalog.selected(node);
    const exported = node.videoEdit?.dirty ? '' : node.videoEdit?.exportedFile;
    const isVideo = (media.resourceType || inferFileResourceType(media)) === 'video';
    const archived = !exported && !isVideo ? (store.project.tasks as MediaNode[])
      .find((task) => task.nodeId === node.id && task.status === 'completed')
      ?.result?.archivedFiles?.find((file: MediaNode) => (file.resourceType || inferFileResourceType(file)) === 'video') : undefined;
    const path = String(exported || (isVideo ? media.filePath || media.path : '') || archived?.filePath || archived?.path || '').trim();
    return path ? [{ node, path }] : [];
  });
}

export async function mergeCanvasVideos(sources: CanvasVideoSource[], storyboardId?: string): Promise<MediaNode> {
  if (sources.length < 2) throw new Error(t('canvas.storyboard.mergeNeedVideos'));
  const project = store.project;
  if (mergingProjects.has(project)) throw new Error(t('canvas.storyboard.mergeBusy'));
  const storyboard = storyboardId ? project.nodes.find((node: MediaNode) => node.id === storyboardId && !node.archived) : null;
  if (storyboardId && !storyboard) throw new Error(t('canvas.storyboard.mergeProjectChanged'));
  mergingProjects.add(project);
  try {
    const result = await desktopApi.file.concatVideos(sources.map((item) => item.path), {
      name: `${storyboard?.title || project.name || 'project'}-merged.mp4`,
    });
    const path = result?.filePath || result?.path;
    if (!path) throw new Error(t(desktopApi.platform === 'browser' ? 'canvas.storyboard.mergeDesktop' : 'canvas.storyboard.mergeFailed'));
    if (store.project !== project) throw new Error(t('canvas.storyboard.mergeProjectChanged'));
    recordCanvasHistory(t('canvas.storyboard.pipeline.merge'));
    const title = result.name || t('canvas.storyboard.pipeline.merge');
    const { material } = registerImportedMaterial({ name: title, path, type: 'video/mp4', size: result.size || 0 }, {
      resourceType: 'video', sourceType: 'video-concat', nodeType: 'videoGeneration',
    });
    const node: MediaNode = addNode('videoGeneration');
    node.title = title;
    node.materialId = material.id;
    node.resourceType = 'video';
    node.sourceType = 'video-concat';
    node.status = 'completed';
    node.uploadedFile = {
      name: title, path, type: 'video/mp4', size: result.size || 0,
      materialId: material.id, resourceType: 'video', source: 'video-concat',
    };
    node.x = Math.max(...sources.map(({ node: source }) => Number(source.x || 0) + Number(source.canvasWidth || 280))) + 100;
    node.y = Math.min(...sources.map(({ node: source }) => Number(source.y || 0)));
    if (storyboard && !storyboard.archived && project.nodes.includes(storyboard)) {
      node.storyboardFinalSourceId = storyboard.id;
      node.canvasSectionId = storyboard.canvasSectionId ?? null;
      addCanvasEdge(project, storyboard.id, node.id, {
        touch: false, edge: { data: { skipTaskInput: true, creationSource: 'storyboard-final' } },
      });
    }
    for (const { node: source } of sources) {
      addCanvasEdge(project, source.id, node.id, {
        touch: false, edge: { data: { skipTaskInput: true, creationSource: 'video-concat' } },
      });
    }
    touchProject();
    return node;
  } finally {
    mergingProjects.delete(project);
  }
}
