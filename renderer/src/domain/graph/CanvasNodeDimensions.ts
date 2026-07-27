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

export function canvasNodeDimensions(node: CanvasSizedNode) {
  const defaults = defaultCanvasNodeDimensions(node.type);
  const storedWidth = Number(node.canvasWidth);
  const storedHeight = Number(node.canvasHeight);
  return {
    width: Number.isFinite(storedWidth) && storedWidth > 0 ? storedWidth : defaults.width,
    height: Number.isFinite(storedHeight) && storedHeight > 0 ? storedHeight : defaults.height,
  };
}
