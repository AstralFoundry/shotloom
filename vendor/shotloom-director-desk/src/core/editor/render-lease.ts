import type { Engine } from '../engine.ts';

/**
 * Borrow the renderer for a moment in order to look at a different point in time.
 *
 * Several features need a frame the user is not currently looking at: shot thumbnails, the
 * previous-shot overlay, the spatial check, single-shot export. Each one has to reposition the
 * engine, render, and put it back — and doing that naively fights the editor in three ways:
 *
 * 1. `prepareOutput` rewrites engine time, so a concurrent `frame()` tick would sample the
 *    borrowed time and draw it into the viewport.
 * 2. Two features borrowing at once interleave their `sample` calls and render each other's
 *    frames.
 * 3. A throw in the middle leaves `exporting` stuck true, which silently freezes playback.
 *
 * So every borrowed render goes through this one gate: ownership is exclusive, `exporting` is
 * restored no matter what, and the previous engine time is put back before releasing. Callers
 * stay responsible for what they draw; this owns *when* they may draw.
 */
export class RenderLease {
    private queue: Promise<void> = Promise.resolve();
    private readonly engine: Engine;

    constructor(engine: Engine) {
        this.engine = engine;
    }

    /** True while any borrow is in flight. */
    get busy(): boolean {
        return this.engine.exporting;
    }

    /**
     * Run `work` with exclusive use of the renderer and the engine restored afterwards.
     *
     * Borrows are serialised rather than rejected: a second request is legitimate (the user
     * opens the shot list while the overlay is refreshing) and queueing keeps the result
     * deterministic. `wasExporting` is preserved so an outer export is never un-flagged here.
     *
     * `shouldSkip` lets a caller abandon work that is no longer wanted (the panel closed, the
     * playhead moved) without breaking the queue.
     */
    async borrow<T>(work: () => Promise<T> | T, shouldSkip?: () => boolean): Promise<T> {
        const run = this.queue.then(async () => {
            const previousTime = this.engine.time;
            const wasExporting = this.engine.exporting;
            // An export or a snapshot already owns the renderer: taking it here would fight over
            // the same canvas. Skipping still restores the borrowed time, so the caller's contract
            // holds either way.
            if (wasExporting) {
                try {
                    return await work();
                } finally {
                    this.engine.restorePreview(previousTime);
                }
            }
            this.engine.exporting = true;
            try {
                if (shouldSkip?.()) return undefined as T;
                return await work();
            } finally {
                this.engine.exporting = wasExporting;
                // Restore the borrowed time even when the work threw: leaving the engine on a
                // sample nobody asked for makes the viewport disagree with the playhead.
                this.engine.restorePreview(previousTime);
            }
        });
        // Keep the chain alive after a failure so one broken borrow cannot wedge every later one.
        this.queue = run.then(
            () => undefined,
            () => undefined,
        );
        return run;
    }
}
