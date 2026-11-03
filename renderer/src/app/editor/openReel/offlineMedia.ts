import { t } from '@/i18n';
import type { OpenReelNativeState } from "../../../../../vendor/openreel/apps/web/src/embedded/runtime-types";
import type { VideoEditorAsset, VideoEditorProject } from "../videoEditorTypes";

export type OfflineEditorMedia = { id: string; assetId: string; name: string; type: string; requiredDuration: number; reason?: string };

export function offlineEditorMedia(native: OpenReelNativeState | null): OfflineEditorMedia[] {
  const project = native as Record<string, any> | null;
  const clips = (project?.timeline?.tracks || []).flatMap((track: any) => track.clips || []);
  return (project?.mediaLibrary?.items || []).filter((item: any) => item.isPlaceholder === true).map((item: any) => ({
    id: item.id, assetId: item.shotloomAssetId || item.id, name: item.name || t("ui.offlineMedia.text.6db23b97"), type: item.type,
    ...(item.shotloomOfflineReason ? { reason: String(item.shotloomOfflineReason) } : {}),
    requiredDuration: Math.max(0, ...clips.filter((clip: any) => clip.mediaId === item.id).map((clip: any) =>
      Number(clip.outPoint) || (Number(clip.inPoint) || 0) + (Number(clip.duration) || 0) * (Number(clip.speed) || 1))),
  }));
}

export function restoredEditorAsset(missing: OfflineEditorMedia, replacement: VideoEditorAsset): VideoEditorAsset {
  if (replacement.type !== missing.type) throw new Error(t("ui.offlineMedia.text.39909f06", { value0: missing.name }));
  if (missing.type !== "image" && (!Number.isFinite(replacement.duration) || (replacement.duration ?? 0) + 0.001 < missing.requiredDuration)) {
    throw new Error(t("ui.offlineMedia.text.a633357f", { value0: missing.requiredDuration.toFixed(3) }));
  }
  return { ...replacement, id: missing.assetId };
}

export function withRestoredEditorAsset(project: VideoEditorProject, asset: VideoEditorAsset): VideoEditorProject {
  const assets = project.assets.filter((item) => item.id !== asset.id);
  return { ...project, assets: [...assets, asset], updatedAt: new Date().toISOString() };
}
