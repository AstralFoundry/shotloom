/**
 * File host port.
 *
 * The engine streams Blobs (screenshots, clay passes, depth videos, imported glb models) and
 * has to keep them addressable across reloads. Inside Shotloom's iframe there is no host
 * storage API to call, so the engine owns a small IndexedDB blob store: uploads are written
 * under a stable key and resolved back to an object URL when a loader needs them. The scene
 * document only stores those keys, which keeps it portable JSON.
 */

export type PrevisUploadedFile = {
    url: string;
    storageKey: string;
    bytes: number;
    mimeType: string;
};

export type PrevisUpload = (blob: Blob, prefix: string) => Promise<PrevisUploadedFile>;
export type PrevisResolveUrl = (storageKey?: string, fallback?: string) => Promise<string>;

const DB_NAME = "shotloom-previs-assets";
const STORE_NAME = "blobs";
const objectUrls = new Map<string, string>();

function openDatabase(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === "undefined") return Promise.resolve(null);
    return new Promise((resolve) => {
        try {
            const request = indexedDB.open(DB_NAME, 1);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => resolve(null);
        } catch {
            resolve(null);
        }
    });
}

async function writeBlob(key: string, blob: Blob) {
    const db = await openDatabase();
    if (!db) return false;
    return new Promise<boolean>((resolve) => {
        try {
            const transaction = db.transaction(STORE_NAME, "readwrite");
            transaction.objectStore(STORE_NAME).put(blob, key);
            transaction.oncomplete = () => resolve(true);
            transaction.onerror = () => resolve(false);
        } catch {
            resolve(false);
        }
    });
}

async function readBlob(key: string): Promise<Blob | null> {
    const db = await openDatabase();
    if (!db) return null;
    return new Promise<Blob | null>((resolve) => {
        try {
            const transaction = db.transaction(STORE_NAME, "readonly");
            const request = transaction.objectStore(STORE_NAME).get(key);
            request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : null);
            request.onerror = () => resolve(null);
        } catch {
            resolve(null);
        }
    });
}

const localUpload: PrevisUpload = async (blob, prefix) => {
    const storageKey = `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
    // A failed IndexedDB write still leaves the blob usable for this session: the object URL
    // stays alive, and the user is told the file will need re-importing after a reload.
    const persisted = await writeBlob(storageKey, blob);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return { url, storageKey: persisted ? storageKey : `${storageKey}:session`, bytes: blob.size, mimeType: blob.type };
};

const localResolve: PrevisResolveUrl = async (storageKey, fallback = "") => {
    if (!storageKey) return fallback;
    const cached = objectUrls.get(storageKey);
    if (cached) return cached;
    const blob = await readBlob(storageKey);
    if (!blob) return fallback;
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
};

let upload: PrevisUpload = localUpload;
let resolveUrl: PrevisResolveUrl = localResolve;

/** Hosts may replace the storage backend; the default is the engine-local IndexedDB store. */
export function setPrevisFilePorts(ports: { upload?: PrevisUpload; resolveUrl?: PrevisResolveUrl } | null) {
    upload = ports?.upload ?? localUpload;
    resolveUrl = ports?.resolveUrl ?? localResolve;
}

/** Persist a blob and return its address. */
export async function uploadMediaFile(blob: Blob, prefix = "file"): Promise<PrevisUploadedFile> {
    return upload(blob, prefix);
}

/** Turn a storage key back into something an <img>/<video>/GLTFLoader can load. */
export async function resolveMediaUrl(storageKey?: string, fallback = ""): Promise<string> {
    return resolveUrl(storageKey, fallback);
}

export const resolveImageUrl = resolveMediaUrl;
