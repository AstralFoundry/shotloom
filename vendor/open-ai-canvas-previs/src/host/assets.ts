import { useSyncExternalStore } from "react";

/**
 * Model library port.
 *
 * The engine keeps its own model list so imported glb/gltf files remain available after a
 * reload (their bytes live in the engine-local blob store, see `host/files.ts`). The list is
 * metadata only and is restored from localStorage on first read.
 */

export type PrevisModelAsset = {
    id: string;
    title: string;
    data: { url: string; storageKey?: string; bytes: number; mimeType: string; fileName: string };
};

const STORAGE_KEY = "shotloom.previs-world:model-assets";

function readStored(): PrevisModelAsset[] {
    try {
        const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
        return Array.isArray(value) ? value.filter((item) => item && typeof item.id === "string" && item.data) : [];
    } catch {
        return [];
    }
}

function writeStored(assets: PrevisModelAsset[]) {
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(assets));
    } catch {
        /* storage unavailable: the list stays in memory for this session */
    }
}

let assets: PrevisModelAsset[] = readStored();
const listeners = new Set<() => void>();

type ModelAssetStore = {
    assets: PrevisModelAsset[];
    addAsset: (asset: { title: string; data: PrevisModelAsset["data"] }) => PrevisModelAsset;
};

const localStore: ModelAssetStore = {
    get assets() {
        return assets;
    },
    addAsset(asset) {
        const created: PrevisModelAsset = { id: `model-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, ...asset };
        assets = [created, ...assets];
        writeStored(assets);
        for (const listener of listeners) listener();
        return created;
    },
};

let store: ModelAssetStore = localStore;

/** Hosts may replace the library; the default is the engine-local model list. */
export function setPrevisAssetStore(next: ModelAssetStore | null) {
    store = next ?? localStore;
    for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function read() {
    return store;
}

export function useModelAssets(): PrevisModelAsset[] {
    return useSyncExternalStore(subscribe, read, read).assets;
}

export function addPrevisModelAsset(asset: { title: string; data: PrevisModelAsset["data"] }): PrevisModelAsset {
    const created = store.addAsset(asset);
    for (const listener of listeners) listener();
    return created;
}

export function findPrevisModelAsset(id: string): PrevisModelAsset | undefined {
    return store.assets.find((item) => item.id === id);
}

export function setPrevisModelAssets(next: PrevisModelAsset[]) {
    assets = next;
    writeStored(next);
    for (const listener of listeners) listener();
}
