export const CANVAS_WHEEL_IDLE_MS = 240;

/** Hit testing can change while the canvas moves under a stationary pointer. */
export function createCanvasWheelOwnership() {
  let lastAt = -Infinity;
  let owner: 'canvas' | 'content' = 'canvas';

  return {
    resolve(now: number, forceCanvas: boolean, contentCanScroll: () => boolean) {
      if (forceCanvas) owner = 'canvas';
      else if (now - lastAt >= CANVAS_WHEEL_IDLE_MS) owner = contentCanScroll() ? 'content' : 'canvas';
      lastAt = now;
      return owner;
    },
    reset() {
      lastAt = -Infinity;
    },
  };
}

/** Merge wheel input and distribute pixel deltas across two display frames. */
export function createCanvasWheelPan(options: {
  read(): { x: number; y: number };
  apply(position: { x: number; y: number }): void;
}) {
  let frame: number | null = null;
  let dx = 0, dy = 0;
  let nextDx = 0, nextDy = 0;
  const applyPending = (flush: boolean) => {
    frame = null;
    const moveX = flush ? dx + nextDx : dx;
    const moveY = flush ? dy + nextDy : dy;
    dx = flush ? 0 : nextDx;
    dy = flush ? 0 : nextDy;
    nextDx = 0;
    nextDy = 0;
    schedule();
    if (!moveX && !moveY) return;
    const current = options.read();
    options.apply({ x: current.x - moveX, y: current.y - moveY });
  };
  const schedule = () => {
    if (frame === null && (dx || dy || nextDx || nextDy)) {
      frame = requestAnimationFrame(() => applyPending(false));
    }
  };
  return {
    enqueue(deltaX: number, deltaY: number, deltaMode: number, pageHeight: number) {
      // Pixel samples can straddle a paint boundary during trackpad momentum.
      // Carry half forward so an empty frame between samples still moves.
      const unit = deltaMode === 0 ? 0.5 : deltaMode === 1 ? 16 : deltaMode === 2 ? pageHeight : 1;
      dx += deltaX * unit;
      dy += deltaY * unit;
      if (deltaMode === 0) {
        nextDx += deltaX * unit;
        nextDy += deltaY * unit;
      }
      schedule();
    },
    flush() {
      if (frame === null) return;
      cancelAnimationFrame(frame);
      applyPending(true);
    },
    dispose() {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      dx = 0; dy = 0;
      nextDx = 0; nextDy = 0;
    },
  };
}
