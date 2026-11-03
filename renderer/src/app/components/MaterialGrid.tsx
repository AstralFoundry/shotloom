import { t } from '@/i18n';
import { memo, useEffect, useRef, useState } from "react";
import { formatSize } from "../../utils/format.ts";
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
  selectedKeys?: Set<string>;
  onToggleSelected?: (item: MaterialItem) => void;
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
        image: t("ui.canvasMediaActions.text.be8da62e"),
        video: t("ui.canvasMediaActions.text.fa4e33b6"),
        audio: t("ui.canvasAdapter.label.461189f1"),
        text: t("ui.canvasAdapter.label.f1926e9b"),
        file: t("ui.MaterialGrid.file.49deaf7d"),
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
  const extension = String(file.ext || file.name?.split(".").pop() || "").replace(/^\./, "");
  const placeholderLabel = failed
    ? t("ui.MaterialGrid.text.9e2d570c")
    : extension
      ? `.${extension.toUpperCase()}`
      : typeOf(file);
  const poster =
    kind === "video" && String(file.previewUrl || "") !== source
      ? String(file.previewUrl || "")
      : undefined;
  return (
    <div
      ref={host}
      className={`material-node-preview is-${kind} layout-${layout}${canPreview ? " can-enlarge" : ""}`}
      title={canPreview ? t("ui.ResourcePreview.text.e907bb32") : ""}
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
          <IconSymbol name={kind === "text" ? "file" : iconOf(file)} />
          <span>{placeholderLabel}</span>
        </div>
      )}
    </div>
  );
});

export function MaterialGrid({
  materials,
  selectedKeys,
  onToggleSelected,
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
            className={`material-node-wrap${clickToApply ? " selectable" : ""}${selectedKeys?.has(key) ? " is-batch-selected" : ""}`}
            onClick={() => clickToApply && action("apply-to-canvas")}
          >
            <div className="material-node">
              {onToggleSelected && <button type="button" className="material-batch-check" title={selectedKeys?.has(key) ? t("ui.MaterialGrid.text.f02e9439") : t("ui.MaterialGrid.text.2d9e0489")} aria-pressed={Boolean(selectedKeys?.has(key))} onClick={(event) => { event.stopPropagation(); onToggleSelected(file); }}><IconSymbol name={selectedKeys?.has(key) ? "check" : "plus"} /></button>}
              <MaterialPreview file={file} kind={kind} onPreview={onPreview} />
              <div className="material-node-kicker">
                <IconSymbol name={iconOf(file)} />
                <strong title={file.name}>{file.name || t("ui.canvasUploadActions.text.460d54d3")}</strong>
                <em>
                  {typeOf(file)} · {formatSize(file.size)}
                </em>
                {file.scopeLabel && (
                  <span className={`material-scope scope-${file.storageScope || "project"}`}>
                    {file.scopeLabel}
                    {file.usageCount ? ` · ${file.usageCount}` : ""}
                  </span>
                )}
                {inLibrary && <i title={t("ui.MaterialGrid.title.7b1cd8a3")} />}
              </div>
              <div className="material-node-actions">
                {showApplyAction && (
                  <button
                    title={t("ui.MaterialGrid.title.d4ed9b8c")}
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
                    title={inLibrary ? t("ui.MaterialGrid.title.7b1cd8a3") : t("ui.MaterialGrid.text.0b5398b6")}
                    onClick={(e) => {
                      e.stopPropagation();
                      action("add-to-library");
                    }}
                  >
                    <IconSymbol name={inLibrary ? "task" : "plus"} />
                  </button>
                )}
                {showPromoteAction && !file.localLibraryAssetId && (
                  <button title={t("ui.MaterialGrid.title.7316795e")} onClick={() => action("promote-local")}>
                    <IconSymbol name="archive" />
                  </button>
                )}
                {showReferenceAction && !file.inCurrentProject && (
                  <button title={t("ui.MaterialGrid.title.32ce8bdc")} onClick={() => action("reference-project")}>
                    <IconSymbol name="link" />
                  </button>
                )}
                {showCopyAction && file.projectStorageScope !== "project" && (
                  <button title={t("ui.MaterialGrid.title.7987a046")} onClick={() => action("copy-project")}>
                    <IconSymbol name="copy" />
                  </button>
                )}
                {showFileAction && file.path && (
                  <button
                    title={t("ui.MaterialGrid.title.1213bb4b")}
                    onClick={(event) => {
                      event.stopPropagation();
                      action("show-file");
                    }}
                  >
                    <IconSymbol name="folder" />
                  </button>
                )}
                {showRenameAction && (
                  <button title={t("ui.MaterialGrid.title.4d913176")} onClick={() => action("rename-item")}>
                    <IconSymbol name="pencil" />
                  </button>
                )}
                {showDeleteAction && (
                  <button
                    title={t("ui.MaterialGrid.title.3755f56f")}
                    className="danger"
                    onClick={(event) => {
                      event.stopPropagation();
                      action("delete-item");
                    }}
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
