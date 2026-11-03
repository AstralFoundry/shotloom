import { t } from '@/i18n';
import { desktopApi } from "../../services/desktopApi.ts";
import { type IconName, IconSymbol } from "../components/IconSymbol";
import { openMediaViewer } from "../store/overlayStore";
import { showToast } from "../../store/notificationStore";
import type { WorkflowNodeData } from "./WorkflowCanvas";
import { useMediaPreviewCache } from "./useMediaPreviewCache";

type Kind = "image" | "video" | "audio" | "text" | "file";
const exts = {
  image: ["png", "jpg", "jpeg", "webp", "gif", "avif", "bmp", "svg"],
  video: ["mp4", "mov", "webm", "m4v"],
  audio: ["mp3", "wav", "m4a", "aac", "ogg", "flac"],
  text: ["txt", "md", "json", "csv", "log"],
} as const;
const stringValue = (value: unknown) => typeof value === "string" ? value : "";
const basename = (value: string) =>
  value.split(/[\\/]/).filter(Boolean).pop() || "";

export function ResourcePreview(
  { node, onUse, onReplace, onArchive }: {
    node: WorkflowNodeData;
    onUse: () => void;
    onReplace: () => void;
    onArchive: () => void;
  },
) {
  const filePath = stringValue(node.filePath);
  const content = stringValue(node.content);
  const displayPath = filePath || stringValue(node.url) ||
    stringValue(node.resourceUrl) || stringValue(node.previewUrl) || content;
  const displayName = stringValue(node.fileName) || basename(displayPath) ||
    node.title || t("ui.ResourcePreview.text.c5ca3950");
  const extension = ([
    node.fileName,
    node.filePath,
    node.url,
    node.resourceUrl,
    node.previewUrl,
    node.content,
  ].filter(Boolean).join(" ").match(/\.([a-z0-9]+)(?:[?#\s]|$)/i)?.[1] || "")
    .toLowerCase();
  const resourceType = stringValue(node.resourceType || node.mediaType)
    .toLowerCase();
  const inlineText = !filePath && !node.url && !node.resourceUrl &&
    !node.previewUrl && Boolean(content.trim()) &&
    !/^https?:\/\//i.test(content) &&
    !(/^[a-z]:[\\/]/i.test(content) || content.startsWith("/") ||
      content.includes("\\"));
  const kind =
    (Object.keys(exts) as Array<Exclude<Kind, "file">>).find((item) =>
      resourceType.includes(item) || exts[item].includes(extension as never)
    ) || (inlineText ? "text" : "file");
  const previewText = content.trim().slice(0, 360) || displayName;
  const { url, buffered, retryBuffered } = useMediaPreviewCache({
    path: filePath,
    kind,
    mimeType: stringValue(node.mimeType),
    maxSize: 960,
    revision: stringValue(node.updatedAt || node.id),
    fallbackUrl: displayPath,
  });

  async function openFile() {
    const result = await desktopApi.file.openPath?.(filePath);
    showToast(
      result?.ok === false ? result.error || t("ui.ResourcePreview.text.2da57b88") : t("ui.ResourcePreview.text.feff916a"),
    );
  }
  async function showFile() {
    const result = await desktopApi.file.showItemInFolder?.(filePath);
    showToast(
      result?.ok === false ? result.error || t("ui.ResourcePreview.text.85a94b9a") : t("ui.ResourcePreview.text.02c0b842"),
    );
  }
  async function saveFile() {
    const buffer = filePath
      ? await desktopApi.file.readArrayBuffer(filePath)
      : new TextEncoder().encode(previewText).buffer;
    const result = await desktopApi.file.saveArrayBuffer(
      displayName || "resource",
      buffer,
    );
    if (result) showToast(t("ui.ResourcePreview.text.aa66ecb0"));
  }
  const icon: IconName = kind === "video"
    ? "play"
    : kind === "audio"
    ? "sliders"
    : kind === "image"
    ? "image"
    : "package";
  return (
    <div className="resource-preview">
      <div
        className={`resource-media resource-media-${kind}${
          ["image", "video"].includes(kind) && url ? " can-enlarge" : ""
        }`}
        title={["image", "video"].includes(kind) && url ? t("ui.ResourcePreview.text.e907bb32") : ""}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if ((kind === "image" || kind === "video") && url) {
            openMediaViewer({
              src: url,
              kind,
              title: displayName,
              filePath,
            });
          }
        }}
      >
        {kind === "image" && url
          ? <img src={url} alt={displayName} loading="lazy" />
          : kind === "video" && url
          ? <video src={url} controls preload="metadata" onError={() => !buffered && retryBuffered()} />
          : kind === "audio" && url
          ? <audio src={url} controls preload="metadata" onError={() => !buffered && retryBuffered()} />
          : kind === "text"
          ? <pre>{previewText}</pre>
          : (
            <div className="resource-placeholder">
              <IconSymbol name={icon} />
            </div>
          )}
      </div>
      <div className="resource-meta">
        <span title={displayPath}>{displayName}</span>
        <em>
          {node.source === "generation"
            ? t("ui.ResourcePreview.text.99045f8e")
            : node.materialId
            ? t("ui.ResourcePreview.text.e475f3bc")
            : kind === "file"
            ? t("ui.ResourcePreview.text.215bdd8f")
            : t("ui.ResourcePreview.text.41a0cd7c", { value0: kind })}
        </em>
      </div>
      <div className="resource-actions">
        {filePath && (
          <button title={t("ui.ResourcePreview.title.38820b3d")} onClick={() => void openFile()}>
            <IconSymbol name="maximize" />
          </button>
        )}
        {filePath && (
          <button title={t("ui.ResourcePreview.title.6cd39eba")} onClick={() => void showFile()}>
            <IconSymbol name="folder" />
          </button>
        )}
        {(filePath || inlineText) && (
          <button
            title={t("ui.ResourcePreview.title.a86b5bd5")}
            onClick={() => void saveFile()}
          >
            <IconSymbol name="download" />
          </button>
        )}
        {inlineText && (
          <button
            title={t("ui.ResourcePreview.title.4641d26b")}
            onClick={() =>
              void navigator.clipboard?.writeText(previewText).then(() =>
                showToast(t("ui.CanvasNodeToolbar.text.605dc592"))
              )}
          >
            <IconSymbol name="copy" />
          </button>
        )}
        <button title={t("ui.canvasAdapter.text.43ccbabf")} onClick={onReplace}>
          <IconSymbol name="refresh" />
        </button>
        <button title={t("ui.ResourcePreview.title.ce616141")} onClick={onUse}>
          <IconSymbol name="link" />
        </button>
        <button title={t("ui.canvasAdapter.text.54265bf6")} onClick={onArchive}>
          <IconSymbol name="archive" />
        </button>
      </div>
    </div>
  );
}
