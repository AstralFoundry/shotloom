import { t } from '@/i18n';
import { desktopApi } from '@/services/desktopApi';
import { store, touchProject } from '@/store/projectStore';
import { createUploadedNode } from '../adapters/canvas/canvasUploadActions';
import { poseInsertTitle, type Pose, type PoseItem } from '@/domain/pose/PoseLibrary';

export type PosePick = { pose: Pose; item: PoseItem };

function safeFileStem(value: string): string {
  return value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim().slice(0, 60) || 'pose';
}

function extensionOf(url: string): string {
  const match = url.split(/[?#]/)[0]?.match(/\.([a-z0-9]{2,5})$/i);
  return match?.[1]?.toLowerCase() === 'png' ? 'png' : 'jpg';
}

/**
 * 姿势图片先落成当前项目自己的素材，再建普通图片节点。
 * 这样生成任务、下载和分享都按用户素材处理，不依赖姿势库目录继续存在。
 */
export async function insertPoseReferences(picks: PosePick[]): Promise<{ created: number; failed: string[] }> {
  const created: string[] = [];
  const failed: string[] = [];
  if (!picks.length) return { created: 0, failed };
  if (desktopApi.platform === 'browser') throw new Error(t('canvas.pose.desktopOnly'));
  const selectedId = store.selectedNodeId;
  const selected = (store.project.nodes as Array<Record<string, any>>).find((node) => node.id === selectedId && !node.archived);
  const baseX = selected ? Number(selected.x || 0) + Number(selected.canvasWidth || 350) + 90 : 140;
  const baseY = selected ? Number(selected.y || 0) : 140;
  for (const [index, pick] of picks.entries()) {
    const url = pick.item.imageUrl || pick.item.thumbUrl;
    if (!url) { failed.push(pick.pose.name); continue; }
    const name = `${safeFileStem(poseInsertTitle(pick.pose, pick.item))}.${extensionOf(url)}`;
    let downloaded: Record<string, any> | null = null;
    try {
      downloaded = await desktopApi.file.downloadUrlToProject?.(url, name, null) as Record<string, any> | null;
    } catch (error) {
      failed.push(`${pick.pose.name}：${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (!downloaded?.filePath && !downloaded?.path) {
      failed.push(pick.pose.name);
      continue;
    }
    const node = await createUploadedNode({
      ...downloaded,
      name: downloaded.name || name,
      fileName: downloaded.name || name,
      path: downloaded.filePath || downloaded.path,
      mimeType: downloaded.mimeType || `image/${extensionOf(url)}`,
      resourceType: 'image',
    }, {
      x: baseX + (index % 4) * 380,
      y: baseY + Math.floor(index / 4) * 320,
    });
    if (!node) { failed.push(pick.pose.name); continue; }
    node.title = poseInsertTitle(pick.pose, pick.item);
    node.titleOverride = node.title;
    node.artifactType = 'character';
    node.poseReference = {
      referenceId: pick.item.id,
      poseKey: pick.pose.key,
      poseName: pick.pose.name,
      code: pick.pose.code,
      angle: pick.item.angle,
      system: pick.pose.system,
      category: pick.pose.category,
    };
    node.prompt = `人物保持参考图中的${pick.item.angle}姿势：${pick.pose.name}`;
    node.updatedAt = new Date().toISOString();
    touchProject();
    created.push(String(node.id));
  }
  return { created: created.length, failed };
}
