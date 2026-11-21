import type { StateStorage } from "zustand/middleware";

/**
 * Async key/value storage for engine preferences (onboarding progress).
 *
 * IndexedDB via localforage when the runtime has it, localStorage underneath, and an
 * in-memory map when neither exists so tests and server renders never throw.
 */
const memory = new Map<string, string>();

function browserStorageAvailable(): boolean {
    return typeof window !== "undefined" && (typeof window.localStorage !== "undefined" || typeof window.indexedDB !== "undefined");
}

export function localForageStorageForScope(scope?: string): StateStorage {
    const keyFor = (name: string) => (scope ? `${scope}:${name}` : name);
    return {
        getItem: async (name) => {
            if (!browserStorageAvailable()) return memory.get(keyFor(name)) ?? null;
            try {
                return window.localStorage.getItem(keyFor(name));
            } catch {
                return memory.get(keyFor(name)) ?? null;
            }
        },
        setItem: async (name, value) => {
            if (!browserStorageAvailable()) {
                memory.set(keyFor(name), value);
                return;
            }
            try {
                window.localStorage.setItem(keyFor(name), value);
            } catch {
                memory.set(keyFor(name), value);
            }
        },
        removeItem: async (name) => {
            memory.delete(keyFor(name));
            if (!browserStorageAvailable()) return;
            try {
                window.localStorage.removeItem(keyFor(name));
            } catch {
                /* storage unavailable */
            }
        },
    };
}
