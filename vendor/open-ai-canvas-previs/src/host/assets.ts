import { useSyncExternalStore } from "react";

/**
 * Model library host port.
 *
 * Imported .glb/.gltf files must survive the session, so they live in the embedding
 * application's asset library rather than in engine state. The host installs read/add.
 */

export type PrevisModelAsset = {
    id: string;
    title: string;
    data: { url: string; storageKey?: string; bytes: number; mimeType: string; fileName: string };
};

type ModelAssetStore = {
    assets: PrevisModelAsset[];
    addAsset: (asset: { title: string; data: PrevisModelAsset["data"] }) => PrevisModelAsset;
};

const EMPTY: ModelAssetStore = {
    addAsset: (asset) => ({ id: `local-${Date.now().toString(36)}`, title: asset.title, data: asset.data }),
    assets: [],
};

let store: ModelAssetStore = EMPTY;
const listeners = new Set<() => void>();

export function setPrevisAssetStore(next: ModelAssetStore | null) {
    store = next ?? EMPTY;
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

/** Model assets, echoed as the host's own object so callers can read `.id` back. */
export function useModelAssets(): PrevisModelAsset[] {
    const current = useSyncExternalStore(subscribe, read, read);
    return current.assets;
}

export function addPrevisModelAsset(asset: { title: string; data: PrevisModelAsset["data"] }): PrevisModelAsset {
    const created = store.addAsset(asset);
    for (const listener of listeners) listener();
    return created;
}

export function findPrevisModelAsset(id: string): PrevisModelAsset | undefined {
    return store.assets.find((item) => item.id === id);
}

export function setPrevisModelAssets(assets: PrevisModelAsset[]) {
    store = { ...store, assets };
    for (const listener of listeners) listener();
}
