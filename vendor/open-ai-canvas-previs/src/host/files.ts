/**
 * File host port.
 *
 * The workbench streams Blobs (screenshots, clay passes, depth videos) and has to name them
 * in the embedding application's file layout. The host installs the three helpers; without a
 * host they degrade to browser-only behaviour so the engine still runs standalone.
 */

export type PrevisUploadedFile = {
    url: string;
    storageKey: string;
    bytes: number;
    mimeType: string;
};

export type PrevisUpload = (blob: Blob, prefix: string) => Promise<PrevisUploadedFile>;
export type PrevisResolveUrl = (storageKey?: string, fallback?: string) => Promise<string>;

const objectUrls = new Map<string, string>();

function objectUrl(blob: Blob, key: string) {
    const existing = objectUrls.get(key);
    if (existing) return existing;
    const url = URL.createObjectURL(blob);
    objectUrls.set(key, url);
    return url;
}

const fallbackUpload: PrevisUpload = async (blob, prefix) => {
    const key = `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
    return { url: objectUrl(blob, key), storageKey: key, bytes: blob.size, mimeType: blob.type };
};

const fallbackResolve: PrevisResolveUrl = async (storageKey, fallback = "") => objectUrls.get(storageKey ?? "") ?? fallback;

let upload: PrevisUpload = fallbackUpload;
let resolveUrl: PrevisResolveUrl = fallbackResolve;

export function setPrevisFilePorts(ports: { upload?: PrevisUpload; resolveUrl?: PrevisResolveUrl } | null) {
    upload = ports?.upload ?? fallbackUpload;
    resolveUrl = ports?.resolveUrl ?? fallbackResolve;
}

/** Persist a blob through the host and return its address. */
export async function uploadMediaFile(blob: Blob, prefix = "file"): Promise<PrevisUploadedFile> {
    return upload(blob, prefix);
}

/** Turn a host storage key back into something an <img>/<video>/GLTFLoader can load. */
export async function resolveMediaUrl(storageKey?: string, fallback = ""): Promise<string> {
    return resolveUrl(storageKey, fallback);
}

/** Only used for host image nodes that still carry the old per-service resolver. */
export const resolveImageUrl = resolveMediaUrl;
