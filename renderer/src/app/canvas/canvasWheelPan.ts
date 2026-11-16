/** Merge trackpad scroll samples without updating node geometry or zoom. */
export function createCanvasWheelPan(options: {
  read(): { x: number; y: number };
  apply(position: { x: number; y: number }): void;
}) {
  let frame: number | null = null;
  let dx = 0, dy = 0;
  return {
    enqueue(deltaX: number, deltaY: number, deltaMode: number, pageHeight: number) {
      const unit = deltaMode === 1 ? 16 : deltaMode === 2 ? pageHeight : 1;
      dx += deltaX * unit;
      dy += deltaY * unit;
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        const current = options.read();
        const next = { x: current.x - dx, y: current.y - dy };
        dx = 0; dy = 0;
        options.apply(next);
      });
    },
    dispose() {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      dx = 0; dy = 0;
    },
  };
}
