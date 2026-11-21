import { useSyncExternalStore } from "react";

import { DEFAULT_CANVAS_COLOR_THEME, type CanvasColorTheme } from "@/host/canvas-theme";

/**
 * Active canvas theme host port.
 *
 * The host canvas owns which theme its nodes render in. The workbench installs a reader
 * once; without one the node card falls back to the light palette.
 */
const FALLBACK: () => CanvasColorTheme = () => DEFAULT_CANVAS_COLOR_THEME;

let readTheme: () => CanvasColorTheme = FALLBACK;
const listeners = new Set<() => void>();

export function setActiveCanvasTheme(reader: (() => CanvasColorTheme) | null) {
    readTheme = reader ?? FALLBACK;
    for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function useActiveTheme(): CanvasColorTheme {
    return useSyncExternalStore(subscribe, readTheme, readTheme);
}
