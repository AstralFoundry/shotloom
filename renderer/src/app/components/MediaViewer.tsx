import {
  type PointerEvent,
  useEffect,
  useRef,
  useState,
  type WheelEvent,
} from "react";
import { desktopApi } from "../../services/desktopApi.js";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  acquireMediaPreview,
  type CachedMediaLease,
} from "../../services/mediaPreviewCache";
import { IconSymbol } from "./IconSymbol";
import { showToast, useOverlayStore } from "../store/overlayStore";
import { markdownToRichHtml, richHtmlToMarkdown } from "../../utils/richTextMarkdown.mjs";

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
  const [textSearchOpen, setTextSearchOpen] = useState(false);
  const [textSearch, setTextSearch] = useState("");
  const panOrigin = useRef<{ x: number; y: number; id: number } | null>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const textEditor = useRef<HTMLDivElement>(null);
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
    if (media.kind === "text") {
      setTextDraft(media.src);
      setTextSearchOpen(false);
      setTextSearch("");
      requestAnimationFrame(() => {
        if (textEditor.current) textEditor.current.innerHTML = markdownToRichHtml(media.src);
      });
    }
    backdrop.current?.focus({ preventScroll: true });
    let cancelled = false;
    let lease: CachedMediaLease | null = null;
    if (media.kind === "image" && media.filePath) {
      void acquireMediaPreview({
        path: media.filePath,
        kind: "image",
        buffered: true,
        revision: media.src,
      }).then((acquired) => {
        if (cancelled) acquired.release();
        else {
          lease = acquired;
          setFullSrc(acquired.url);
        }
      }).catch(() => {});
    } else if (media.kind === "video" && media.filePath && desktopApi.platform !== "browser") {
      setFullSrc(convertFileSrc(media.filePath));
    }
    return () => {
      cancelled = true;
      lease?.release();
      setFullSrc("");
    };
  }, [media.open, media.src, media.filePath, media.kind]);
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if (!media.open) return;
      if (event.key === "Escape") closeViewer();
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
    await navigator.clipboard?.writeText(currentMarkdown());
    showToast("已复制全文");
  }
  function saveText() {
    const markdown = currentMarkdown();
    setTextDraft(markdown);
    media.onSave?.(markdown);
    showToast("文本已保存");
  }
  function closeViewer() {
    const markdown = currentMarkdown();
    if (media.kind === "text" && media.onSave && markdown !== media.src) {
      media.onSave(markdown);
    }
    close();
  }
  function currentMarkdown() {
    return media.kind === "text" && textEditor.current
      ? richHtmlToMarkdown(textEditor.current.innerHTML)
      : textDraft;
  }
  function syncRichText() {
    setTextDraft(currentMarkdown());
  }
  function editCommand(command: string, value?: string) {
    textEditor.current?.focus();
    document.execCommand(command, false, value);
    syncRichText();
  }
  function insertTable() {
    editCommand(
      "insertHTML",
      '<table><thead><tr><th>标题</th><th>标题</th></tr></thead><tbody><tr><td>内容</td><td>内容</td></tr></tbody></table><p><br></p>',
    );
  }
  function findText() {
    const editor = textEditor.current;
    const query = textSearch.trim();
    if (!editor || !query) return;
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    const selection = window.getSelection();
    const current = selection?.rangeCount ? selection.getRangeAt(0).endContainer : null;
    const nodes = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node) nodes.push(node);
    }
    const start = current ? Math.max(0, nodes.indexOf(current) + 1) : 0;
    const ordered = [...nodes.slice(start), ...nodes.slice(0, start)];
    const match = ordered.find((node) => String(node.nodeValue).toLocaleLowerCase().includes(query.toLocaleLowerCase()));
    if (!match) return showToast("未找到匹配内容");
    const index = String(match.nodeValue).toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
    const range = document.createRange();
    range.setStart(match, index);
    range.setEnd(match, index + query.length);
    selection?.removeAllRanges();
    selection?.addRange(range);
    editor.focus();
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
      onPointerDown={(e) => e.target === e.currentTarget && closeViewer()}
    >
      <header className="media-viewer-toolbar">
        {media.kind === "text" ? (
          <>
            <div className="text-editor-leading">
              <button title="复制全文" onClick={() => void copyText()}>
                <IconSymbol name="copy" />
              </button>
            </div>
            <div className="text-editor-formatting" role="toolbar" aria-label="文本格式">
              <button title="一级标题" onMouseDown={(event) => { event.preventDefault(); editCommand("formatBlock", "h1"); }}>H<sub>1</sub></button>
              <button title="二级标题" onMouseDown={(event) => { event.preventDefault(); editCommand("formatBlock", "h2"); }}>H<sub>2</sub></button>
              <button title="三级标题" onMouseDown={(event) => { event.preventDefault(); editCommand("formatBlock", "h3"); }}>H<sub>3</sub></button>
              <button title="正文" onMouseDown={(event) => { event.preventDefault(); editCommand("formatBlock", "p"); }}>¶</button>
              <span />
              <button title="粗体" onMouseDown={(event) => { event.preventDefault(); editCommand("bold"); }}><b>B</b></button>
              <button title="斜体" onMouseDown={(event) => { event.preventDefault(); editCommand("italic"); }}><i>I</i></button>
              <span />
              <button title="无序列表" onMouseDown={(event) => { event.preventDefault(); editCommand("insertUnorderedList"); }} className="text-format-list">•<i>≡</i></button>
              <button title="有序列表" onMouseDown={(event) => { event.preventDefault(); editCommand("insertOrderedList"); }} className="text-format-list"><small>1</small><i>≡</i></button>
              <button title="分隔线" onMouseDown={(event) => { event.preventDefault(); editCommand("insertHorizontalRule"); }}>—</button>
              <span />
              <button title="插入表格" className="text-format-table" onMouseDown={(event) => { event.preventDefault(); insertTable(); }}>▦</button>
            </div>
            <div className="text-editor-actions">
              {textSearchOpen && (
                <input
                  autoFocus
                  value={textSearch}
                  placeholder="查找"
                  aria-label="查找文本"
                  onChange={(event) => setTextSearch(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && findText()}
                />
              )}
              <button title="查找" onClick={() => textSearchOpen ? findText() : setTextSearchOpen(true)}>
                <IconSymbol name="search" />
              </button>
              <button title="关闭" onClick={closeViewer}>
                <IconSymbol name="x" />
              </button>
            </div>
          </>
        ) : <><div className="media-viewer-title">
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
          {media.filePath && (
            <button
              title="在文件夹中显示"
              onClick={() => void showFile()}
            >
              <IconSymbol name="folder" />
            </button>
          )}
          <button title="关闭" onClick={closeViewer}>
            <IconSymbol name="x" />
          </button>
        </div>
        </>}
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
              src={fullSrc || media.src}
              controls
              autoPlay
              preload="metadata"
              onDoubleClick={(e) => e.stopPropagation()}
            />
          )
          : media.onSave
          ? (
            <div
              ref={textEditor}
              className="media-viewer-text"
              contentEditable
              data-placeholder="输入内容..."
              aria-label="编辑文本详情"
              spellCheck={false}
              suppressContentEditableWarning
              onInput={syncRichText}
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
