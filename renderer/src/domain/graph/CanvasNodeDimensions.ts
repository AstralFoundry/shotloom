import { clipNodeHeight } from "../../utils/clipNodeLayout.ts";

export interface CanvasSizedNode {
  type: string;
  canvasWidth?: unknown;
  canvasHeight?: unknown;
  canvasSizeManuallySet?: unknown;
  config?: unknown;
  uploadedFile?: unknown;
  generatedOutputs?: unknown;
  selectedOutputNodeId?: unknown;
  videoEditProject?: unknown;
}

export const CANVAS_NODE_SIZE_SCALE = 1;
export const CANVAS_NODE_SIZING_VERSION = 5;

const scaled = (value: number) => Math.round(value * CANVAS_NODE_SIZE_SCALE);
const MEDIA_NODE_WIDTH = scaled(720);
const MEDIA_PREVIEW_MAX_WIDTH = scaled(720);
const LEGACY_PREVIEW_WIDTH = scaled(360);
const MEDIA_NODE_HEIGHT = MEDIA_NODE_WIDTH * 9 / 16;
const LEGACY_MEDIA_NODE_WIDTH = scaled(350);

export function defaultCanvasNodeDimensions(type: string) {
  if (type === "canvasSection") return { width: 800, height: 560 };
  if (type === "imageGeneration" || type === "videoGeneration") {
    return { width: MEDIA_NODE_WIDTH, height: MEDIA_NODE_HEIGHT };
  }
  if (type === "audioGeneration") return { width: scaled(350), height: scaled(125) };
  if (type === "textGeneration") return { width: scaled(350), height: scaled(500) };
  if (type === "resource") return { width: scaled(350), height: scaled(150) };
  if (type === "batchTable") return { width: 1280, height: 560 };
  if (type === "clipStudio") return { width: 960, height: clipNodeHeight(null) };
  if (type === "threeDDirector") return { width: scaled(540), height: scaled(330) };
  return { width: scaled(370), height: scaled(270) };
}

export const MEDIA_NODE_MAX_HEIGHT = scaled(520);

function usesLegacyMediaDefault(type: string, width: number, height: number) {
  if (type !== "imageGeneration" && type !== "videoGeneration") return false;
  const legacyHeight = scaled(type === "imageGeneration" ? 350 : 280);
  return (Math.abs(width - LEGACY_MEDIA_NODE_WIDTH) <= 2
    && (Math.abs(height - legacyHeight) <= 2 || Math.abs(height - LEGACY_MEDIA_NODE_WIDTH * 9 / 16) <= 2))
    || (Math.abs(width - LEGACY_PREVIEW_WIDTH) <= 2
      && Math.abs(height - LEGACY_PREVIEW_WIDTH * 9 / 16) <= 2);
}

/** Match the reference canvas: bounded image previews and readable video controls. */
export function mediaCanvasNodeDimensions(naturalWidth: number, naturalHeight: number, type = "imageGeneration") {
  if (!Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight) || !(naturalWidth > 0) || !(naturalHeight > 0)) {
    return defaultCanvasNodeDimensions(type);
  }
  const limit = Math.min(MEDIA_PREVIEW_MAX_WIDTH / naturalWidth, MEDIA_NODE_MAX_HEIGHT / naturalHeight);
  const scale = type === "videoGeneration"
    ? Math.max(Math.min(1, limit), 420 / naturalWidth, 236 / naturalHeight)
    : Math.min(limit, Math.max(Math.min(1, limit), 320 / Math.max(naturalWidth, naturalHeight)));
  return { width: naturalWidth * scale, height: naturalHeight * scale };
}

export function reconcileMediaNodeDimensions(
  node: CanvasSizedNode,
  naturalWidth: number,
  naturalHeight: number,
) {
  if (node.canvasSizeManuallySet) return null;
  const target = mediaCanvasNodeDimensions(naturalWidth, naturalHeight, node.type);
  const storedWidth = Number(node.canvasWidth);
  const storedHeight = Number(node.canvasHeight);
  if (!(storedWidth > 0) || !(storedHeight > 0)) return target;
  // Recognize the previous automatic 360×260 fit without resizing custom bounds.
  const oldScale = Math.min(360 / naturalWidth, 260 / naturalHeight);
  const oldWidth = Math.max(100, Math.round(naturalWidth * oldScale * 2) / 2);
  const oldHeight = Math.max(100, Math.round(naturalHeight * oldScale * 2) / 2);
  if (Math.abs(storedWidth - oldWidth) < 0.01 && Math.abs(storedHeight - oldHeight) < 0.01) {
    return Math.abs(storedWidth - target.width) < 0.01 && Math.abs(storedHeight - target.height) < 0.01 ? null : target;
  }
  const sourceRatio = naturalWidth / naturalHeight;
  if (Math.abs(storedWidth / storedHeight - sourceRatio) / sourceRatio <= 0.02) return null;
  const typeDefaults = defaultCanvasNodeDimensions(node.type);
  const configuredDefaults = configuredMediaDimensions(node);
  const stillUsingDefault =
    (Math.abs(storedWidth - typeDefaults.width) <= 2 &&
      Math.abs(storedHeight - typeDefaults.height) <= 2) ||
    usesLegacyMediaDefault(node.type, storedWidth, storedHeight) ||
    (Math.abs(storedWidth - 480) <= 2 && Math.abs(storedHeight - 270) <= 2) ||
    (configuredDefaults != null &&
      Math.abs(storedWidth - configuredDefaults.width) <= 2 &&
      Math.abs(storedHeight - configuredDefaults.height) <= 2);
  if (!stillUsingDefault) return null;
  if (storedWidth === target.width && storedHeight === target.height) return null;
  return target;
}

function configuredMediaDimensions(node: CanvasSizedNode) {
  if (node.type !== "imageGeneration" && node.type !== "videoGeneration") return null;
  const config = node.config && typeof node.config === "object"
    ? node.config as Record<string, unknown>
    : {};
  const raw = String(config.aspectRatio || config.ratio || config.size || "").trim().toLowerCase();
  if (!raw || raw === "auto" || raw === "adaptive") return null;
  const match = raw.match(/^(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!(width > 0) || !(height > 0)) return null;
  const scale = Math.min(MEDIA_PREVIEW_MAX_WIDTH / width, MEDIA_NODE_MAX_HEIGHT / height);
  return mediaCanvasNodeDimensions(width * scale, height * scale, node.type);
}

export function canvasNodeDimensions(node: CanvasSizedNode) {
  const storedWidth = Number(node.canvasWidth);
  const storedHeight = Number(node.canvasHeight);
  const hasMedia = Boolean(node.uploadedFile || node.selectedOutputNodeId
    || (Array.isArray(node.generatedOutputs) && node.generatedOutputs.length));
  const typeDefaults = defaultCanvasNodeDimensions(node.type);
  const configured = configuredMediaDimensions(node);
  const defaults = !hasMedia && configured?.width === MEDIA_PREVIEW_MAX_WIDTH
    && configured.height === MEDIA_PREVIEW_MAX_WIDTH * 9 / 16
    ? typeDefaults : configured || typeDefaults;
  if (!hasMedia && usesLegacyMediaDefault(node.type, storedWidth, storedHeight)) {
    return defaults;
  }
  const width = Number.isFinite(storedWidth) && storedWidth > 0 ? storedWidth : defaults.width;
  return {
    width,
    height: node.type === "clipStudio" ? clipNodeHeight(node.videoEditProject) : Number.isFinite(storedHeight) && storedHeight > 0 ? storedHeight : defaults.height,
  };
}
