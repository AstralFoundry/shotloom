import { useMediaPreviewCache } from "./useMediaPreviewCache";

const extKinds = {
  image: ["png", "jpg", "jpeg", "webp", "gif", "avif", "bmp", "svg"],
  video: ["mp4", "mov", "webm", "m4v"],
  audio: ["mp3", "wav", "m4a", "aac", "ogg", "flac"],
  text: ["txt", "md", "json", "csv", "log"],
} as const;
export function generationMediaKind(item: Record<string, unknown>): "image" | "video" | "audio" | "text" | "" {
  const type = String(item.resourceType || item.mimeType || "").toLowerCase();
  const ext =
    String(item.fileName || item.filePath || item.url || item.previewUrl || "")
      .split(/[?#]/)[0]
      .split(".")
      .pop()
      ?.toLowerCase() || "";
  return (
    (Object.keys(extKinds) as Array<keyof typeof extKinds>).find(
      (kind) => type.includes(kind) || extKinds[kind].includes(ext as never),
    ) || (item.content ? "text" : "")
  );
}
function canvasPreviewMaxSize(semanticZoom: number) {
  const dpr = Number(globalThis.devicePixelRatio) || 1;
  const needed = 350 * Math.max(1, semanticZoom) * dpr;
  if (needed > 1536) return 2048;
  if (needed > 960) return 1536;
  return 960;
}
export function useGenerationLocalPreview(item: Record<string, unknown> | null, kind: string, previewZoom: number) {
  const path = String(item?.filePath || item?.path || "");
  const raw = String(item?.previewUrl || item?.url || item?.content || "");
  return useMediaPreviewCache({
    path,
    kind,
    mimeType: String(item?.mimeType || item?.type || ""),
    maxSize: kind === "image" ? canvasPreviewMaxSize(previewZoom) : undefined,
    revision: String(item?.restoredAt || item?.updatedAt || item?.createdAt || item?.id || ""),
    fallbackUrl: raw,
  });
}
