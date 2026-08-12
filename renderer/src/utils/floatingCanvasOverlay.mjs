function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function overlapArea(left, right) {
  const width = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left));
  const height = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
  return width * height;
}

function positionedRect(left, top, width, height) {
  return { left, top, right: left + width, bottom: top + height, width, height };
}

/**
 * Position a screen-space overlay next to a transformed canvas node.
 * Integer coordinates keep text on device-aligned CSS pixels.
 * @param {{
 *   anchorRect: {left:number,right:number,top:number,bottom:number,width:number,height?:number},
 *   overlayRect: {width:number,height:number},
 *   viewportWidth: number,
 *   viewportHeight: number,
 *   boundaryRect?: {left:number,right:number,top:number,bottom:number,width?:number,height?:number} | null,
 *   obstacleRects?: Array<{left:number,right:number,top:number,bottom:number,width?:number,height?:number}>,
 *   margin?: number,
 *   gap?: number
 * }} options
 */
export function resolveFloatingOverlayPosition({
  anchorRect,
  overlayRect,
  viewportWidth,
  viewportHeight,
  boundaryRect = null,
  obstacleRects = [],
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
  const minTop = boundaryTop + margin;
  const maxTop = Math.max(minTop, boundaryBottom - height - margin);
  const centeredLeft = anchorRect.left + anchorRect.width / 2 - width / 2;
  const centeredTop = anchorRect.top + anchorRect.height / 2 - height / 2;
  const candidates = [
    { left: centeredLeft, top: anchorRect.bottom + gap },
    { left: centeredLeft, top: anchorRect.top - height - gap },
    { left: anchorRect.right + gap, top: centeredTop },
    { left: anchorRect.left - width - gap, top: centeredTop },
  ].map((candidate, preference) => {
    const left = clamp(candidate.left, minLeft, maxLeft);
    const top = clamp(candidate.top, minTop, maxTop);
    const rect = positionedRect(left, top, width, height);
    const obstacleOverlap = (Array.isArray(obstacleRects) ? obstacleRects : [])
      .reduce((total, obstacle) => total + overlapArea(rect, obstacle), 0);
    const anchorOverlap = overlapArea(rect, anchorRect);
    const clampDistance = Math.abs(left - candidate.left) + Math.abs(top - candidate.top);
    return {
      left: Math.round(left),
      top: Math.round(top),
      preference,
      score: anchorOverlap * 10000 + obstacleOverlap * 100 + clampDistance * 10 + preference,
    };
  });
  const best = candidates.sort((left, right) => left.score - right.score)[0];
  return { left: best.left, top: best.top, visible: true };
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
