import { t } from '@/i18n';
import { useWorkbenchSurfaceRoot } from "../layout/workbenchSurface";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { clipExportPresets } from "./editorMediaPresentation";

export function ClipExportMenu({ anchor, project, onClose, onExport }: {
  anchor: { x: number; y: number; top?: number };
  project: unknown;
  onClose: () => void;
  onExport: (options: { target: "canvas" | "local"; presetId?: string; format?: "video" | "srt" }) => Promise<unknown>;
}) {
  const surface = useWorkbenchSurfaceRoot();
  const [target, setTarget] = useState<"canvas" | "local">("canvas");
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  useLayoutEffect(() => {
    const menu = root.current;
    if (!surface || !menu) return;
    const place = () => {
      const bounds = surface.getBoundingClientRect();
      const width = menu.offsetWidth;
      const height = menu.offsetHeight;
      const below = anchor.y - bounds.top + 6;
      const above = (anchor.top ?? anchor.y) - bounds.top - height - 6;
      const left = Math.max(8, Math.min(anchor.x - bounds.left - width, bounds.width - width - 8));
      const top = Math.max(8, Math.min(below + height <= bounds.height - 8 ? below : above, bounds.height - height - 8));
      setPosition(previous => previous.left === left && previous.top === top ? previous : { left, top });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(surface);
    observer.observe(menu);
    return () => observer.disconnect();
  }, [anchor, surface]);
  useEffect(() => {
    root.current?.focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); onClose(); }
    };
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  }, [onClose]);
  const run = (options: Parameters<typeof onExport>[0]) => {
    void onExport(options).catch((cause) => {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  };
  if (!surface) return null;
  return createPortal(<div className="clip-export-backdrop" onPointerDown={(event) => { event.stopPropagation(); if (event.target === event.currentTarget) onClose(); }}>
    <div ref={root} className="clip-export-menu" role="dialog" aria-label={t("ui.ClipExportMenu.arialabel.9bb4fe1a")} tabIndex={-1}
      style={position}>
      <div className="clip-export-destinations">
        <button type="button" aria-pressed={target === "canvas"} onMouseEnter={() => setTarget("canvas")} onFocus={() => setTarget("canvas")} onClick={() => setTarget("canvas")}><span>{t("ui.ClipExportMenu.text.dc3c7852")}</span><span aria-hidden="true">›</span></button>
        <button type="button" aria-pressed={target === "local"} onMouseEnter={() => setTarget("local")} onFocus={() => setTarget("local")} onClick={() => setTarget("local")}><span>{t("ui.ClipExportMenu.text.bbcd1bff")}</span><span aria-hidden="true">›</span></button>
        <button type="button" onClick={() => run({ target: "local", format: "srt" })}>{t("ui.ClipExportMenu.text.1e20ec9d")}</button>
      </div>
      <div className="clip-export-presets" aria-label={target === "canvas" ? t("ui.ClipExportMenu.text.5c4f971e") : t("ui.ClipExportMenu.text.3a9ac3ce")}>
        {clipExportPresets(project).map((preset) => <button type="button" key={preset.id} onClick={() => run({ target, presetId: preset.id })}>
          <strong>{preset.label}{preset.recommended ? t("ui.ClipExportMenu.text.a727b813") : ""}</strong><span>{preset.desc}</span>
        </button>)}
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
  </div>, surface);
}
