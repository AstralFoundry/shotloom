import { normalizeVideoEditorProject } from "../../utils/videoEditorProject.mjs";
import type {
  VideoEditorProject,
  VideoEditorTransform,
} from "./videoEditorTypes";

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const createId = (prefix = "item") =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export interface VideoEditorSource {
  sourceFile: string;
  sourceUrl: string;
  sourceName: string;
  duration: number;
  width: number;
  height: number;
}

export function constrainTransformToCanvas(
  transform: Partial<VideoEditorTransform> = {},
  canvasWidth: number,
  canvasHeight: number,
): VideoEditorTransform {
  const width = Math.min(canvasWidth, Math.max(1, Number(transform.width) || canvasWidth * .76));
  const height = Math.min(canvasHeight, Math.max(1, Number(transform.height) || canvasHeight * .14));
  return {
    ...transform,
    x: Math.min(Math.max(0, Number(transform.x) || 0), Math.max(0, canvasWidth - width)),
    y: Math.min(Math.max(0, Number(transform.y) || 0), Math.max(0, canvasHeight - height)),
    width,
    height,
  };
}

export type TransformCorner = "nw" | "ne" | "sw" | "se";

/** 拖动角手柄时允许的最小片段框尺寸（画布像素）。 */
const MIN_TRANSFORM_SIZE = 24;

/**
 * 以拖动角的对角为锚点调整片段框尺寸：拖 nw 时右下角固定，依此类推。
 *
 * 默认自由调整宽高 —— 这才是"拖拽裁剪大小"的直觉操作；`lockRatio` 时按起始比例等比
 * 缩放，取变化更大的那一轴主导，避免锁比时来回抖。画布钳位交给
 * `constrainTransformToCanvas`，本函数只负责尺寸与锚点。
 */
export function resizeEditorTransform(
  start: VideoEditorTransform,
  corner: TransformCorner,
  dx: number,
  dy: number,
  options: { lockRatio?: boolean } = {},
): VideoEditorTransform {
  // 东侧角由拖动的 x 决定宽度，南侧角由拖动的 y 决定高度；西/北侧角反向。
  const eastCorner = corner === "ne" || corner === "se";
  const southCorner = corner === "se" || corner === "sw";
  let width = Math.max(MIN_TRANSFORM_SIZE, Number(start.width) + (eastCorner ? dx : -dx));
  let height = Math.max(MIN_TRANSFORM_SIZE, Number(start.height) + (southCorner ? dy : -dy));
  if (options.lockRatio) {
    const ratio = Number(start.width) / Math.max(1, Number(start.height));
    if (Math.abs(dx) >= Math.abs(dy * ratio)) height = width / ratio;
    else width = height * ratio;
  }
  const right = Number(start.x) + Number(start.width);
  const bottom = Number(start.y) + Number(start.height);
  return {
    ...start,
    x: eastCorner ? Number(start.x) : right - width,
    y: southCorner ? Number(start.y) : bottom - height,
    width,
    height,
  };
}

export function hydrateSourceProject(
  project: VideoEditorProject,
  source: VideoEditorSource,
): VideoEditorProject {
  const next = clone(project);
  let asset = next.assets.find((item) =>
    item.type === "video" && item.sourceFile === source.sourceFile
  ) || next.assets.find((item) => item.type === "video");
  if (!asset) {
    asset = {
      id: createId("asset"),
      type: "video",
      name: source.sourceName,
      sourceUrl: source.sourceUrl,
    };
    next.assets.unshift(asset);
  }
  Object.assign(asset, {
    name: source.sourceName,
    sourceFile: source.sourceFile,
    sourceUrl: source.sourceUrl,
    duration: source.duration,
    width: source.width,
    height: source.height,
  });

  let track = next.tracks.find((item) => item.type === "video");
  if (!track) {
    track = {
      id: createId("track-video"),
      type: "video",
      name: "主画面",
      locked: false,
      hidden: false,
      muted: false,
      clips: [],
    };
    next.tracks.unshift(track);
  }
  const hasVideoClip = next.tracks.some((item) =>
    item.clips.some((clip) => clip.type === "video")
  );
  if (!hasVideoClip && source.duration > 0) {
    track.clips.push({
      id: createId("clip"),
      type: "video",
      assetId: asset.id,
      timelineStart: 0,
      trimStart: 0,
      trimEnd: source.duration,
      speed: 1,
      muted: false,
    });
  }
  next.settings.width = source.width || next.settings.width;
  next.settings.height = source.height || next.settings.height;
  for (const item of next.tracks) {
    for (const clip of item.clips) {
      if (clip.type === "text" && clip.transform) {
        clip.transform = constrainTransformToCanvas(
          clip.transform,
          next.settings.width,
          next.settings.height,
        );
      }
    }
  }
  return normalizeVideoEditorProject(next, source) as VideoEditorProject;
}
