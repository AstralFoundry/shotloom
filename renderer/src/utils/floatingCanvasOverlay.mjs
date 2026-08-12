function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Position a screen-space overlay next to a transformed canvas node.
 * Integer coordinates keep text on device-aligned CSS pixels.
 */
export function resolveFloatingOverlayPosition({
  anchorRect,
  overlayRect,
  viewportWidth,
  viewportHeight,
  boundaryRect = null,
  margin = 12,
  gap = 8,
}) {
  if (!anchorRect || !overlayRect || viewportWidth <= 0 || viewportHeight <= 0) {
    return { left: 0, top: 0, visible: false };
  }
  const boundaryLeft = clamp(Number(boundaryRect?.left) || 0, 0, viewportWidth);
  const boundaryTop = clamp(Number(boundaryRect?.top) || 0, 0, viewportHeight);
  const boundaryRight = clamp(Number(boundaryRect?.right) || viewportWidth, boundaryLeft, viewportWidth);
  const boundaryBottom = clamp(Number(boundaryRect?.bottom) || viewportHeight, boundaryTop, viewportHeight);
  if (anchorRect.right < boundaryLeft || anchorRect.left > boundaryRight || anchorRect.bottom < boundaryTop || anchorRect.top > boundaryBottom) {
    return { left: 0, top: 0, visible: false };
  }
  const width = Math.min(Math.max(0, overlayRect.width || 0), Math.max(0, boundaryRight - boundaryLeft - margin * 2));
  const height = Math.max(0, overlayRect.height || 0);
  const minLeft = boundaryLeft + margin;
  const maxLeft = Math.max(minLeft, boundaryRight - width - margin);
  const centeredLeft = anchorRect.left + anchorRect.width / 2 - width / 2;
  const left = Math.round(clamp(centeredLeft, minLeft, maxLeft));
  const below = anchorRect.bottom + gap;
  const above = anchorRect.top - height - gap;
  const minTop = boundaryTop + margin;
  const maxTop = Math.max(minTop, boundaryBottom - height - margin);
  const preferredTop = below + height <= boundaryBottom - margin
    ? below
    : above >= minTop ? above : minTop;
  return { left, top: Math.round(clamp(preferredTop, minTop, maxTop)), visible: true };
}

/** Snap a visually-100% viewport to an exact 1x scale and integer translation. */
export function resolveCrispCanvasViewport({ viewport, canvasWidth, canvasHeight, tolerance = 0.06 }) {
  const zoom = Number(viewport?.zoom);
  const x = Number(viewport?.x);
  const y = Number(viewport?.y);
  if (![zoom, x, y, canvasWidth, canvasHeight].every(Number.isFinite) || zoom <= 0 || Math.abs(zoom - 1) > tolerance) {
    return null;
  }
  const centerX = canvasWidth / 2;
  const centerY = canvasHeight / 2;
  const flowCenterX = (centerX - x) / zoom;
  const flowCenterY = (centerY - y) / zoom;
  const next = {
    x: Math.round(centerX - flowCenterX),
    y: Math.round(centerY - flowCenterY),
    zoom: 1,
  };
  if (zoom === 1 && x === next.x && y === next.y) return null;
  return next;
}
