/** Keep touch zoom in the same semantic coordinates as wheel/buttons and saved projects. */
export function installCanvasPinch(root: HTMLElement, getZoom: () => number, zoomAt: (zoom: number, point: { x: number; y: number }) => void) {
  let pinch: { distance: number; zoom: number } | undefined;
  let consuming = false;
  const distance = (touches: TouchList) => Math.hypot(touches[0]!.clientX - touches[1]!.clientX, touches[0]!.clientY - touches[1]!.clientY);
  const consume = (event: TouchEvent) => { event.preventDefault(); event.stopPropagation(); };
  const start = (event: TouchEvent) => {
    if (event.touches.length !== 2 || (event.target as Element).closest('input,textarea,select,button,iframe,[contenteditable=true]')) return;
    const span = distance(event.touches);
    if (!span) return;
    consuming = true;
    pinch = { distance: span, zoom: getZoom() };
    consume(event);
  };
  const move = (event: TouchEvent) => {
    if (!consuming) return;
    consume(event);
    if (!pinch || event.touches.length !== 2) return;
    zoomAt(pinch.zoom * distance(event.touches) / pinch.distance, {
      x: (event.touches[0]!.clientX + event.touches[1]!.clientX) / 2,
      y: (event.touches[0]!.clientY + event.touches[1]!.clientY) / 2,
    });
  };
  const end = (event: TouchEvent) => {
    pinch = undefined;
    if (!event.touches.length) consuming = false;
    // Let React Flow finish any drag that began with the first finger.
  };
  root.addEventListener('touchstart', start, { capture: true, passive: false });
  root.addEventListener('touchmove', move, { capture: true, passive: false });
  root.addEventListener('touchend', end, true);
  root.addEventListener('touchcancel', end, true);
  return () => {
    root.removeEventListener('touchstart', start, { capture: true });
    root.removeEventListener('touchmove', move, { capture: true });
    root.removeEventListener('touchend', end, { capture: true });
    root.removeEventListener('touchcancel', end, { capture: true });
  };
}
