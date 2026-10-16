import {
  type PointerEvent,
  useEffect,
  useRef,
  useState,
  type WheelEvent,
} from "react";
import { createPortal } from "react-dom";
import { desktopApi } from "../../services/desktopApi.js";
import {
  acquireMediaPreview,
  type CachedMediaLease,
} from "../../services/mediaPreviewCache";
import { IconSymbol } from "./IconSymbol";
import { useWorkbenchSurfaceRoot } from "../layout/workbenchSurface";
import { TextAgentPanel } from "../agent-chat/TextAgentPanel";
import { registerTextDraftTarget } from "../../agent/runtime/textDraftBridge";
import { showToast, useOverlayStore } from "../store/overlayStore";
import { markdownToRichHtml, richHtmlToMarkdown } from "../../utils/richTextMarkdown.mjs";
import { diffTextLines } from "../../utils/textVersionDiff.mjs";

const MIN_ZOOM = .5, MAX_ZOOM = 5, STEP = .25;
function formatMediaTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const seconds = Math.floor(value);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
export function MediaViewer() {
  const media = useOverlayStore((state) => state.media);
  const close = useOverlayStore((state) => state.closeMedia);
  const surface = useWorkbenchSurfaceRoot();
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const [fullSrc, setFullSrc] = useState("");
  const [textDraft, setTextDraft] = useState("");
  const [textSearchOpen, setTextSearchOpen] = useState(false);
  const [textSearch, setTextSearch] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyCompare, setHistoryCompare] = useState(false);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [textVersions, setTextVersions] = useState<Array<{ id: string; content: string; createdAt: string; name?: string }>>([]);
  const [renamingId, setRenamingId] = useState("");
  const [versionName, setVersionName] = useState("");
  const savedText = useRef("");
  const [videoTime, setVideoTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoMuted, setVideoMuted] = useState(false);
  const [capturingFrame, setCapturingFrame] = useState(false);
  const [agentOpen, setAgentOpen] = useState(true);
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
    setVideoTime(0);
    setVideoDuration(0);
    setVideoMuted(false);
    setCapturingFrame(false);
    if (media.kind === "text") {
      setTextDraft(media.src);
      savedText.current = media.src;
      setAgentOpen(true);
      const versions = media.getTextVersions?.() || [];
      setTextVersions(versions);
      setHistoryOpen(false);
      setHistoryCompare(false);
      setHistoryIndex(Math.max(0, versions.length - 1));
      setRenamingId("");
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
  const agentNodeId = media.kind === "text" ? media.textAgentNodeId : "";
  useEffect(() => {
    if (!media.open || !agentNodeId) return;
    // Agent 只通过这里读写编辑器的未保存草稿；DOM 是唯一来源，避免与用户输入竞态。
    return registerTextDraftTarget({
      nodeId: agentNodeId,
      read: () => (textEditor.current ? richHtmlToMarkdown(textEditor.current.innerHTML) : ""),
      apply: (content, mode) => {
        const editor = textEditor.current;
        if (!editor) throw new Error("文本编辑器尚未就绪");
        const current = richHtmlToMarkdown(editor.innerHTML);
        const draft = mode === "append" && current.trim()
          ? `${current.trimEnd()}\n\n${content}`
          : content;
        editor.innerHTML = markdownToRichHtml(draft);
        setTextDraft(draft);
        return draft;
      },
    });
  }, [media.open, agentNodeId]);
  if (!media.open || !surface) return null;
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
  async function saveMedia() {
    if (!media.filePath) return showToast("当前媒体没有可导出的本地原始文件");
    try {
      const buffer = await desktopApi.file.readArrayBuffer(media.filePath);
      const result = await desktopApi.file.saveArrayBuffer(media.title || "media", buffer);
      if (result) showToast("媒体已另存");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "媒体另存失败");
    }
  }
  async function copyText() {
    await navigator.clipboard?.writeText(currentMarkdown());
    showToast("已复制全文");
  }
  function saveText() {
    const markdown = currentMarkdown();
    setTextDraft(markdown);
    if (markdown !== savedText.current) {
      media.onSave?.(markdown);
      savedText.current = markdown;
      const versions = media.getTextVersions?.() || [];
      setTextVersions(versions);
      setHistoryIndex(Math.max(0, versions.length - 1));
    }
    showToast("文本已保存");
  }
  function closeViewer() {
    const markdown = currentMarkdown();
    if (media.kind === "text" && media.onSave && markdown !== savedText.current) {
      media.onSave(markdown);
    }
    close();
  }
  function restoreTextVersion() {
    const version = textVersions[historyIndex];
    if (!version || !media.onSave) return;
    media.onSave(version.content);
    savedText.current = version.content;
    setTextDraft(version.content);
    if (textEditor.current) textEditor.current.innerHTML = markdownToRichHtml(version.content);
    const versions = media.getTextVersions?.() || [];
    setTextVersions(versions);
    setHistoryIndex(Math.max(0, versions.length - 1));
    setHistoryCompare(false);
    showToast("已恢复版本");
  }
  function saveVersionName() {
    if (!renamingId || !media.onRenameVersion) return;
    if (media.onRenameVersion(renamingId, versionName)) {
      setTextVersions(media.getTextVersions?.() || []);
      setRenamingId("");
    }
  }
  function copyVersion() {
    const version = textVersions[historyIndex];
    if (!version || !media.onCopyVersion) return;
    if (media.onCopyVersion(version.id)) showToast("已复制为新画布节点");
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
  return createPortal(
    <div
      ref={backdrop}
      className={`media-viewer-backdrop${
        media.kind === "text" ? " is-text" : ""
      }${media.kind === "text" && historyOpen ? " is-history-open" : ""}${
        agentNodeId && agentOpen ? " is-agent-open" : ""
      }`}
      role="dialog"
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
              {media.getTextVersions && <button title="版本历史" aria-label="版本历史" aria-pressed={historyOpen} onClick={() => setHistoryOpen((value) => !value)}><IconSymbol name="refresh" /></button>}
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
        ) : <><div aria-hidden />
        {media.kind === "image" && (
          <div className="media-viewer-controls">
            <button disabled={zoom <= MIN_ZOOM} onClick={() => adjust(-STEP)}>
              −
            </button>
            <output>{Math.round(zoom * 100)}%</output>
            <button disabled={zoom >= MAX_ZOOM} onClick={() => adjust(STEP)}>
              ＋
            </button>
          </div>
        )}
        {media.kind === "video" && (
          <div className="media-viewer-controls media-viewer-video-controls">
            <output>{formatMediaTime(videoTime)} / {formatMediaTime(videoDuration)}</output>
            <button
              type="button"
              title={videoMuted ? "开启声音" : "关闭声音"}
              aria-pressed={!videoMuted}
              onClick={() => setVideoMuted((value) => !value)}
            >
              <IconSymbol name={videoMuted ? "volume-x" : "volume"} />
            </button>
          </div>
        )}
        <div className="media-viewer-actions">
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
        }${historyOpen && media.kind === "text" ? " is-history-open" : ""
        }${agentNodeId && agentOpen ? " is-agent-open" : ""}`}
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
              muted={videoMuted}
              playsInline
              preload="auto"
              onLoadedMetadata={(event) => setVideoDuration(Number(event.currentTarget.duration) || 0)}
              onDurationChange={(event) => setVideoDuration(Number(event.currentTarget.duration) || 0)}
              onTimeUpdate={(event) => setVideoTime(event.currentTarget.currentTime)}
              onCanPlay={(event) => {
                void event.currentTarget.play().catch(() => undefined);
              }}
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
        {media.kind === "text" && historyOpen && (
          <aside className="text-version-panel" aria-label="文本版本历史">
            <div className="text-version-heading"><strong>版本历史</strong><span>{textVersions.length} 个版本</span></div>
            {textVersions.length ? <>
              <div className="text-version-list">
                {textVersions.map((version, index) => (
                  <button key={version.id} type="button" className={index === historyIndex ? "is-selected" : ""} onClick={() => setHistoryIndex(index)}>
                    <strong>{version.name || `版本 ${index + 1}`}</strong>
                    <time>{new Date(version.createdAt).toLocaleString()}</time>
                    <small>{version.content.slice(0, 80) || "空白文本"}</small>
                  </button>
                ))}
              </div>
              <div className="text-version-name-row">
                {renamingId === textVersions[historyIndex]?.id ? <input autoFocus aria-label="版本名称" value={versionName} onChange={(event) => setVersionName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") saveVersionName(); if (event.key === "Escape") setRenamingId(""); }} /> : <span>{textVersions[historyIndex]?.name || `版本 ${historyIndex + 1}`}</span>}
                <button type="button" onClick={() => { if (renamingId) saveVersionName(); else { setRenamingId(textVersions[historyIndex]?.id || ""); setVersionName(textVersions[historyIndex]?.name || ""); } }}>{renamingId ? "保存" : "命名"}</button>
              </div>
              <div className="text-version-actions">
                <button type="button" onClick={() => setHistoryCompare((value) => !value)}>{historyCompare ? "隐藏对比" : "与当前对比"}</button>
                {media.onCopyVersion && <button type="button" onClick={copyVersion}>复制到画布</button>}
                <button type="button" onClick={restoreTextVersion} disabled={!media.onSave || textVersions[historyIndex]?.content === currentMarkdown()}>恢复此版本</button>
              </div>
              {historyCompare && <div className="text-version-compare" aria-label="版本差异">
                {diffTextLines(textVersions[historyIndex]?.content, textDraft).map((line, index) => <div key={index} className={`is-${line.type}`}><span>{line.type === "added" ? "+" : line.type === "removed" ? "−" : " "}</span><code>{line.text || " "}</code></div>)}
              </div>}
            </> : <p className="text-version-empty">编辑并保存后，版本会显示在这里。</p>}
          </aside>
        )}
        {agentNodeId && agentOpen && (
          <TextAgentPanel nodeId={agentNodeId} onClose={() => setAgentOpen(false)} />
        )}
      </main>
      <footer className="media-viewer-hint">
        {media.kind !== "text" ? (
          <div className="media-viewer-primary-actions">
            {media.kind === "video" && media.onCaptureFrame && media.filePath && <button type="button" disabled={capturingFrame} onClick={() => {
              setCapturingFrame(true);
              void Promise.resolve(media.onCaptureFrame?.(videoTime)).catch((cause) => showToast(cause instanceof Error ? cause.message : "视频截帧失败")).finally(() => setCapturingFrame(false));
            }}><IconSymbol name="image" />{capturingFrame ? "截帧中…" : "截取当前帧"}</button>}
            {media.filePath && (
              <>
                <button type="button" onClick={() => void saveMedia()}>
                  <IconSymbol name="download" />
                  下载
                </button>
                <button type="button" onClick={() => void showFile()}>
                  <IconSymbol name="folder" />
                  {desktopApi.platform === "darwin" ? "在 Finder 中打开" : "在文件夹中显示"}
                </button>
              </>
            )}
          </div>
        ) : <span>{media.onSave
          ? "可直接编辑 · ⌘/Ctrl + S 保存"
          : "可选中文本 · 右上角复制全文"}</span>}
        {media.kind === "text" && <kbd>ESC</kbd>}
      </footer>
    </div>,
    surface,
  );
}
