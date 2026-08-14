export const CANVAS_NODE_LABEL_HEIGHT = 20;

export function canvasNodeToolbarOffset(semanticZoom, subtle = false) {
  const zoom = Number(semanticZoom);
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const baseOffset = subtle ? 18 : 30;
  const labelGap = subtle ? 6 : 10;
  return Math.max(baseOffset, CANVAS_NODE_LABEL_HEIGHT * safeZoom + labelGap);
}
