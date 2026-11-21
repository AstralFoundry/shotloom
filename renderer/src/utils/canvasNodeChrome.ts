export const CANVAS_NODE_LABEL_HEIGHT = 24;

// Reference geometry: a 4px air gap separates the name band from the node top.
export const CANVAS_NODE_LABEL_OFFSET = 28;

const PORT_SIZE = 16;

export function canvasNodePortBounds(width: unknown, height: unknown) {
  const screenWidth = Number(width);
  const screenHeight = Number(height);
  if (!Number.isFinite(screenWidth) || !Number.isFinite(screenHeight)) return [];
  return [
    {
      id: "port-left",
      x: 0,
      y: screenHeight / 2 - PORT_SIZE / 2,
      width: PORT_SIZE,
      height: PORT_SIZE,
    },
    {
      id: "port-right",
      x: screenWidth - PORT_SIZE,
      y: screenHeight / 2 - PORT_SIZE / 2,
      width: PORT_SIZE,
      height: PORT_SIZE,
    },
  ];
}

export function canvasNodeToolbarOffset(semanticZoom: unknown, subtle = false) {
  const zoom = Number(semanticZoom);
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const baseOffset = subtle ? 26 : 38;
  const labelGap = subtle ? 6 : 10;
  return Math.max(baseOffset, CANVAS_NODE_LABEL_OFFSET * safeZoom + labelGap);
}
