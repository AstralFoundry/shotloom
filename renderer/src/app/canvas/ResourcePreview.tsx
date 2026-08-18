import { desktopApi } from "../../services/desktopApi.js";
import { type IconName, IconSymbol } from "../components/IconSymbol";
import { openMediaViewer, showToast } from "../store/overlayStore";
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
    node.title || "资源";
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
      result?.ok === false ? result.error || "打开文件失败" : "已打开文件",
    );
  }
  async function showFile() {
    const result = await desktopApi.file.showItemInFolder?.(filePath);
    showToast(
      result?.ok === false ? result.error || "无法定位文件" : "已定位文件",
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
    if (result) showToast("文件已另存");
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
        title={["image", "video"].includes(kind) && url ? "双击放大预览" : ""}
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
            ? "生成结果"
            : node.materialId
            ? "素材资源"
            : kind === "file"
            ? "文件资源"
            : `${kind} 资源`}
        </em>
      </div>
      <div className="resource-actions">
        {filePath && (
          <button title="打开文件" onClick={() => void openFile()}>
            <IconSymbol name="maximize" />
          </button>
        )}
        {filePath && (
          <button title="定位文件" onClick={() => void showFile()}>
            <IconSymbol name="folder" />
          </button>
        )}
        {(filePath || inlineText) && (
          <button
            title="另存为"
            onClick={() => void saveFile()}
          >
            <IconSymbol name="download" />
          </button>
        )}
        {inlineText && (
          <button
            title="复制文本"
            onClick={() =>
              void navigator.clipboard?.writeText(previewText).then(() =>
                showToast("文本已复制")
              )}
          >
            <IconSymbol name="copy" />
          </button>
        )}
        <button title="替换资源" onClick={onReplace}>
          <IconSymbol name="refresh" />
        </button>
        <button title="作为输入" onClick={onUse}>
          <IconSymbol name="link" />
        </button>
        <button title="归档资源" onClick={onArchive}>
          <IconSymbol name="archive" />
        </button>
      </div>
    </div>
  );
}
