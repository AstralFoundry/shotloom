import { useId, useRef, useState } from "react";
import { editorMessage } from "../../shotloom-mode";
import { useTimelineStore } from "../../stores/timeline-store";
import { formatFrameTimecode, parseFrameTimecode } from "../../utils/frame-timecode";
import { stepEditingFrame } from "./editing-frame-rate";

/**
 * 参考播放器这一行只有三段（分:秒:帧）。小时为 0 时不铺前导 "00:"，
 * 超过一小时仍回到 HH:MM:SS:FF；输入侧照旧接受两种写法。
 */
const displayTimecode = (seconds: number, frameRate: number): string =>
  formatFrameTimecode(seconds, frameRate).replace(/^00:/, "");

export function PreviewTimecode({ position, duration, frameRate, disabled = false }: {
  position: number; duration: number; frameRate: number; disabled?: boolean;
}) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState(false);
  const cancel = useRef(false);
  const seek = (seconds: number) => {
    const timeline = useTimelineStore.getState();
    if (disabled || timeline.playbackLockedReason) return;
    timeline.pause();
    timeline.seekTo(Math.min(duration, Math.max(0, seconds)));
    timeline.scrollToPlayhead();
  };
  return <div className="relative flex shrink-0 items-center gap-1 font-mono text-[13px] tabular-nums">
    <input aria-label={editorMessage("editor.previewTimecode.playhead")} aria-describedby={id} title={editorMessage("editor.previewTimecode.title", { frameRate })}
      disabled={disabled} value={editing ? draft : displayTimecode(position, frameRate)}
      aria-invalid={error} spellCheck={false}
      className="w-[112px] rounded border border-transparent bg-transparent px-1 py-2 text-fg outline-none hover:border-border focus:border-accent disabled:opacity-50"
      onFocus={() => { cancel.current = false; setError(false); setDraft(displayTimecode(position, frameRate)); setEditing(true); useTimelineStore.getState().pause(); }}
      onChange={(event) => { setDraft(event.currentTarget.value); setError(false); }}
      onBlur={() => {
        setEditing(false);
        if (cancel.current) { cancel.current = false; return; }
        const time = parseFrameTimecode(draft, frameRate);
        if (time === null) { setError(true); return; }
        seek(time);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
        else if (event.key === "Escape") { event.preventDefault(); cancel.current = true; setError(false); event.currentTarget.blur(); }
        else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          const direction = event.key === "ArrowUp" ? 1 : -1;
          let time = parseFrameTimecode(draft, frameRate) ?? position;
          for (let count = 0; count < (event.shiftKey ? 10 : 1); count++) time = stepEditingFrame(time, direction, frameRate);
          time = Math.min(duration, time);
          setDraft(displayTimecode(time, frameRate)); seek(time);
        }
      }} />
    <span aria-hidden className="text-fg-muted">/</span>
    <span className="text-fg-muted" aria-label={editorMessage("editor.previewTimecode.duration")}>{displayTimecode(duration, frameRate)}</span>
    <span id={id} className="sr-only">{editorMessage("editor.previewTimecode.help")}</span>
    {error && <span role="alert" className="absolute bottom-full left-0 z-30 mb-1 w-60 rounded border border-status-error/30 bg-bg-2 p-2 font-sans text-xs text-status-error">{editorMessage("editor.previewTimecode.invalid")}</span>}
  </div>;
}
