/** Coalesce high-frequency wheel input while preserving every zoom delta. */
export function createCanvasWheelZoom(options: {
  readZoom(): number;
  applyZoom(zoom: number, point: { x: number; y: number }): void;
  min: number;
  max: number;
}) {
  let frame: number | null = null;
  let pending: { zoom: number; point: { x: number; y: number } } | null = null;
  return {
    enqueue(deltaY: number, point: { x: number; y: number }) {
      const zoom = (pending?.zoom ?? options.readZoom()) * Math.exp(-deltaY * 0.002);
      pending = { zoom: Math.min(options.max, Math.max(options.min, zoom)), point };
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        const next = pending;
        pending = null;
        if (next) options.applyZoom(next.zoom, next.point);
      });
    },
    dispose() {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      pending = null;
    },
  };
}
