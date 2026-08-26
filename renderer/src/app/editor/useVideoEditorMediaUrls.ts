import { useEffect, useRef, useState } from "react";
import { editorMediaMimeType } from "../../utils/editorMediaImport.mjs";
import { desktopApi } from "../../services/desktopApi.js";
import type { VideoEditorAsset } from "./videoEditorTypes";

interface RuntimeMediaUrl {
  sourceFile: string;
  url: string;
}

export function useVideoEditorMediaUrls(assets: VideoEditorAsset[]) {
  const runtimeBlobUrlsRef = useRef(new Map<string, RuntimeMediaUrl>());
  const [runtimeMediaUrls, setRuntimeMediaUrls] = useState<Record<string, string>>({});
  const assetSignature = assets
    .map((asset) => `${asset.id}:${asset.type}:${asset.sourceFile || ""}`)
    .join("|");

  useEffect(() => {
    let cancelled = false;
    const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
    for (const [assetId, entry] of runtimeBlobUrlsRef.current) {
      const asset = assetsById.get(assetId);
      if (asset?.sourceFile === entry.sourceFile) continue;
      URL.revokeObjectURL(entry.url);
      runtimeBlobUrlsRef.current.delete(assetId);
    }

    void Promise.all(assets.map(async (asset) => {
      const sourceFile = String(asset.sourceFile || "");
      if (!sourceFile || runtimeBlobUrlsRef.current.has(asset.id)) return;
      try {
        const buffer = await desktopApi.file.readArrayBuffer(sourceFile);
        if (cancelled || !buffer?.byteLength) return;
        const url = URL.createObjectURL(new Blob(
          [buffer],
          { type: editorMediaMimeType(sourceFile, asset.type) },
        ));
        const previous = runtimeBlobUrlsRef.current.get(asset.id);
        if (previous) URL.revokeObjectURL(previous.url);
        runtimeBlobUrlsRef.current.set(asset.id, { sourceFile, url });
      } catch {
        // Stable asset URLs remain available when buffered previews cannot be created.
      }
    })).then(() => {
      if (cancelled) return;
      setRuntimeMediaUrls(Object.fromEntries(
        [...runtimeBlobUrlsRef.current].map(([assetId, entry]) => [assetId, entry.url]),
      ));
    });

    return () => {
      cancelled = true;
    };
  }, [assetSignature]);

  useEffect(() => () => {
    for (const entry of runtimeBlobUrlsRef.current.values()) {
      URL.revokeObjectURL(entry.url);
    }
    runtimeBlobUrlsRef.current.clear();
  }, []);

  return runtimeMediaUrls;
}
