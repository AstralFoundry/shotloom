export function inlineCropToolbarPosition({ node, viewport, canvas, mode }) {
  const width = Math.min(mode === 'grid' ? 310 : 235, Math.max(0, canvas.width - 24));
  const left = viewport.x + node.x * viewport.zoom;
  const top = viewport.y + node.y * viewport.zoom;
  const right = left + node.width * viewport.zoom;
  const bottom = top + node.height * viewport.zoom;
  const visible = right > 0 && left < canvas.width && bottom > 0 && top < canvas.height;
  const centered = left + (right - left - width) / 2;
  const toolbarLeft = Math.max(12, Math.min(Math.max(12, canvas.width - width - 12), centered));
  const below = bottom + 12;
  const toolbarTop = below + 42 > canvas.height ? Math.max(12, top - 54) : below;
  return { left: toolbarLeft, top: toolbarTop, width, visible };
}
