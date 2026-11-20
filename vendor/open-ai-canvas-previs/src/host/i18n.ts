import { useSyncExternalStore } from "react";

/**
 * Locale host port.
 *
 * The workbench borrows the embedding application's translation dictionary instead of
 * shipping a second one. The host installs a resolver once; until then keys render as
 * their own last segment so a missing host never blanks out the UI.
 */
export type PrevisTranslate = (key: string, params?: Record<string, string | number>) => string;

const FALLBACK: PrevisTranslate = (key, params) => {
    const label = key.split(".").pop() || key;
    return params ? `${label} ${Object.values(params).join(" ")}` : label;
};

let translate: PrevisTranslate = FALLBACK;
const listeners = new Set<() => void>();

export function setPrevisTranslate(next: PrevisTranslate | null) {
    translate = next ?? FALLBACK;
    for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** Reactive `t` for components: re-renders when the host changes locale. */
export function usePrevisTranslate(): { t: PrevisTranslate } {
    const current = useSyncExternalStore(subscribe, () => translate, () => translate);
    return { t: current };
}

export function t(key: string, params?: Record<string, string | number>): string {
    return translate(key, params);
}
