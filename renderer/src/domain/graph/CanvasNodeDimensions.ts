import { clipNodeHeight } from "../../utils/clipNodeLayout.ts";

export interface CanvasSizedNode {
  type: string;
  canvasWidth?: unknown;
  canvasHeight?: unknown;
  config?: unknown;
  videoEditProject?: unknown;
}

export const CANVAS_NODE_SIZE_SCALE = 1;
export const CANVAS_NODE_SIZING_VERSION = 5;

const scaled = (value: number) => Math.round(value * CANVAS_NODE_SIZE_SCALE);

export function defaultCanvasNodeDimensions(type: string) {
  if (type === "imageGeneration") return { width: scaled(350), height: scaled(350) };
  if (type === "videoGeneration") return { width: scaled(350), height: scaled(280) };
  if (type === "audioGeneration") return { width: scaled(350), height: scaled(125) };
  if (type === "textGeneration") return { width: scaled(350), height: scaled(500) };
  if (type === "resource") return { width: scaled(350), height: scaled(150) };
  if (type === "clipStudio") return { width: 960, height: clipNodeHeight(null) };
  if (type === "threeDDirector") return { width: scaled(540), height: scaled(330) };
  return { width: scaled(370), height: scaled(270) };
}

const MEDIA_NODE_MIN_SIZE = scaled(100);
const MEDIA_NODE_MAX_SIZE = scaled(350);
const MEDIA_NODE_PORTRAIT_MAX_HEIGHT = scaled(440);

/**
 * Match the reference canvas contract: landscape and square media scale the
 * longest edge to 350px; portrait media scale height to 440px (reference
 * default portrait node is 360x440) so tall shots do not collapse into thin
 * strips. The short edge only clamps at 100px.
 */
export function mediaCanvasNodeDimensions(naturalWidth: number, naturalHeight: number) {
  if (!(naturalWidth > 0) || !(naturalHeight > 0)) {
    return defaultCanvasNodeDimensions("imageGeneration");
  }
  const longEdge = naturalHeight > naturalWidth
    ? Math.max(MEDIA_NODE_MAX_SIZE, MEDIA_NODE_PORTRAIT_MAX_HEIGHT)
    : MEDIA_NODE_MAX_SIZE;
  const scale = Math.min(longEdge / naturalWidth, longEdge / naturalHeight);
  return {
    width: Math.max(MEDIA_NODE_MIN_SIZE, Math.round(naturalWidth * scale)),
    height: Math.max(MEDIA_NODE_MIN_SIZE, Math.round(naturalHeight * scale)),
  };
}

export function reconcileMediaNodeDimensions(
  node: CanvasSizedNode,
  naturalWidth: number,
  naturalHeight: number,
) {
  const target = mediaCanvasNodeDimensions(naturalWidth, naturalHeight);
  const storedWidth = Number(node.canvasWidth);
  const storedHeight = Number(node.canvasHeight);
  if (!(storedWidth > 0) || !(storedHeight > 0)) return target;
  const typeDefaults = defaultCanvasNodeDimensions(node.type);
  const configuredDefaults = configuredMediaDimensions(node);
  const stillUsingDefault =
    (Math.abs(storedWidth - typeDefaults.width) <= 2 &&
      Math.abs(storedHeight - typeDefaults.height) <= 2) ||
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
  return mediaCanvasNodeDimensions(Number(match[1]), Number(match[2]));
}

export function canvasNodeDimensions(node: CanvasSizedNode) {
  const defaults = configuredMediaDimensions(node) || defaultCanvasNodeDimensions(node.type);
  const storedWidth = Number(node.canvasWidth);
  const storedHeight = Number(node.canvasHeight);
  const width = Number.isFinite(storedWidth) && storedWidth > 0 ? storedWidth : defaults.width;
  return {
    width,
    height: node.type === "clipStudio" ? clipNodeHeight(node.videoEditProject) : Number.isFinite(storedHeight) && storedHeight > 0 ? storedHeight : defaults.height,
  };
}
