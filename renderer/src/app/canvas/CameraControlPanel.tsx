import { t } from '@/i18n';
import { IconSymbol } from "../components/IconSymbol";
import {
  APERTURE_OPTIONS,
  CAMERA_OPTIONS,
  DEFAULT_CAMERA_CONFIG,
  FOCAL_LENGTH_OPTIONS,
  LENS_OPTIONS,
  normalizeCameraConfig,
} from "../../utils/cameraConfig.ts";

const definitions = [
  { key: "camera", label: t("ui.CameraControlPanel.label.0756885e"), options: CAMERA_OPTIONS },
  { key: "lens", label: t("ui.CameraControlPanel.label.c7d1925f"), options: LENS_OPTIONS },
  { key: "focalLength", label: t("ui.CameraControlPanel.label.7bf130cc"), options: FOCAL_LENGTH_OPTIONS },
  { key: "aperture", label: t("ui.CameraControlPanel.label.dbce052d"), options: APERTURE_OPTIONS },
] as const;

interface CameraControlPanelProps {
  config?: Record<string, unknown>;
  enabled: boolean;
  onChange: (config: Record<string, string>) => void;
  onToggle: (enabled: boolean) => void;
  onClose: () => void;
}

export function CameraControlPanel({
  config = {},
  enabled,
  onChange,
  onToggle,
  onClose,
}: CameraControlPanelProps) {
  const normalized = normalizeCameraConfig(config) as Record<string, string>;
  function indexOfOption(options: readonly string[], value: string | undefined) {
    return Math.max(0, value === undefined ? -1 : options.indexOf(value));
  }
  function select(key: string, value: string | undefined) {
    if (value && normalized[key] !== value) onChange({ ...normalized, [key]: value });
  }
  function step(key: string, options: readonly string[], amount: number) {
    const current = indexOfOption(options, normalized[key]);
    const next = Math.max(0, Math.min(options.length - 1, current + amount));
    select(key, options[next]);
  }
  return (
    <section className="camera-control-panel nodrag nopan nowheel" aria-label={t("ui.CameraControlPanel.arialabel.5b628c80")} onClick={(event) => event.stopPropagation()}>
      <header className="camera-control-head">
        <div><strong>{t("ui.CameraControlPanel.arialabel.5b628c80")}</strong><span>{normalized.focalLength} · {normalized.aperture}</span></div>
        <button type="button" title={t("ui.CameraControlPanel.title.d0c1c6f9")} onClick={onClose}><IconSymbol name="check" /></button>
      </header>
      <div className="camera-wheel-grid">
        {definitions.map((definition) => {
          const index = indexOfOption(definition.options, normalized[definition.key]);
          return (
            <div
              key={definition.key}
              className="camera-wheel"
              tabIndex={0}
              role="listbox"
              aria-label={definition.label}
              onWheel={(event) => {
                event.preventDefault();
                event.stopPropagation();
                step(definition.key, definition.options, event.deltaY > 0 ? 1 : -1);
              }}
              onKeyDown={(event) => {
                if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                event.preventDefault();
                step(definition.key, definition.options, event.key === "ArrowDown" ? 1 : -1);
              }}
            >
              <span className="camera-wheel-label">{definition.label}</span>
              <div className="camera-wheel-window">
                {[-1, 0, 1].map((offset) => ({ offset, value: definition.options[index + offset] })).filter((item) => item.value).map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    role="option"
                    aria-selected={item.offset === 0}
                    className={`offset-${item.offset}${item.offset === 0 ? " active" : ""}`}
                    onClick={() => select(definition.key, item.value)}
                  >{item.value}</button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <footer>
        <label className="camera-apply-toggle">
          <input type="checkbox" checked={enabled} onChange={(event) => onToggle(event.target.checked)} />
          <span>{enabled ? t("ui.CameraControlPanel.text.a020d3f6") : t("ui.CameraControlPanel.text.f2ed5f47")}</span>
        </label>
        <button type="button" onClick={() => onChange(normalizeCameraConfig(DEFAULT_CAMERA_CONFIG))}>{t("ui.CameraControlPanel.text.a191935b")}</button>
      </footer>
    </section>
  );
}
