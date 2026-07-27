import { useEffect, useMemo, useState } from "react";
import { desktopApi } from "../../services/desktopApi.js";
import { formatSize } from "../../utils/format.js";
import { type IconName, IconSymbol } from "./IconSymbol";

export interface MaterialItem {
  id?: string;
  name?: string;
  path?: string;
  ext?: string;
  size?: number;
  mimeType?: string;
  resourceType?: string;
  previewUrl?: string;
  url?: string;
  resourceUrl?: string;
  scopeLabel?: string;
  storageScope?: string;
  usageCount?: number;
  localLibraryAssetId?: string;
  inCurrentProject?: boolean;
  projectStorageScope?: string;
  assetId?: string;
  [key: string]: unknown;
}

interface MaterialGridProps {
  materials: MaterialItem[];
  assetMaterialIds?: Set<string>;
  showLibraryAction?: boolean;
  showApplyAction?: boolean;
  showPromoteAction?: boolean;
  showReferenceAction?: boolean;
  showCopyAction?: boolean;
  clickToApply?: boolean;
  showFileAction?: boolean;
  showRenameAction?: boolean;
  showDeleteAction?: boolean;
  onPreview: (item: MaterialItem, src: string, kind: "image" | "video") => void;
  onAction: (
    action:
      | "show-file"
      | "add-to-library"
      | "apply-to-canvas"
      | "rename-item"
      | "delete-item"
      | "promote-local"
      | "reference-project"
      | "copy-project",
    item: MaterialItem,
  ) => void;
}

type Kind = "image" | "video" | "audio" | "text" | "file";
const extensions: Record<Exclude<Kind, "file">, string[]> = {
  image: ["png", "jpg", "jpeg", "webp", "gif", "avif", "bmp", "svg"],
  video: ["mp4", "mov", "webm", "m4v"],
  audio: ["mp3", "wav", "m4a", "aac", "ogg", "flac"],
  text: ["txt", "md", "json", "csv", "log"],
};
const mimeTypes: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
};

function keyOf(file: MaterialItem) {
  return String(file.id || file.path || file.name || "");
}
function kindOf(file: MaterialItem): Kind {
  const type = String(file.resourceType || "").toLowerCase();
  const ext =
    String(file.ext || file.name || "").split(".").pop()?.toLowerCase() || "";
  return (Object.keys(extensions) as Array<Exclude<Kind, "file">>).find((
    kind,
  ) => type.includes(kind) || extensions[kind].includes(ext)) || "file";
}
function iconOf(file: MaterialItem): IconName {
  return ({
    image: "image",
    video: "play",
    audio: "sliders",
    text: "chat",
    file: "package",
  } as const)[kindOf(file)];
}
function typeOf(file: MaterialItem) {
  return ({
    image: "图片",
    video: "视频",
    audio: "音频",
    text: "文本",
    file: "文件",
  } as const)[kindOf(file)] || file.ext || "-";
}
function staticUrl(file: MaterialItem) {
  const raw = String(
    file.previewUrl || file.url || file.resourceUrl || file.path || "",
  ).trim();
  if (!raw) return "";
  if (/^(https?:|blob:|data:|file:)/i.test(raw)) return raw;
  if (
    !(/^[a-z]:[\\/]/i.test(raw) || raw.startsWith("/") || raw.includes("\\"))
  ) return "";
  const normalized = raw.replace(/\\/g, "/");
  const encoded = normalized.split("/").map(encodeURIComponent).join("/");
  return /^[a-z]:\//i.test(normalized)
    ? `file:///${normalized.slice(0, 2)}/${
      normalized.slice(3).split("/").map(encodeURIComponent).join("/")
    }`
    : `file://${encoded}`;
}

export function MaterialGrid({
  materials,
  assetMaterialIds = new Set(),
  showLibraryAction = true,
  showApplyAction = false,
  showPromoteAction = false,
  showReferenceAction = false,
  showCopyAction = false,
  clickToApply = false,
  showFileAction = true,
  showRenameAction = true,
  showDeleteAction = true,
  onPreview,
  onAction,
}: MaterialGridProps) {
  const [broken, setBroken] = useState<Set<string>>(new Set());
  const [blobUrls, setBlobUrls] = useState<Record<string, string>>({});
  const signature = useMemo(
    () =>
      materials.map((file) =>
        `${keyOf(file)}:${file.path || ""}:${file.ext || ""}`
      ).join("|"),
    [materials],
  );

  useEffect(() => {
    let cancelled = false;
    const urls: Record<string, string> = {};
    const failed = new Set<string>();
    async function prepare() {
      for (const file of materials) {
        const key = keyOf(file);
        if (!key || kindOf(file) !== "image" || !file.path) continue;
        try {
          let buffer: ArrayBuffer | undefined;
          for (
            let attempt = 0;
            attempt < 2 && !buffer?.byteLength;
            attempt += 1
          ) {
            try {
              buffer = await desktopApi.file.readArrayBuffer(file.path);
            } catch {
              if (attempt === 1) throw new Error("read failed");
            }
            if (!buffer?.byteLength) {
              await new Promise((resolve) => window.setTimeout(resolve, 80));
            }
          }
          if (!buffer?.byteLength) throw new Error("empty image");
          urls[key] = URL.createObjectURL(
            new Blob([buffer], {
              type: mimeTypes[String(file.ext || "").toLowerCase()] ||
                file.mimeType || "application/octet-stream",
            }),
          );
        } catch {
          failed.add(key);
        }
      }
      if (cancelled) {
        Object.values(urls).forEach(URL.revokeObjectURL);
        return;
      }
      setBlobUrls((previous) => {
        Object.values(previous).forEach(URL.revokeObjectURL);
        return urls;
      });
      setBroken(failed);
    }
    void prepare();
    return () => {
      cancelled = true;
    };
  }, [signature]);
  useEffect(() => () => {
    Object.values(blobUrls).forEach(URL.revokeObjectURL);
  }, [blobUrls]);

  return (
    <div className="material-node-grid">
      {materials.map((file) => {
        const key = keyOf(file);
        const kind = kindOf(file);
        const src = blobUrls[key] || staticUrl(file);
        const inLibrary = Boolean(file.id && assetMaterialIds.has(file.id));
        const action = (name: Parameters<MaterialGridProps["onAction"]>[0]) =>
          onAction(name, file);
        return (
          <article
            key={key}
            className={`material-node-wrap${clickToApply ? " selectable" : ""}`}
            onClick={() => clickToApply && action("apply-to-canvas")}
          >
            <div className="material-node-kicker">
              <IconSymbol name={iconOf(file)} />
              <strong title={file.name}>{file.name || "未命名文件"}</strong>
              <em>{typeOf(file)} · {formatSize(file.size)}</em>
              {file.scopeLabel && (
                <span
                  className={`material-scope scope-${
                    file.storageScope || "project"
                  }`}
                >
                  {file.scopeLabel}
                  {file.usageCount ? ` · ${file.usageCount}` : ""}
                </span>
              )}
              {inLibrary && <i title="已收录到素材库" />}
            </div>
            <div className="material-node">
              <div
                className={`material-node-preview is-${kind}${
                  ["image", "video"].includes(kind) && src ? " can-enlarge" : ""
                }`}
                title={["image", "video"].includes(kind) && src
                  ? "双击放大预览"
                  : ""}
                onDoubleClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if ((kind === "image" || kind === "video") && src) {
                    onPreview(file, src, kind);
                  }
                }}
              >
                {kind === "image" && src && !broken.has(key)
                  ? (
                    <img
                      src={src}
                      alt={file.name || ""}
                      loading="lazy"
                      onError={() =>
                        setBroken((items) => new Set(items).add(key))}
                    />
                  )
                  : kind === "video" && src && !broken.has(key)
                  ? (
                    <video
                      src={src}
                      controls
                      preload="metadata"
                      onError={() =>
                        setBroken((items) => new Set(items).add(key))}
                    />
                  )
                  : kind === "audio" && src && !broken.has(key)
                  ? (
                    <audio
                      src={src}
                      controls
                      preload="metadata"
                      onError={() =>
                        setBroken((items) => new Set(items).add(key))}
                    />
                  )
                  : (
                    <div className="material-node-placeholder">
                      <IconSymbol
                        name={kind === "text" ? "chat" : iconOf(file)}
                      />
                      <span>
                        {kind === "text"
                          ? "文本素材"
                          : broken.has(key)
                          ? "无法预览"
                          : file.ext || typeOf(file)}
                      </span>
                    </div>
                  )}
              </div>
              <div className="material-node-actions">
                {showApplyAction && (
                  <button
                    title="应用到画布"
                    onClick={(e) => {
                      e.stopPropagation();
                      action("apply-to-canvas");
                    }}
                  >
                    <IconSymbol name="cursor" />
                  </button>
                )}
                {showLibraryAction && (
                  <button
                    disabled={inLibrary}
                    title={inLibrary ? "已收录到素材库" : "加入素材库"}
                    onClick={(e) => {
                      e.stopPropagation();
                      action("add-to-library");
                    }}
                  >
                    <IconSymbol name={inLibrary ? "task" : "plus"} />
                  </button>
                )}
                {showPromoteAction && !file.localLibraryAssetId && (
                  <button
                    title="加入通用素材库"
                    onClick={() => action("promote-local")}
                  >
                    <IconSymbol name="archive" />
                  </button>
                )}
                {showReferenceAction && !file.inCurrentProject && (
                  <button
                    title="引用到当前项目"
                    onClick={() => action("reference-project")}
                  >
                    <IconSymbol name="link" />
                  </button>
                )}
                {showCopyAction && file.projectStorageScope !== "project" && (
                  <button
                    title="复制到当前项目"
                    onClick={() => action("copy-project")}
                  >
                    <IconSymbol name="copy" />
                  </button>
                )}
                {showFileAction && file.path && (
                  <button
                    title="所在位置"
                    onClick={() => action("show-file")}
                  >
                    <IconSymbol name="folder" />
                  </button>
                )}
                {showRenameAction && (
                  <button
                    title="改名"
                    onClick={() => action("rename-item")}
                  >
                    <IconSymbol name="pencil" />
                  </button>
                )}
                {showDeleteAction && (
                  <button
                    title="删除"
                    className="danger"
                    onClick={() => action("delete-item")}
                  >
                    <IconSymbol name="trash" />
                  </button>
                )}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
