import { useEffect, useMemo, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { desktopApi } from "../../services/desktopApi.js";
import {
  acquireMediaPreview,
  type CachedMediaKind,
  type CachedMediaLease,
} from "../../services/mediaPreviewCache";
import { schedulePreviewLoad } from "./previewLoadQueue";

const supportedKinds = new Set(["image", "video", "audio"]);

export function useMediaPreviewCache(input: {
  path: string;
  kind: string;
  mimeType?: string;
  maxSize?: number;
  revision?: string;
  fallbackUrl?: string;
  enabled?: boolean;
}) {
  const [cachedUrl, setCachedUrl] = useState("");
  const [bufferedPath, setBufferedPath] = useState("");
  const path = input.path;
  const kind = input.kind as CachedMediaKind;
  const buffered = Boolean(path && bufferedPath === path);
  const streamUrl = useMemo(
    () => input.enabled !== false && path && (kind === "video" || kind === "audio") && desktopApi.platform !== "browser" && !buffered
      ? convertFileSrc(path)
      : "",
    [buffered, input.enabled, kind, path],
  );

  useEffect(() => {
    let cancelled = false;
    let lease: CachedMediaLease | null = null;
    let cancelLoad = () => {};
    setCachedUrl("");
    if (
      input.enabled !== false &&
      path &&
      supportedKinds.has(kind) &&
      (!streamUrl || buffered)
    ) {
      cancelLoad = schedulePreviewLoad(async () => {
        try {
          const acquired = await acquireMediaPreview({
            path,
            kind,
            mimeType: input.mimeType,
            maxSize: input.maxSize,
            revision: input.revision,
            buffered,
          });
          if (cancelled) {
            acquired.release();
            return;
          }
          lease = acquired;
          setCachedUrl(acquired.url);
        } catch {
          if (!cancelled) setCachedUrl("");
        }
      });
    }
    return () => {
      cancelled = true;
      cancelLoad();
      lease?.release();
    };
  }, [buffered, input.enabled, input.maxSize, input.mimeType, input.revision, kind, path, streamUrl]);

  const raw = String(input.fallbackUrl || "");
  const fallbackUrl = /^(https?:|blob:|data:|file:)/i.test(raw) ? raw : "";
  return {
    url: cachedUrl || streamUrl || fallbackUrl,
    buffered,
    retryBuffered() {
      if (path && (kind === "video" || kind === "audio") && !buffered) {
        setBufferedPath(path);
      }
    },
  };
}
