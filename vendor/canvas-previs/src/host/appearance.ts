import { useSyncExternalStore } from "react";

/**
 * Appearance host port: the product name shown in the workbench header.
 */
const FALLBACK = "Open AI Canvas";

let brandName = FALLBACK;
const listeners = new Set<() => void>();

export function setPrevisBrandName(next: string | null) {
    brandName = next?.trim() || FALLBACK;
    for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function useBrandName(): string {
    return useSyncExternalStore(subscribe, () => brandName, () => brandName);
}
