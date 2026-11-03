import { useRef } from "react";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useUIStore } from "../../../stores/ui-store";
import { formatFrameTimecode } from "../../../utils/frame-timecode";
import { editingFrameStepSeconds } from "../editing-frame-rate";
import { resolvePlaybackLoop } from "../../../utils/playback-loop";
import { X } from "@/icons/lucide-compat";
import { editorMessage, isShotloomMode } from "../../../shotloom-mode";

export function TimelineRangeActions({ duration, frameRate }: { duration: number; frameRate: number }) {
  const locked = useTimelineStore((state) => Boolean(state.playbackLockedReason));
  const marked = useTimelineStore((state) => state.loopEnd > state.loopStart);
  const exporting = useUIStore((state) => state.exportState.isExporting);
  const disabled = duration <= 0 || locked || exporting;
  const mark = (edge: "in" | "out") => {
    if (disabled) return;
    const state = useTimelineStore.getState();
    const range = resolvePlaybackLoop({ ...state, loopEnabled: true }, duration);
    if (!range) return;
    const frame = editingFrameStepSeconds(frameRate);
    const time = Math.min(duration, Math.max(0, Math.round(state.playheadPosition / frame) * frame));
    if (edge === "in") {
      const start = Math.min(time, Math.max(0, duration - frame));
      state.setLoopRange(start, range.end > start ? range.end : duration);
    } else {
      const end = Math.max(Math.min(frame, duration), time);
      state.setLoopRange(range.start < end ? range.start : 0, end);
    }
  };
  // 参考剪辑台的标尺行没有常驻的入/出点控制带：宿主模式下只在真的标记过区间后出现，
  // 未标记时用 I / O 快捷键标记，标尺保持干净。
  if (isShotloomMode && !marked) return null;
  return <div className="flex h-11 w-full min-w-0 items-center justify-center gap-1" aria-label={editorMessage("editor.timeline.range.controls")}>
    <button type="button" disabled={disabled} aria-label={editorMessage("editor.timeline.range.markIn")} title={editorMessage("editor.timeline.range.markInHint")} onClick={() => mark("in")}
      className="h-11 min-w-0 flex-1 px-1 text-[10px] font-medium text-fg-2 hover:bg-bg-2 focus-visible:outline-accent disabled:opacity-40">{editorMessage("editor.timeline.range.in")} <kbd className="font-mono text-fg-muted">I</kbd></button>
    <button type="button" disabled={disabled} aria-label={editorMessage("editor.timeline.range.markOut")} title={editorMessage("editor.timeline.range.markOutHint")} onClick={() => mark("out")}
      className="h-11 min-w-0 flex-1 px-1 text-[10px] font-medium text-fg-2 hover:bg-bg-2 focus-visible:outline-accent disabled:opacity-40">{editorMessage("editor.timeline.range.out")} <kbd className="font-mono text-fg-muted">O</kbd></button>
    <button type="button" disabled={!marked || locked || exporting} aria-label={editorMessage("editor.timeline.range.clear")} title={editorMessage("editor.timeline.range.clearHint")} onClick={() => useTimelineStore.getState().clearLoopRange()}
      className="grid h-11 w-7 place-items-center text-fg-3 hover:bg-bg-2 focus-visible:outline-accent disabled:opacity-40"><X size={12} aria-hidden /></button>
  </div>;
}

export function TimelineRange({ duration, frameRate, pixelsPerSecond }: { duration: number; frameRate: number; pixelsPerSecond: number }) {
  const start = useTimelineStore((state) => state.loopStart);
  const end = useTimelineStore((state) => state.loopEnd);
  const enabled = useTimelineStore((state) => state.loopEnabled);
  const locked = useTimelineStore((state) => Boolean(state.playbackLockedReason));
  const exporting = useUIStore((state) => state.exportState.isExporting);
  const drag = useRef<{ id: number; edge: "in" | "out"; start: number; end: number } | null>(null);
  const frame = Math.min(duration, editingFrameStepSeconds(frameRate));
  if (!(duration > 0 && end > start)) return null;
  const rangeStart = Math.min(Math.max(0, start), Math.max(0, duration - frame));
  const rangeEnd = Math.min(duration, Math.max(rangeStart + frame, end));
  const disabled = locked || exporting;
  const change = (edge: "in" | "out", seconds: number) => {
    const state = useTimelineStore.getState();
    if (disabled || state.playbackLockedReason) return;
    const value = Math.round(seconds / frame) * frame;
    state.setLoopRange(edge === "in" ? Math.max(0, Math.min(rangeEnd - frame, value)) : rangeStart,
      edge === "out" ? Math.min(duration, Math.max(rangeStart + frame, value)) : rangeEnd);
  };
  return <>
    <div aria-hidden data-timeline-range className={`absolute inset-y-0 pointer-events-none border-y ${enabled ? "bg-brand-accent/20 border-brand-accent/50" : "bg-brand-accent/10 border-brand-accent/25"}`}
      style={{ left: rangeStart * pixelsPerSecond, width: (rangeEnd - rangeStart) * pixelsPerSecond }} />
    {(["in", "out"] as const).map((edge) => <button key={edge} type="button" role="slider" aria-label={editorMessage(edge === "in" ? "editor.timeline.range.inSlider" : "editor.timeline.range.outSlider")}
      aria-valuemin={edge === "in" ? 0 : rangeStart + frame} aria-valuemax={edge === "in" ? rangeEnd - frame : duration}
      aria-valuenow={edge === "in" ? rangeStart : rangeEnd} aria-valuetext={formatFrameTimecode(edge === "in" ? rangeStart : rangeEnd, frameRate)}
      aria-disabled={disabled} disabled={disabled}
      title={editorMessage(edge === "in" ? "editor.timeline.range.inHint" : "editor.timeline.range.outHint", { timecode: formatFrameTimecode(edge === "in" ? rangeStart : rangeEnd, frameRate) })}
      className={`absolute inset-y-0 z-20 w-6 border-x border-brand-accent/60 bg-brand-accent/80 text-[10px] font-bold text-white touch-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-white ${edge === "in" ? "rounded-l" : "rounded-r -translate-x-full"}`}
      style={{ left: (edge === "in" ? rangeStart : rangeEnd) * pixelsPerSecond }}
      onMouseDown={(event) => { event.stopPropagation(); }}
      onPointerDown={(event) => {
        event.preventDefault(); event.stopPropagation();
        if (disabled || event.button !== 0 || drag.current) return;
        useTimelineStore.getState().pause();
        drag.current = { id: event.pointerId, edge, start, end };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!drag.current || event.pointerId !== drag.current.id) return;
        const ruler = event.currentTarget.closest('[data-timeline-ruler]');
        if (ruler) change(edge, (event.clientX - ruler.getBoundingClientRect().left) / pixelsPerSecond);
      }}
      onPointerUp={(event) => { if (drag.current?.id === event.pointerId) { drag.current = null; event.currentTarget.releasePointerCapture?.(event.pointerId); } }}
      onPointerCancel={(event) => { if (drag.current?.id === event.pointerId) { useTimelineStore.getState().setLoopRange(drag.current.start, drag.current.end); drag.current = null; } }}
      onKeyDown={(event) => {
        const direction = event.key === "ArrowRight" || event.key === "ArrowUp" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 0;
        if (direction) { event.preventDefault(); event.stopPropagation(); useTimelineStore.getState().pause(); change(edge, (edge === "in" ? rangeStart : rangeEnd) + direction * frame * (event.shiftKey ? 10 : 1)); }
        else if (event.key === "Home" || event.key === "End") { event.preventDefault(); event.stopPropagation(); change(edge, event.key === "Home" ? 0 : duration); }
      }}>{edge === "in" ? "I" : "O"}</button>)}
  </>;
}
