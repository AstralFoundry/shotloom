import type { TimelineSelection } from '@/core/clip-editing.ts';
import { session } from '@/state/editor-session.ts';

const DRAG_THRESHOLD_PX = 3;

/**
 * Pointer-driven timeline dragging for action/path clip bars.
 *
 * Movement only starts a history transaction past a small threshold, so a plain click
 * remains a click. Each move replays core's `dragClipRange` from the drag-start snapshot,
 * which keeps neighbour/insert rules in one place instead of re-implementing them here.
 */
export function beginClipDrag(
    event: React.PointerEvent<HTMLElement>,
    selection: TimelineSelection,
    options: { extent: number; fps: number; onTap: () => void },
): void {
    if (event.button !== 0) return;
    const lane = event.currentTarget.closest<HTMLElement>('.lane');
    if (!lane) return;

    const rect = lane.getBoundingClientRect();
    if (rect.width <= 0) return;
    const resize = Boolean((event.target as HTMLElement).closest('[data-resize]'));
    const startX = event.clientX;
    const secondsPerPixel = options.extent / rect.width;
    let active = false;
    let lastDelta = 0;

    const onMove = (moveEvent: PointerEvent) => {
        const dx = moveEvent.clientX - startX;
        if (!active) {
            if (Math.abs(dx) < DRAG_THRESHOLD_PX) return;
            if (!session.beginTimelineDrag(selection, resize)) {
                cleanup();
                return;
            }
            active = true;
            lane.classList.add('is-dragging');
        }
        const delta = Math.round((dx * secondsPerPixel * options.fps) / 1) / options.fps;
        if (delta === lastDelta) return;
        lastDelta = delta;
        session.updateTimelineDrag(delta);
    };

    const onUp = () => {
        cleanup();
        if (active) session.endTimelineDrag();
        else options.onTap();
    };

    const onCancel = () => {
        cleanup();
        if (active) session.cancelTimelineDrag();
    };

    const cleanup = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        lane.classList.remove('is-dragging');
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
}
