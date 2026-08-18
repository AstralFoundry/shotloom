export const CANVAS_NODE_LABEL_HEIGHT = 20;

const LEFT_PORT_SIZE = 12;
const RIGHT_PORT_SIZE = 20;

export function canvasNodePortBounds(width, height) {
  const screenWidth = Number(width);
  const screenHeight = Number(height);
  if (!Number.isFinite(screenWidth) || !Number.isFinite(screenHeight)) return [];
  return [
    {
      id: "port-left",
      x: 0,
      y: screenHeight / 2 - LEFT_PORT_SIZE / 2,
      width: LEFT_PORT_SIZE,
      height: LEFT_PORT_SIZE,
    },
    {
      id: "port-right",
      x: screenWidth - RIGHT_PORT_SIZE,
      y: screenHeight / 2 - RIGHT_PORT_SIZE / 2,
      width: RIGHT_PORT_SIZE,
      height: RIGHT_PORT_SIZE,
    },
  ];
}

export function canvasNodeToolbarOffset(semanticZoom, subtle = false) {
  const zoom = Number(semanticZoom);
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const baseOffset = subtle ? 18 : 30;
  const labelGap = subtle ? 6 : 10;
  return Math.max(baseOffset, CANVAS_NODE_LABEL_HEIGHT * safeZoom + labelGap);
}
