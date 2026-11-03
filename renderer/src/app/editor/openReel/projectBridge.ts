import { t } from '@/i18n';
import { isRecord } from '../../../utils/typeGuards';
import { desktopApi } from "../../../services/desktopApi.ts";
import { findEditorMediaSource } from "../../../services/editorMediaCatalog.ts";
import {
  editorClipDuration,
  videoEditorDuration,
} from "../../../utils/videoEditorProject.ts";
import type {
  VideoEditorAsset,
  VideoEditorClip,
  VideoEditorProject,
} from "../videoEditorTypes";
import type {
  OpenReelAssetPayload,
  OpenReelBridgeState,
  OpenReelNativeState,
} from "../../../../../vendor/openreel/apps/web/src/embedded/runtime-types";

type AnyRecord = Record<string, any>;

export type OpenReelLoadPayload = {
  name: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  assets: OpenReelAssetPayload[];
  tracks: Array<{
    id: string;
    type: "video" | "audio" | "image";
    name: string;
    locked?: boolean;
    hidden?: boolean;
    muted?: boolean;
    clips: Array<{
      id: string;
      sourceConnectionId?: string;
      mediaKey: string;
      start: number;
      duration: number;
      inPoint: number;
      outPoint: number;
      speed?: number;
      volume?: number;
      transform?: Record<string, unknown>;
    }>;
    transitions: Array<{
      id: string;
      clipAId: string;
      clipBId: string;
      type: string;
      duration: number;
    }>;
  }>;
  nativeProject?: OpenReelNativeState | null;
};

export function mimeForAsset(asset: VideoEditorAsset) {
  const name = String(asset.name || asset.sourceFile || asset.sourceUrl || "").toLowerCase();
  if (asset.type === "video") return "video/mp4";
  if (asset.type === "audio") return name.endsWith(".wav") ? "audio/wav" : "audio/mpeg";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  return "image/png";
}

function reverseTransitionType(type: string) {
  const normalized = String(type || "").toLowerCase();
  if (normalized.includes("circle")) return "circleReveal";
  if (normalized.includes("wipe") || normalized.includes("slide") || normalized.includes("push")) return "Directional";
  if (normalized.includes("zoom") || normalized.includes("blur")) return "zoomBlur";
  return "fade";
}

function normalizedTransform(clip: VideoEditorClip, width: number, height: number) {
  const transform = (clip.transform || {}) as Record<string, unknown>;
  const w = Number(transform.width) || width;
  const h = Number(transform.height) || height;
  return {
    x: Number(transform.x) || 0,
    y: Number(transform.y) || 0,
    width: w,
    height: h,
    opacity: Number.isFinite(Number(transform.opacity)) ? Number(transform.opacity) : 1,
    angle: Number(transform.angle) || 0,
    fit: transform.fit === "fill" ? ("fill" as const) : ("fit" as const),
  };
}

function clipTransformFromNative(
  transform: Record<string, unknown> | undefined,
  width: number,
  height: number,
) {
  const value = transform || {};
  const position = (value.position || {}) as Record<string, unknown>;
  const scale = (value.scale || {}) as Record<string, unknown>;
  const scaleX = Number(scale.x) || 1;
  const scaleY = Number(scale.y) || 1;
  const w = Math.max(1, scaleX * width);
  const h = Math.max(1, scaleY * height);
  return {
    x: Math.round((Number(position.x) || 0) + width / 2 - w / 2),
    y: Math.round((Number(position.y) || 0) + height / 2 - h / 2),
    width: Math.round(w),
    height: Math.round(h),
    opacity: Number.isFinite(Number(value.opacity)) ? Number(value.opacity) : 1,
    angle: Number(value.rotation) || 0,
    zIndex: 10,
    fit: value.fitMode === "cover" ? ("fill" as const) : ("fit" as const),
  };
}

/**
 * 把这次真实导入的资产记进摘要。
 *
 * 摘要里同 id 的那条可能只剩 id、没有来源（快照先落盘、导入那一步没记下路径）：必须用这次
 * 的真实路径补回去。直接丢弃 incoming 会让坏记录永久留在工程里，下次导入就读不到字节。
 */
export function withSummaryAssets(
  project: VideoEditorProject,
  assets: VideoEditorAsset[],
): VideoEditorProject {
  const nextAssets = [...project.assets];
  const indexOf = new Map(nextAssets.map((asset, index) => [String(asset.id), index]));
  let changed = false;
  for (const asset of assets) {
    if (!asset.id) continue;
    const index = indexOf.get(String(asset.id));
    if (index === undefined) {
      indexOf.set(String(asset.id), nextAssets.length);
      nextAssets.push(asset);
      changed = true;
      continue;
    }
    const current = nextAssets[index];
    if (!current || current.sourceFile || current.sourceUrl) continue;
    if (!asset.sourceFile && !asset.sourceUrl) continue;
    nextAssets[index] = {
      ...current,
      sourceFile: asset.sourceFile ?? "",
      sourceUrl: asset.sourceUrl ?? "",
    };
    changed = true;
  }
  if (!changed) return project;
  return {
    ...project,
    assets: nextAssets,
    updatedAt: new Date().toISOString(),
  };
}

export function collectEditorAssets(
  project: VideoEditorProject,
  extra: VideoEditorAsset[] = [],
) {
  const seen = new Set<string>();
  const out: VideoEditorAsset[] = [];
  for (const asset of [...project.assets, ...extra]) {
    const id = String(asset.id || "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(asset);
  }
  return out;
}

async function readAssetBytes(asset: VideoEditorAsset) {
  const sourceFile = String(asset.sourceFile || "");
  if (sourceFile) {
    try {
      const buffer = await desktopApi.file.readArrayBuffer(sourceFile);
      if (buffer?.byteLength) return buffer;
    } catch {
      // 本地路径读不到时再尝试 sourceUrl。
    }
  }
  const sourceUrl = String(asset.sourceUrl || "");
  if (sourceUrl) {
    const response = await fetch(sourceUrl);
    if (!response.ok) throw new Error(t("ui.projectBridge.text.0da86ee8", { value0: asset.name }));
    return await response.arrayBuffer();
  }
  throw new Error(t("ui.projectBridge.text.a869d7d5", { value0: asset.name }));
}

export function assetDescriptor(asset: VideoEditorAsset): OpenReelAssetPayload {
  return {
    key: asset.id,
    name: String(asset.name || asset.sourceFile || asset.id),
    type: asset.type,
    mime: mimeForAsset(asset),
    bytes: new ArrayBuffer(0),
    duration: Number(asset.duration) || 0,
    width: Number(asset.width) || 0,
    height: Number(asset.height) || 0,
  };
}

export async function buildAssetPayload(asset: VideoEditorAsset): Promise<OpenReelAssetPayload> {
  const payload = assetDescriptor(asset);
  payload.bytes = await readAssetBytes(asset);
  return payload;
}

function summaryTracks(project: VideoEditorProject) {
  const transitionClips = project.tracks
    .filter((track) => track.type === "transition")
    .flatMap((track) => track.clips);
  return project.tracks
    .filter((track) => track.type === "video" || track.type === "audio" || track.type === "overlay")
    .map((track) => {
      const type = track.type === "overlay" ? "image" : track.type;
      const clips = track.clips.filter((clip) => clip.type === type);
      const clipIds = new Set(clips.map((clip) => clip.id));
      return {
        id: track.id,
        type: type as "video" | "audio" | "image",
        name: track.name,
        locked: track.locked,
        hidden: track.hidden,
        muted: track.muted,
        clips: clips.map((clip) => ({
          id: clip.id,
          ...(clip.sourceConnectionId ? { sourceConnectionId: String(clip.sourceConnectionId) } : {}),
          mediaKey: String(clip.assetId || ""),
          start: Math.max(0, Number(clip.timelineStart) || 0),
          duration: Math.max(0.01, editorClipDuration(clip)),
          inPoint: Math.max(0, Number(clip.trimStart) || 0),
          outPoint: Math.max(0, Number(clip.trimEnd) || editorClipDuration(clip)),
          speed: Number(clip.speed) || 1,
          volume: Number.isFinite(Number(clip.volume)) ? Number(clip.volume) : 1,
          transform: normalizedTransform(clip, project.settings.width, project.settings.height),
        })),
        transitions: transitionClips
          .filter((transition) => clipIds.has(String(transition.fromClipId || "")) || clipIds.has(String(transition.toClipId || "")))
          .map((transition) => ({
            id: transition.id,
            clipAId: String(transition.fromClipId || ""),
            clipBId: String(transition.toClipId || ""),
            type: String(transition.transitionKey || "fade"),
            duration: Math.max(0.05, Number(transition.duration) || 0.6),
          })),
      };
    })
    .filter((track) => track.clips.length > 0);
}

/**
 * 首次打开（还没有原生快照）时交给 OpenReel 的载荷。
 * 首次素材包含视频、音频与图片；文字/图形/特效由原生快照恢复。
 *
 * 单条资产读不到字节时只跳过它并回一条 warning，绝不抛掉整批导入：OpenReel 会把没恢复
 * 成功的媒体项标成占位（shotloom-bridge 的 restoreNativeMedia），用户仍能在剪辑台里看到这个
 * 缺失的片段并处理它。一次导入失败会让 loaded 永远不成立，节点就此砖化，连修复入口都没有。
 */
export async function buildLoadPayload(
  project: VideoEditorProject,
  extraAssets: VideoEditorAsset[],
  nativeProject: OpenReelNativeState | null,
): Promise<{ payload: OpenReelLoadPayload; transfer: ArrayBuffer[]; warnings: string[] }> {
  const allAssets = collectEditorAssets(project, extraAssets);
  const assetsById = new Map(allAssets.map((asset) => [asset.id, asset]));
  const tracks = summaryTracks(project);
  const used = new Set<string>();
  for (const track of tracks) {
    for (const clip of track.clips) used.add(clip.mediaKey);
  }
  const payloadAssets: OpenReelAssetPayload[] = [];
  const transfer: ArrayBuffer[] = [];
  const warnings: string[] = [];
  const attempted = new Set<string>();
  const pushAsset = async (asset: VideoEditorAsset) => {
    // 只登记读过的 id、不登记读成功的 id：读失败被跳过的资产若在媒体库那轮再试一次，
    // 用户就会看到同一条告警出现两遍。
    if (attempted.has(asset.id)) return;
    attempted.add(asset.id);
    const payload = assetDescriptor(asset);
    try {
      payload.bytes = await readAssetBytes(asset);
    } catch (cause) {
      warnings.push(
        t("ui.projectBridge.text.43f0ba64", { value0: payload.name, value1: cause instanceof Error ? cause.message : String(cause) }),
      );
      return;
    }
    payloadAssets.push(payload);
    transfer.push(payload.bytes);
  };
  for (const assetId of used) {
    const asset = assetsById.get(assetId);
    if (asset) await pushAsset(asset);
  }
  // 原生快照里的素材可能暂时不在时间线上，也要导入以便恢复媒体库。
  if (nativeProject) {
    const items = (((nativeProject.mediaLibrary || {}) as AnyRecord).items || []) as AnyRecord[];
    for (const item of items) {
      const key = String(item.shotloomAssetId || "");
      if (!key) continue;
      const asset = assetsById.get(key);
      if (asset) await pushAsset(asset);
    }
  }
  return {
    payload: {
      name: String(project.name || t("ui.projectBridge.text.18c675a3")),
      width: project.settings.width,
      height: project.settings.height,
      fps: project.settings.fps,
      duration: videoEditorDuration(project),
      assets: payloadAssets,
      tracks,
      nativeProject,
    },
    transfer,
    warnings,
  };
}

/**
 * 原生工程里是否真的有内容。OpenReel 在导入完成前会先报一次自己的空工程，
 * 空工程不是"用户编辑过"的证据：把它当证据会清空摘要时间线，并让空快照在下次
 * 打开时顶掉入边导入的素材。
 */
export function nativeHasContent(native: OpenReelNativeState | null | undefined): boolean {
  if (!isRecord(native)) return false;
  const items = ((native.mediaLibrary || {}) as AnyRecord).items;
  if (Array.isArray(items) && items.length > 0) return true;
  const tracks = ((native.timeline || {}) as AnyRecord).tracks;
  if (Array.isArray(tracks) && tracks.some((track: AnyRecord) => (track?.clips || []).length > 0)) return true;
  return ["textClips", "shapeClips", "svgClips", "stickerClips", "motionCompositions"].some(
    (key) => Array.isArray(native[key]) && (native[key] as unknown[]).length > 0,
  );
}

export function summaryFromNative(
  state: OpenReelBridgeState,
  base: VideoEditorProject,
): VideoEditorProject {
  const native = (state.native || {}) as AnyRecord;
  const nativeSettings = (native.settings || {}) as AnyRecord;
  const timeline = (native.timeline || {}) as AnyRecord;
  const mediaItems = (((native.mediaLibrary || {}) as AnyRecord).items || []) as AnyRecord[];
  const baseAssets = new Map(base.assets.map((asset) => [asset.id, asset]));
  const mediaById = new Map<string, AnyRecord>();
  const assets: VideoEditorAsset[] = [];
  const seenAssets = new Set<string>();
  for (const item of mediaItems) {
    const key = String(item.shotloomAssetId || item.id || "");
    if (!key) continue;
    mediaById.set(String(item.id || ""), item);
    if (seenAssets.has(key)) continue;
    seenAssets.add(key);
    const existing = baseAssets.get(key);
    // 摘要没记下来源时按稳定 key 回查真实文件。写死空串会把一次可恢复的分叉变成
    // 永久损坏：下次导入读不到字节，整个工程都打不开。
    const recovered = existing?.sourceFile || existing?.sourceUrl ? null : findEditorMediaSource(key);
    const metadata = (item.metadata || {}) as AnyRecord;
    const type = String(item.type || existing?.type || "video") as VideoEditorAsset["type"];
    assets.push({
      ...(existing || {}),
      id: key,
      name: String(existing?.name || item.name || key),
      type,
      duration: Number(existing?.duration || metadata.duration) || 0,
      width: Number(existing?.width || metadata.width) || 0,
      height: Number(existing?.height || metadata.height) || 0,
      sourceFile: existing?.sourceFile || recovered?.sourceFile || "",
      sourceUrl: existing?.sourceUrl || recovered?.sourceUrl || "",
    });
  }
  for (const asset of base.assets) {
    if (!seenAssets.has(asset.id)) {
      seenAssets.add(asset.id);
      assets.push(asset);
    }
  }

  const tracks: VideoEditorProject["tracks"] = [];
  const nativeTracks = (timeline.tracks || []) as AnyRecord[];
  for (const track of nativeTracks) {
    const trackType = String(track.type || "video");
    if (trackType !== "video" && trackType !== "audio" && trackType !== "image" && trackType !== "graphics") continue;
    const summaryType = trackType === "audio" ? "audio" : trackType === "video" ? "video" : "overlay";
    const clips: VideoEditorClip[] = [];
    for (const clip of (track.clips || []) as AnyRecord[]) {
      const mediaItem = mediaById.get(String(clip.mediaId || ""));
      const assetId = String(mediaItem?.shotloomAssetId || clip.mediaId || "");
      clips.push({
        id: String(clip.id || ""),
        ...(clip.sourceConnectionId ? { sourceConnectionId: String(clip.sourceConnectionId) } : {}),
        type: summaryType === "audio" ? "audio" : summaryType === "video" ? "video" : "image",
        assetId,
        timelineStart: Math.max(0, Number(clip.startTime) || 0),
        duration: Math.max(0.01, Number(clip.duration) || 0.01),
        trimStart: Math.max(0, Number(clip.inPoint) || 0),
        trimEnd: Math.max(0, Number(clip.outPoint) || 0),
        speed: Number(clip.speed) || 1,
        volume: Number.isFinite(Number(clip.volume)) ? Number(clip.volume) : 1,
        transform: clipTransformFromNative(
          clip.transform as Record<string, unknown> | undefined,
          Number(nativeSettings.width) || base.settings.width,
          Number(nativeSettings.height) || base.settings.height,
        ),
        effects: Array.isArray(clip.effects) ? clip.effects.map((effect: AnyRecord) => String(effect.type || effect.id || "")) : [],
      });
    }
    tracks.push({
      id: String(track.id || ""),
      type: summaryType as VideoEditorProject["tracks"][number]["type"],
      name: String(track.name || ""),
      locked: track.locked === true,
      hidden: track.hidden === true,
      muted: track.muted === true,
      clips,
    });
  }

  const textClips = (native.textClips || []) as AnyRecord[];
  if (textClips.length) {
    tracks.push({
      id: "track-text-openreel",
      type: "text",
      name: t("ui.projectBridge.name.f4d3dab8"),
      locked: false,
      hidden: false,
      muted: false,
      clips: textClips.map((clip) => ({
        id: String(clip.id || ""),
        type: "text",
        timelineStart: Math.max(0, Number(clip.startTime) || 0),
        duration: Math.max(0.01, Number(clip.duration) || 0.01),
        text: String(clip.text || ""),
        style: (clip.style || {}) as Record<string, unknown>,
        transform: clipTransformFromNative(
          clip.transform as Record<string, unknown> | undefined,
          Number(nativeSettings.width) || base.settings.width,
          Number(nativeSettings.height) || base.settings.height,
        ),
      })),
    });
  }

  const transitionClips: VideoEditorClip[] = [];
  for (const track of nativeTracks) {
    for (const transition of (track.transitions || []) as AnyRecord[]) {
      const target = (track.clips || []).find((clip: AnyRecord) => clip.id === transition.clipBId);
      if (!target) continue;
      transitionClips.push({
        id: String(transition.id || ""),
        type: "transition",
        timelineStart: Math.max(0, (Number(target.startTime) || 0) - (Number(transition.duration) || 0.6) / 2),
        duration: Number(transition.duration) || 0.6,
        transitionKey: reverseTransitionType(String(transition.type || "")),
        fromClipId: String(transition.clipAId || ""),
        toClipId: String(transition.clipBId || ""),
      } as VideoEditorClip);
    }
  }
  if (transitionClips.length) {
    tracks.push({
      id: "track-transition-openreel",
      type: "transition",
      name: t("ui.projectBridge.name.82b64f99"),
      locked: false,
      hidden: false,
      muted: false,
      clips: transitionClips,
    });
  }

  return {
    ...base,
    schema: "shotloom.video-edit",
    version: 2,
    name: String(native.name || base.name || t("ui.projectBridge.text.18c675a3")),
    settings: {
      ...base.settings,
      width: Number(nativeSettings.width) || base.settings.width,
      height: Number(nativeSettings.height) || base.settings.height,
      fps: Number(nativeSettings.frameRate) || base.settings.fps,
      backgroundColor: String(nativeSettings.backgroundColor || base.settings.backgroundColor || "#050608"),
    },
    assets,
    tracks,
    ...(state.overview ? { openReelOverview: state.overview } : {}),
    updatedAt: new Date().toISOString(),
    durationSec: Number(state.duration) || videoEditorDuration({ ...base, tracks }),
  };
}
