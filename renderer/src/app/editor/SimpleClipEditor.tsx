import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconSymbol } from "../components/IconSymbol";
import { desktopApi } from "../../services/desktopApi.js";
import { editorMediaMimeType } from "../../utils/editorMediaImport.mjs";
import "./SimpleClipEditor.css";

export interface SimpleClipEditorProps {
  title?: string;
  sourceUrl: string;
  sourceFile?: string;
  sourceName?: string;
  onClose: () => void;
  onExport?: (segment: { start: number; end: number }, index: number) => void | Promise<void>;
}

export function SimpleClipEditor({ title = "剪辑", sourceUrl, sourceFile = "", sourceName = "视频", onClose, onExport }: SimpleClipEditorProps) {
  const [localPreview, setLocalPreview] = useState<{ path: string; url: string } | null>(null);
  const [localPreviewPending, setLocalPreviewPending] = useState(Boolean(sourceFile));
  const resolvedUrl = localPreview?.path === sourceFile ? localPreview.url : localPreviewPending ? "" : sourceUrl;
  const videoRef = useRef<HTMLVideoElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [segments, setSegments] = useState<Array<{ start: number; end: number }>>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [exportError, setExportError] = useState("");
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [timelineZoom, setTimelineZoom] = useState(1);
  const selectedSegment = segments[selectedIndex];
  const progress = duration ? (current / duration) * 100 : 0;
  const marks = useMemo(() => Array.from({ length: 9 }, (_, index) => index), []);
  const zoomSteps = [0.5, 0.75, 1, 1.5, 2, 3, 4, 6];

  useEffect(() => {
    const viewport = timelineRef.current;
    if (!viewport) return;
    const frame = requestAnimationFrame(() => {
      const playheadX = (current / (duration || 1)) * viewport.clientWidth * timelineZoom;
      viewport.scrollLeft = Math.max(0, playheadX - viewport.clientWidth / 2);
    });
    return () => cancelAnimationFrame(frame);
  }, [timelineZoom]);

  function changeTimelineZoom(direction: -1 | 1) {
    const index = zoomSteps.indexOf(timelineZoom);
    setTimelineZoom(zoomSteps[Math.max(0, Math.min(zoomSteps.length - 1, index + direction))]);
  }

  useEffect(() => {
    if (!sourceFile) { setLocalPreviewPending(false); return; }
    let cancelled = false;
    let objectUrl = "";
    setLocalPreviewPending(true);
    void desktopApi.file.readArrayBuffer(sourceFile).then((buffer: ArrayBuffer) => {
      if (!buffer.byteLength) throw new Error("视频文件为空");
      if (cancelled) return;
      objectUrl = URL.createObjectURL(new Blob([buffer], { type: editorMediaMimeType(sourceFile, "video") }));
      setLocalPreview({ path: sourceFile, url: objectUrl });
      setLocalPreviewPending(false);
    }).catch(() => { if (!cancelled) setLocalPreviewPending(false); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [sourceFile]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onLoaded = () => {
      const next = video.duration || 0;
      setDuration(next); setSegments([{ start: 0, end: next }]); setSelectedIndex(0);
    };
    const onTime = () => setCurrent(video.currentTime);
    video.addEventListener("loadedmetadata", onLoaded);
    video.addEventListener("timeupdate", onTime);
    const onError = () => setLoadError(true);
    video.addEventListener("error", onError);
    if (video.readyState >= 1) onLoaded();
    return () => { video.removeEventListener("loadedmetadata", onLoaded); video.removeEventListener("timeupdate", onTime); video.removeEventListener("error", onError); };
  }, [resolvedUrl]);

  useEffect(() => {
    if (!resolvedUrl || !duration) return;
    let cancelled = false;
    const filmstripVideo = document.createElement("video");
    filmstripVideo.preload = "auto";
    filmstripVideo.muted = true;
    filmstripVideo.src = resolvedUrl;
    const canvas = document.createElement("canvas");
    const frames: string[] = [];
    let index = 0;
    const capture = () => {
      if (cancelled || !filmstripVideo.videoWidth) return;
      canvas.width = 160;
      canvas.height = Math.max(90, Math.round(160 * filmstripVideo.videoHeight / filmstripVideo.videoWidth));
      try {
        canvas.getContext("2d")?.drawImage(filmstripVideo, 0, 0, canvas.width, canvas.height);
        frames.push(canvas.toDataURL("image/jpeg", .7));
      } catch { return; }
      index += 1;
      if (index < 8) filmstripVideo.currentTime = Math.min(duration - .01, duration * index / 8);
      else setThumbnails(frames);
    };
    filmstripVideo.addEventListener("loadeddata", capture, { once: true });
    filmstripVideo.addEventListener("seeked", capture);
    return () => { cancelled = true; filmstripVideo.removeAttribute("src"); filmstripVideo.load(); };
  }, [resolvedUrl, duration]);

  function seek(value: number) {
    const next = Math.max(0, Math.min(duration, value));
    if (videoRef.current) videoRef.current.currentTime = next;
    setCurrent(next);
  }
  async function exportClip() {
    if (!onExport || exporting || !selectedSegment) return;
    setExporting(true);
    setExportError("");
    try {
      await onExport(selectedSegment, selectedIndex);
      onClose();
    } catch (cause) {
      setExportError(cause instanceof Error ? cause.message : "所选片段导出失败");
    } finally { setExporting(false); }
  }
  function splitAtPlayhead() {
    if (!duration || current <= 0.05 || current >= duration - 0.05) return;
    const index = segments.findIndex((segment) => current > segment.start + 0.05 && current < segment.end - 0.05);
    if (index < 0) return;
    const next = [...segments];
    next.splice(index, 1, { start: segments[index].start, end: current }, { start: current, end: segments[index].end });
    setSegments(next);
    setSelectedIndex(index + 1);
  }
  return createPortal(
    <div className="simple-clip-backdrop" role="dialog" aria-modal="true" aria-label="剪辑">
      <section className="simple-clip-dialog">
        <header className="simple-clip-header"><strong>{title}</strong><button type="button" aria-label="关闭" onClick={onClose}><IconSymbol name="x" /></button></header>
        <div className="simple-clip-body">
          <div className={`simple-clip-preview${loadError ? " is-error" : ""}`}>
            {resolvedUrl && <video ref={videoRef} src={resolvedUrl} playsInline preload="auto" onLoadedData={() => setLoadError(false)} onEnded={() => setPlaying(false)} />}
            {localPreviewPending && <div className="simple-clip-load-error">正在读取视频…</div>}
            {!localPreviewPending && (loadError || !resolvedUrl) && <div className="simple-clip-load-error">无法加载视频预览</div>}
          </div>
          <div className="simple-clip-controls">
            <button type="button" className="simple-clip-play" aria-label={playing ? "暂停" : "播放"} onClick={() => { const video = videoRef.current; if (!video) return; if (playing) { video.pause(); setPlaying(false); } else { void video.play(); setPlaying(true); } }}><IconSymbol name={playing ? "pause" : "play"} /></button>
            <span className="simple-clip-time">{formatClock(current, false)} / {formatClock(duration, true)}</span>
            {selectedSegment && <span className="simple-clip-range">选中第 {selectedIndex + 1} 段 [{formatClock(selectedSegment.start, true)} – {formatClock(selectedSegment.end, true)}]（{(selectedSegment.end - selectedSegment.start).toFixed(1)}s）</span>}
            <div className="simple-clip-zoom" role="group" aria-label="时间轴缩放">
              <button type="button" aria-label="缩小时间轴" title="缩小时间轴" disabled={timelineZoom === zoomSteps[0]} onClick={() => changeTimelineZoom(-1)}>−</button>
              <span>{Math.round(timelineZoom * 100)}%</span>
              <button type="button" aria-label="放大时间轴" title="放大时间轴" disabled={timelineZoom === zoomSteps[zoomSteps.length - 1]} onClick={() => changeTimelineZoom(1)}>＋</button>
            </div>
          </div>
          <div className="simple-clip-timeline-viewport" ref={timelineRef}>
          <div className="simple-clip-timeline" style={{ width: `${timelineZoom * 100}%` }}>
            <div className="simple-clip-ruler">{marks.map((mark) => <span key={mark}>{formatClock(duration * mark / 8, true)}</span>)}</div>
            <div className="simple-clip-track"><div className="simple-clip-track-progress" style={{ width: `${progress}%` }} />{thumbnails.length ? <div className="simple-clip-thumbnails">{thumbnails.map((thumbnail) => <img key={thumbnail} src={thumbnail} alt="" />)}</div> : <div className="simple-clip-thumb"><span>{sourceName}</span></div>}{segments.map((segment, index) => <button key={`${segment.start}-${segment.end}`} type="button" className={`simple-clip-segment${index === selectedIndex ? " is-selected" : ""}`} style={{ left: `${segment.start / duration * 100}%`, width: `${(segment.end - segment.start) / duration * 100}%` }} aria-label={`选择第 ${index + 1} 段，${formatClock(segment.start, true)} 至 ${formatClock(segment.end, true)}`} aria-pressed={index === selectedIndex} onClick={() => { setSelectedIndex(index); seek(segment.start); }} />)}<div className="simple-clip-cut-markers">{segments.slice(1).map((segment) => <i key={segment.start} style={{ left: `${(segment.start / (duration || 1)) * 100}%` }} />)}</div></div>
            <button
              type="button"
              className="simple-clip-playhead"
              aria-label="拖动播放位置"
              style={{ left: `${progress}%` }}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                const track = event.currentTarget.parentElement?.querySelector(".simple-clip-track") as HTMLElement | null;
                const move = (moveEvent: PointerEvent) => {
                  if (!track || !duration) return;
                  const rect = track.getBoundingClientRect();
                  seek(((moveEvent.clientX - rect.left) / rect.width) * duration);
                };
                const stop = () => {
                  window.removeEventListener("pointermove", move);
                  window.removeEventListener("pointerup", stop);
                };
                window.addEventListener("pointermove", move);
                window.addEventListener("pointerup", stop, { once: true });
              }}
            />
          </div>
          </div>
        </div>
        <footer className="simple-clip-footer">{exportError && <span className="simple-clip-export-error" role="alert">{exportError}</span>}<button type="button" className="simple-clip-secondary" aria-label="撤销切分" disabled={segments.length <= 1} onClick={() => { setSegments((items) => items.length > 1 ? [...items.slice(0, -2), { start: items.at(-2)!.start, end: items.at(-1)!.end }] : items); setSelectedIndex((index) => Math.min(index, segments.length - 2)); }}><IconSymbol name="undo" /></button><button type="button" className="simple-clip-cut" disabled={!duration || current <= 0.05 || current >= duration - 0.05} onClick={splitAtPlayhead}>切分</button><button type="button" className="simple-clip-export" aria-label="导出选中片段到画布" disabled={!selectedSegment || exporting} onClick={() => void exportClip()}>{exporting ? "生成中…" : "导出"}</button></footer>
      </section>
    </div>, document.body,
  );
}

function formatClock(seconds: number, showHundredths: boolean) {
  if (!Number.isFinite(seconds) || seconds <= 0) return showHundredths ? "00:00.00" : "00:00";
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const rest = showHundredths
    ? (seconds % 60).toFixed(2).padStart(5, "0")
    : Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${rest}`;
}
