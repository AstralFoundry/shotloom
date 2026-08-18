export interface CanvasSizedNode {
  type: string;
  canvasWidth?: unknown;
  canvasHeight?: unknown;
  config?: unknown;
}

export const CANVAS_NODE_SIZE_SCALE = 1;
export const CANVAS_NODE_SIZING_VERSION = 4;

const scaled = (value: number) => Math.round(value * CANVAS_NODE_SIZE_SCALE);

export function defaultCanvasNodeDimensions(type: string) {
  if (type === "imageGeneration") return { width: scaled(350), height: scaled(350) };
  if (type === "videoGeneration") return { width: scaled(350), height: scaled(280) };
  if (type === "audioGeneration") return { width: scaled(350), height: scaled(125) };
  if (type === "textGeneration") return { width: scaled(350), height: scaled(500) };
  if (type === "resource") return { width: scaled(350), height: scaled(150) };
  if (type === "note") return { width: scaled(300), height: scaled(200) };
  if (type === "board") return { width: scaled(440), height: scaled(400) };
  if (type === "threeDDirector") return { width: scaled(540), height: scaled(330) };
  return { width: scaled(370), height: scaled(270) };
}

const MEDIA_NODE_MIN_SIZE = scaled(100);
const MEDIA_NODE_MAX_SIZE = scaled(350);

/**
 * Match the reference canvas contract: scale the longest media edge to 350px
 * and clamp only the short edge to 100px. The node and its media therefore use
 * the same aspect-driven layout instead of a generic landscape rectangle.
 */
export function mediaCanvasNodeDimensions(naturalWidth: number, naturalHeight: number) {
  if (!(naturalWidth > 0) || !(naturalHeight > 0)) {
    return defaultCanvasNodeDimensions("imageGeneration");
  }
  const scale = Math.min(MEDIA_NODE_MAX_SIZE / naturalWidth, MEDIA_NODE_MAX_SIZE / naturalHeight);
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
  return {
    width: Number.isFinite(storedWidth) && storedWidth > 0 ? storedWidth : defaults.width,
    height: Number.isFinite(storedHeight) && storedHeight > 0 ? storedHeight : defaults.height,
  };
}
