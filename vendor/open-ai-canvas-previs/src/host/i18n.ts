import { useSyncExternalStore } from "react";

import { detectPrevisLocale, previsMessage, type PrevisLocale } from "@/host/messages";

/**
 * Locale host port.
 *
 * By default the engine resolves its own keys against the upstream open-ai-canvas strings
 * (see `host/messages.ts`), and the host may replace the translator or switch the locale.
 */
export type PrevisTranslate = (key: string, params?: Record<string, string | number>) => string;

let locale: PrevisLocale = detectPrevisLocale();
let customTranslate = false;
let translate: PrevisTranslate = (key, params) => previsMessage(locale, key, params);
const listeners = new Set<() => void>();

function notify() {
    for (const listener of listeners) listener();
}

/** Switch the engine locale; the translator falls back to the built-in catalog. */
export function setPrevisLocale(next: unknown) {
    locale = next === "en-US" || next === "zh-CN" ? next : detectPrevisLocale();
    try {
        window.localStorage.setItem("shotloom.previs-world:locale", locale);
    } catch {
        /* storage unavailable */
    }
    if (!customTranslate) translate = (key, params) => previsMessage(locale, key, params);
    notify();
}

export function setPrevisTranslate(next: PrevisTranslate | null) {
    customTranslate = Boolean(next);
    translate = next ?? ((key, params) => previsMessage(locale, key, params));
    notify();
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
