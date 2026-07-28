export interface CanvasSizedNode {
  type: string;
  canvasWidth?: unknown;
  canvasHeight?: unknown;
}

export function defaultCanvasNodeDimensions(type: string) {
  if (type === "resource" || type === "note") return { width: 240, height: 150 };
  if (type === "board") return { width: 340, height: 360 };
  if (type === "threeDDirector") return { width: 540, height: 330 };
  return { width: 370, height: 270 };
}

const IMAGE_PREVIEW_MAX_WIDTH = 370;
const IMAGE_PREVIEW_MAX_HEIGHT = 500;
const IMAGE_PREVIEW_MIN_WIDTH = 260;
const IMAGE_PREVIEW_MIN_HEIGHT = 210;
const GENERATION_NODE_KICKER_HEIGHT = 20;

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
    height: previewHeight + GENERATION_NODE_KICKER_HEIGHT,
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
