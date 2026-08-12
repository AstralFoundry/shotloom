export interface CanvasSizedNode {
  type: string;
  canvasWidth?: unknown;
  canvasHeight?: unknown;
}

export const CANVAS_NODE_SIZE_SCALE = 0.75;

const scaled = (value: number) => Math.round(value * CANVAS_NODE_SIZE_SCALE);

export function defaultCanvasNodeDimensions(type: string) {
  if (type === "resource" || type === "note") return { width: scaled(240), height: scaled(150) };
  if (type === "board") return { width: scaled(340), height: scaled(360) };
  if (type === "threeDDirector") return { width: scaled(540), height: scaled(330) };
  return { width: scaled(370), height: scaled(270) };
}

const IMAGE_PREVIEW_MAX_WIDTH = scaled(370);
const IMAGE_PREVIEW_MAX_HEIGHT = scaled(500);
const IMAGE_PREVIEW_MIN_WIDTH = scaled(260);
const IMAGE_PREVIEW_MIN_HEIGHT = scaled(210);

/**
 * Preserve the source aspect ratio while keeping portrait images practical on
 * the canvas. Very wide or very tall media gets a little letterboxing instead
 * of creating an unusably thin or oversized node.
 */
export function imageCanvasNodeDimensions(naturalWidth: number, naturalHeight: number) {
  if (!(naturalWidth > 0) || !(naturalHeight > 0)) {
    return defaultCanvasNodeDimensions("imageGeneration");
  }
  const ratio = naturalWidth / naturalHeight;
  const boundingRatio = IMAGE_PREVIEW_MAX_WIDTH / IMAGE_PREVIEW_MAX_HEIGHT;
  const previewWidth =
    ratio >= boundingRatio
      ? IMAGE_PREVIEW_MAX_WIDTH
      : Math.max(IMAGE_PREVIEW_MIN_WIDTH, Math.round(IMAGE_PREVIEW_MAX_HEIGHT * ratio));
  const previewHeight =
    ratio >= boundingRatio
      ? Math.max(IMAGE_PREVIEW_MIN_HEIGHT, Math.round(IMAGE_PREVIEW_MAX_WIDTH / ratio))
      : IMAGE_PREVIEW_MAX_HEIGHT;
  return {
    width: previewWidth,
    height: previewHeight,
  };
}

export function canvasNodeDimensions(node: CanvasSizedNode) {
  const defaults = defaultCanvasNodeDimensions(node.type);
  const storedWidth = Number(node.canvasWidth);
  const storedHeight = Number(node.canvasHeight);
  return {
    width: Number.isFinite(storedWidth) && storedWidth > 0 ? storedWidth : defaults.width,
    height: Number.isFinite(storedHeight) && storedHeight > 0 ? storedHeight : defaults.height,
  };
}
