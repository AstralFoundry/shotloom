import { desktopApi } from "./desktopApi.js";
import { BoundedMediaCache } from "./boundedMediaCache.mjs";

export type CachedMediaKind = "image" | "video" | "audio";
export type CachedMediaLease = {
  key: string;
  kind: CachedMediaKind;
  url: string;
  bytes: number;
  release: () => void;
};

const MIB = 1024 * 1024;
const cache = new BoundedMediaCache({
  kindBudgets: { image: 128 * MIB, video: 192 * MIB, audio: 64 * MIB },
  totalBudget: 256 * MIB,
  maxEntries: 512,
  maxEntryBytes: 128 * MIB,
});

function extensionMime(path: string, kind: CachedMediaKind): string {
  const extension = path.split(/[?#]/)[0].split(".").pop()?.toLowerCase() || "";
  const known: Record<string, string> = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
    gif: "image/gif", avif: "image/avif", bmp: "image/bmp", svg: "image/svg+xml",
    mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm",
    mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", aac: "audio/aac",
    ogg: "audio/ogg", flac: "audio/flac",
  };
  return known[extension] || `${kind}/*`;
}

export function mediaPreviewCacheKey(input: {
  path: string;
  kind: CachedMediaKind;
  maxSize?: number;
  revision?: string;
  buffered?: boolean;
}): string {
  return [
    input.path,
    input.kind,
    input.buffered ? "buffered" : `preview:${input.maxSize || 0}`,
    input.revision || "",
  ].join("\u0000");
}

export async function acquireMediaPreview(input: {
  path: string;
  kind: CachedMediaKind;
  mimeType?: string;
  maxSize?: number;
  revision?: string;
  buffered?: boolean;
}): Promise<CachedMediaLease> {
  const key = mediaPreviewCacheKey(input);
  const maxEntryBytes = input.kind === "image" ? 48 * MIB : input.kind === "audio" ? 64 * MIB : 128 * MIB;
  return cache.acquire(key, {
    kind: input.kind,
    maxEntryBytes,
    load: async () => {
      let buffer: ArrayBuffer | undefined;
      let mime = input.mimeType || extensionMime(input.path, input.kind);
      if (input.kind === "image" && !input.buffered && desktopApi.file.readImagePreview) {
        try {
          buffer = await desktopApi.file.readImagePreview(input.path, input.maxSize || 960);
          mime = "image/jpeg";
        } catch {
          buffer = await desktopApi.file.readArrayBuffer?.(input.path);
        }
      } else {
        buffer = await desktopApi.file.readArrayBuffer?.(input.path);
      }
      if (!buffer) throw new Error("无法读取媒体预览");
      const maxSize = input.maxSize || 960;
      const costBytes = input.kind === "image" && !input.buffered
        ? Math.max(buffer.byteLength, maxSize * maxSize * 4)
        : buffer.byteLength;
      return { buffer, mime, costBytes };
    },
  });
}

export function mediaPreviewCacheDiagnostics() {
  return cache.diagnostics();
}

export function relieveMediaPreviewCache(level: "low" | "critical" = "low") {
  return cache.relieve(level);
}

export function installMediaPreviewCacheMemoryPressureListener(): () => void {
  const listener = (event: Event) => {
    const level = (event as CustomEvent)?.detail?.level === "critical" ? "critical" : "low";
    relieveMediaPreviewCache(level);
  };
  window.addEventListener("shotloom-memory-pressure", listener);
  return () => window.removeEventListener("shotloom-memory-pressure", listener);
}
