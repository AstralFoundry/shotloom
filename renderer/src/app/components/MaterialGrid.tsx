import { memo, useEffect, useRef, useState } from "react";
import { formatSize } from "../../utils/format.js";
import { useMediaPreviewCache } from "../canvas/useMediaPreviewCache";
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
function keyOf(file: MaterialItem) {
  return String(file.id || file.path || file.name || "");
}
function kindOf(file: MaterialItem): Kind {
  const type = String(file.resourceType || "").toLowerCase();
  const ext =
    String(file.ext || file.name || "")
      .split(".")
      .pop()
      ?.toLowerCase() || "";
  return (
    (Object.keys(extensions) as Array<Exclude<Kind, "file">>).find(
      (kind) => type.includes(kind) || extensions[kind].includes(ext),
    ) || "file"
  );
}
function iconOf(file: MaterialItem): IconName {
  return (
    {
      image: "image",
      video: "play",
      audio: "sliders",
      text: "chat",
      file: "package",
    } as const
  )[kindOf(file)];
}
function typeOf(file: MaterialItem) {
  return (
    (
      {
        image: "图片",
        video: "视频",
        audio: "音频",
        text: "文本",
        file: "文件",
      } as const
    )[kindOf(file)] ||
    file.ext ||
    "-"
  );
}
function remoteUrl(file: MaterialItem, kind: Kind) {
  const candidates =
    kind === "video"
      ? [file.url, file.resourceUrl, file.previewUrl]
      : [file.previewUrl, file.url, file.resourceUrl];
  return (
    candidates
      .map((value) => String(value || "").trim())
      .find((value) => /^(https?:|blob:|data:)/i.test(value)) || ""
  );
}

const previewActivators = new Map<Element, () => void>();
let sharedPreviewObserver: IntersectionObserver | null = null;

function observeNearViewport(element: Element, activate: () => void) {
  if (typeof IntersectionObserver === "undefined") {
    activate();
    return () => {};
  }
  if (!sharedPreviewObserver) {
    sharedPreviewObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const callback = previewActivators.get(entry.target);
          if (!callback) continue;
          previewActivators.delete(entry.target);
          sharedPreviewObserver?.unobserve(entry.target);
          callback();
        }
      },
      { rootMargin: "360px 0px" },
    );
  }
  previewActivators.set(element, activate);
  sharedPreviewObserver.observe(element);
  return () => {
    previewActivators.delete(element);
    sharedPreviewObserver?.unobserve(element);
  };
}

const MaterialPreview = memo(function MaterialPreview({
  file,
  kind,
  onPreview,
}: {
  file: MaterialItem;
  kind: Kind;
  onPreview: MaterialGridProps["onPreview"];
}) {
  const host = useRef<HTMLDivElement>(null);
  const [activated, setActivated] = useState(false);
  const [failed, setFailed] = useState(false);
  const [layout, setLayout] = useState<"landscape" | "portrait" | "tall">("landscape");
  const path = String(file.path || "");
  const fallbackSource = remoteUrl(file, kind);
  const {
    url: source,
    buffered: useBufferedMedia,
    retryBuffered,
  } = useMediaPreviewCache({
    path,
    kind,
    mimeType: String(file.mimeType || ""),
    maxSize: 640,
    revision: String(file.updatedAt || file.importedAt || file.id || ""),
    fallbackUrl: fallbackSource,
    enabled: activated,
  });

  useEffect(() => {
    const element = host.current;
    if (!element || activated) return;
    return observeNearViewport(element, () => setActivated(true));
  }, [activated]);

  useEffect(() => setFailed(false), [activated, fallbackSource, kind, path]);

  function mediaError() {
    if (
      path &&
      (kind === "video" || kind === "audio") &&
      !useBufferedMedia
    ) {
      retryBuffered();
    } else {
      setFailed(true);
    }
  }

  function updateLayout(width: number, height: number) {
    if (!(width > 0) || !(height > 0)) return;
    const ratio = width / height;
    setLayout(ratio < 0.62 ? "tall" : ratio < 0.9 ? "portrait" : "landscape");
  }

  const canPreview = (kind === "image" || kind === "video") && Boolean(source) && !failed;
  const poster =
    kind === "video" && String(file.previewUrl || "") !== source
      ? String(file.previewUrl || "")
      : undefined;
  return (
    <div
      ref={host}
      className={`material-node-preview is-${kind} layout-${layout}${canPreview ? " can-enlarge" : ""}`}
      title={canPreview ? "双击放大预览" : ""}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (canPreview) onPreview(file, source, kind);
      }}
    >
      {activated && kind === "image" && source && !failed ? (
        <img
          src={source}
          alt={file.name || ""}
          loading="lazy"
          decoding="async"
          onLoad={(event) => {
            const image = event.currentTarget;
            updateLayout(image.naturalWidth, image.naturalHeight);
          }}
          onError={mediaError}
        />
      ) : activated && kind === "video" && source && !failed ? (
        <video
          src={source}
          poster={poster}
          controls
          playsInline
          preload="metadata"
          onPointerDown={(event) => event.stopPropagation()}
          onLoadedMetadata={(event) => {
            const video = event.currentTarget;
            updateLayout(video.videoWidth, video.videoHeight);
            if (video.currentTime === 0 && video.duration > 0) {
              video.currentTime = Math.min(1 / 30, Math.max(0, video.duration - 0.04));
            }
          }}
          onError={mediaError}
        />
      ) : activated && kind === "audio" && source && !failed ? (
        <audio
          src={source}
          controls
          preload="metadata"
          onPointerDown={(event) => event.stopPropagation()}
          onError={mediaError}
        />
      ) : (
        <div className="material-node-placeholder">
          <IconSymbol name={kind === "text" ? "chat" : iconOf(file)} />
          <span>
            {kind === "text" ? "文本素材" : failed ? "无法预览" : file.ext || typeOf(file)}
          </span>
        </div>
      )}
    </div>
  );
});

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
  return (
    <div className="material-node-grid">
      {materials.map((file) => {
        const key = keyOf(file);
        const kind = kindOf(file);
        const inLibrary = Boolean(file.id && assetMaterialIds.has(file.id));
        const action = (name: Parameters<MaterialGridProps["onAction"]>[0]) => onAction(name, file);
        return (
          <article
            key={key}
            className={`material-node-wrap${clickToApply ? " selectable" : ""}`}
            onClick={() => clickToApply && action("apply-to-canvas")}
          >
            <div className="material-node-kicker">
              <IconSymbol name={iconOf(file)} />
              <strong title={file.name}>{file.name || "未命名文件"}</strong>
              <em>
                {typeOf(file)} · {formatSize(file.size)}
              </em>
              {file.scopeLabel && (
                <span className={`material-scope scope-${file.storageScope || "project"}`}>
                  {file.scopeLabel}
                  {file.usageCount ? ` · ${file.usageCount}` : ""}
                </span>
              )}
              {inLibrary && <i title="已收录到素材库" />}
            </div>
            <div className="material-node">
              <MaterialPreview file={file} kind={kind} onPreview={onPreview} />
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
                  <button title="加入通用素材库" onClick={() => action("promote-local")}>
                    <IconSymbol name="archive" />
                  </button>
                )}
                {showReferenceAction && !file.inCurrentProject && (
                  <button title="引用到当前项目" onClick={() => action("reference-project")}>
                    <IconSymbol name="link" />
                  </button>
                )}
                {showCopyAction && file.projectStorageScope !== "project" && (
                  <button title="复制到当前项目" onClick={() => action("copy-project")}>
                    <IconSymbol name="copy" />
                  </button>
                )}
                {showFileAction && file.path && (
                  <button title="所在位置" onClick={() => action("show-file")}>
                    <IconSymbol name="folder" />
                  </button>
                )}
                {showRenameAction && (
                  <button title="改名" onClick={() => action("rename-item")}>
                    <IconSymbol name="pencil" />
                  </button>
                )}
                {showDeleteAction && (
                  <button title="删除" className="danger" onClick={() => action("delete-item")}>
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
