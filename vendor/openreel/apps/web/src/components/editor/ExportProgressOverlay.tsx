import { editorMessage } from "../../shotloom-mode";
import { Loader2 } from "@/icons/lucide-compat";

const phaseKeys = {
  "preparing": "editor.export.phase.preparing",
  "preparing...": "editor.export.phase.preparing",
  "rendering": "editor.export.phase.rendering",
  "rendering...": "editor.export.phase.rendering",
  "encoding": "editor.export.phase.encoding",
  "encoding...": "editor.export.phase.encoding",
  "muxing": "editor.export.phase.muxing",
  "muxing...": "editor.export.phase.muxing",
  "finalizing": "editor.export.phase.finalizing",
  "finalizing...": "editor.export.phase.finalizing",
  "complete": "editor.export.phase.complete",
  "complete...": "editor.export.phase.complete",
  "Complete!": "editor.export.phase.complete"
} as const;

interface Props {
  progress: number;
  phase: string;
  width: number;
  height: number;
}

/** Sized to the preview workspace, independently of project aspect ratio/zoom. */
export function ExportProgressOverlay({ progress, phase, width, height }: Props) {
  const percent = Math.round(Number.isFinite(progress) ? Math.min(100, Math.max(0, progress)) : 0);
  const minimal = height < 96 || width < 240;
  const compact = minimal || height < 180 || width < 320;
  const phaseKey = Object.hasOwn(phaseKeys, phase) ? phaseKeys[phase as keyof typeof phaseKeys] : undefined;
  const stage = phaseKey ? editorMessage(phaseKey) : phase || editorMessage("editor.export.phase.preparing");
  return (
    <div data-export-overlay className={`absolute inset-0 z-50 flex min-h-0 min-w-0 items-center justify-center bg-bg-1/85 backdrop-blur-sm ${minimal ? "p-1" : "p-3"}`}>
      <div data-export-card className={`relative max-h-full w-full min-w-0 max-w-[360px] overflow-y-auto rounded-xl border border-border bg-bg-1 text-fg shadow-xl ${minimal ? "px-2 py-1" : compact ? "p-3" : "p-4"}`}>
        <div role="status" aria-live="polite" className={`flex min-w-0 items-center ${minimal ? "gap-2" : "gap-3"}`}>
          {!minimal && <span className={`flex shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent ${compact ? "h-7 w-7" : "h-9 w-9"}`}><Loader2 size={compact ? 16 : 19} className="animate-spin" aria-hidden /></span>}
          <div className="min-w-0 flex-1">
            <p className={`${minimal ? "text-[10px] leading-3" : compact ? "text-xs leading-5" : "text-sm leading-5"} truncate font-semibold`}>{editorMessage(minimal ? "editor.export.compactHeading" : "editor.export.heading")}</p>
            {!minimal && <p className="truncate text-[11px] leading-4 text-fg-muted">{stage}</p>}
            {minimal && <span className="sr-only">{stage}</span>}
          </div>
          <span aria-hidden="true" className={`shrink-0 font-mono font-semibold tabular-nums ${minimal ? "text-[10px] leading-3" : compact ? "text-xs" : "text-base"}`}>{percent}%</span>
        </div>
        <div role="progressbar" aria-label={editorMessage("editor.export.progressAria")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className={`overflow-hidden rounded-full bg-bg-3 ${minimal ? "absolute inset-x-0 bottom-0 h-0.5" : "mt-3 h-1.5"}`}>
          <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${percent}%` }} />
        </div>
      </div>
    </div>
  );
}
