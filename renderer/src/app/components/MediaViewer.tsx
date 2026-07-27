import {
  type PointerEvent,
  useEffect,
  useRef,
  useState,
  type WheelEvent,
} from "react";
import { desktopApi } from "../../services/desktopApi.js";
import { IconSymbol } from "./IconSymbol";
import { showToast, useOverlayStore } from "../store/overlayStore";

const MIN_ZOOM = .5, MAX_ZOOM = 5, STEP = .25;
export function MediaViewer() {
  const media = useOverlayStore((state) => state.media);
  const close = useOverlayStore((state) => state.closeMedia);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const [fullSrc, setFullSrc] = useState("");
  const [textDraft, setTextDraft] = useState("");
  const panOrigin = useRef<{ x: number; y: number; id: number } | null>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const reset = () => {
    setZoom(1);
    setRotation(0);
    setPan({ x: 0, y: 0 });
  };
  const adjust = (delta: number) =>
    setZoom((value) => {
      const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value + delta));
      if (next <= 1) setPan({ x: 0, y: 0 });
      return next;
    });

  useEffect(() => {
    if (!media.open) return;
    reset();
    if (media.kind === "text") setTextDraft(media.src);
    backdrop.current?.focus({ preventScroll: true });
    let cancelled = false;
    let url = "";
    if (media.kind === "image" && media.filePath) {
      void desktopApi.file.readArrayBuffer?.(media.filePath).then(
        (buffer: ArrayBuffer) => {
          if (!cancelled && buffer?.byteLength) {
            url = URL.createObjectURL(new Blob([buffer], { type: "image/*" }));
            setFullSrc(url);
          }
        },
      ).catch(() => {});
    }
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
      setFullSrc("");
    };
  }, [media.open, media.src, media.filePath, media.kind]);
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if (!media.open) return;
      if (event.key === "Escape") close();
      else if (media.kind === "image" && ["+", "="].includes(event.key)) {
        adjust(STEP);
      } else if (media.kind === "image" && event.key === "-") adjust(-STEP);
      else if (media.kind === "image" && event.key === "0") reset();
    }
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  });
  if (!media.open) return null;
  function startPan(event: PointerEvent<HTMLElement>) {
    if (media.kind !== "image" || zoom <= 1 || event.button !== 0) return;
    setPanning(true);
    panOrigin.current = {
      id: event.pointerId,
      x: event.clientX - pan.x,
      y: event.clientY - pan.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function movePan(event: PointerEvent<HTMLElement>) {
    const origin = panOrigin.current;
    if (panning && origin?.id === event.pointerId) {
      setPan({ x: event.clientX - origin.x, y: event.clientY - origin.y });
    }
  }
  function endPan(event: PointerEvent<HTMLElement>) {
    if (panOrigin.current?.id !== event.pointerId) return;
    setPanning(false);
    panOrigin.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }
  async function showFile() {
    try {
      const result = await desktopApi.file.showItemInFolder?.(media.filePath);
      showToast(
        result?.ok === false
          ? result.error || "无法定位文件"
          : "已在文件夹中定位",
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : "无法定位文件");
    }
  }
  async function copyText() {
    await navigator.clipboard?.writeText(textDraft);
    showToast("已复制全文");
  }
  function saveText() {
    media.onSave?.(textDraft);
    showToast("文本已保存");
  }
  return (
    <div
      ref={backdrop}
      className={`media-viewer-backdrop${
        media.kind === "text" ? " is-text" : ""
      }`}
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
      aria-label={media.title}
      onPointerDown={(e) => e.target === e.currentTarget && close()}
    >
      <header className="media-viewer-toolbar">
        <div className="media-viewer-title">
          <span>
            {{ image: "IMAGE", video: "VIDEO", text: "TEXT" }[media.kind]}
          </span>
          <strong title={media.title}>{media.title}</strong>
        </div>
        {media.kind === "image" && (
          <div className="media-viewer-controls">
            <button disabled={zoom <= MIN_ZOOM} onClick={() => adjust(-STEP)}>
              −
            </button>
            <output>{Math.round(zoom * 100)}%</output>
            <button disabled={zoom >= MAX_ZOOM} onClick={() => adjust(STEP)}>
              ＋
            </button>
            <button title="适应窗口" onClick={reset}>
              <IconSymbol name="maximize" />
            </button>
            <button
              title="顺时针旋转"
              onClick={() => {
                setRotation((value) => (value + 90) % 360);
                setPan({ x: 0, y: 0 });
              }}
            >
              <IconSymbol name="refresh" />
            </button>
          </div>
        )}
        <div className="media-viewer-actions">
          {media.kind === "text" && (
            <>
              <button title="复制全文" onClick={() => void copyText()}>
                <IconSymbol name="copy" />
              </button>
              {media.onSave && (
                <button
                  className="media-viewer-save"
                  title="保存修改"
                  onClick={saveText}
                >
                  保存
                </button>
              )}
            </>
          )}
          {media.filePath && (
            <button
              title="在文件夹中显示"
              onClick={() => void showFile()}
            >
              <IconSymbol name="folder" />
            </button>
          )}
          <button title="关闭" onClick={close}>
            <IconSymbol name="x" />
          </button>
        </div>
      </header>
      <main
        className={`media-viewer-stage${
          media.kind === "image" && zoom > 1 ? " pannable" : ""
        }${panning ? " panning" : ""}${
          media.kind === "text" ? " is-text" : ""
        }`}
        onWheel={(event: WheelEvent<HTMLElement>) => {
          if (media.kind === "image") {
            event.preventDefault();
            adjust(event.deltaY < 0 ? STEP : -STEP);
          }
        }}
        onPointerDown={startPan}
        onPointerMove={movePan}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        onDoubleClick={(event) => {
          event.preventDefault();
          if (media.kind === "image") zoom > 1 ? reset() : setZoom(2);
        }}
      >
        {media.kind === "image"
          ? (
            <img
              src={fullSrc || media.src}
              alt={media.title}
              draggable={false}
              style={{
                transform:
                  `translate3d(${pan.x}px,${pan.y}px,0) rotate(${rotation}deg) scale(${zoom})`,
              }}
            />
          )
          : media.kind === "video"
          ? (
            <video
              src={media.src}
              controls
              autoPlay
              preload="metadata"
              onDoubleClick={(e) => e.stopPropagation()}
            />
          )
          : media.onSave
          ? (
            <textarea
              className="media-viewer-text"
              value={textDraft}
              aria-label="编辑文本详情"
              spellCheck={false}
              onChange={(event) => setTextDraft(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "s") {
                  event.preventDefault();
                  saveText();
                }
              }}
            />
          )
          : <pre className="media-viewer-text">{media.src}</pre>}
      </main>
      <footer className="media-viewer-hint">
        <span>
          {media.kind === "image"
            ? "双击切换放大 · 滚轮缩放 · 放大后拖拽"
            : media.kind === "video"
            ? "双击素材即可进入此播放器"
            : media.onSave
            ? "可直接编辑 · ⌘/Ctrl + S 保存"
            : "可选中文本 · 右上角复制全文"}
        </span>
        <kbd>ESC</kbd>
      </footer>
    </div>
  );
}
