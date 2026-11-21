import { useEffect, type RefObject } from "react";

/**
 * Close a floating popup when its anchor moves (scroll, drag, canvas pan/zoom) so it never
 * floats detached from the control that opened it.
 */
export function useDismissPopupOnAnchorMove(open: boolean, anchorRef: RefObject<HTMLElement | null>, dismiss: () => void) {
    useEffect(() => {
        if (!open) return;
        const anchor = anchorRef.current;
        let origin: DOMRect | null = anchor ? anchor.getBoundingClientRect() : null;
        const moved = () => {
            const next = anchor ? anchor.getBoundingClientRect() : null;
            if (!origin || !next || Math.abs(next.top - origin.top) > 2 || Math.abs(next.left - origin.left) > 2) {
                origin = next;
                dismiss();
            }
        };
        window.addEventListener("scroll", moved, true);
        window.addEventListener("resize", dismiss);
        const observer = typeof ResizeObserver === "function" && anchor ? new ResizeObserver(moved) : null;
        if (observer && anchor) observer.observe(anchor);
        return () => {
            window.removeEventListener("scroll", moved, true);
            window.removeEventListener("resize", dismiss);
            observer?.disconnect();
        };
    }, [open, anchorRef, dismiss]);
}
