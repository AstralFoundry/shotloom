import { IconSymbol } from "../components/IconSymbol";
import {
  APERTURE_OPTIONS,
  CAMERA_OPTIONS,
  DEFAULT_CAMERA_CONFIG,
  FOCAL_LENGTH_OPTIONS,
  LENS_OPTIONS,
  normalizeCameraConfig,
} from "../../utils/cameraConfig.js";

const definitions = [
  { key: "camera", label: "摄影机", options: CAMERA_OPTIONS },
  { key: "lens", label: "镜头", options: LENS_OPTIONS },
  { key: "focalLength", label: "焦距", options: FOCAL_LENGTH_OPTIONS },
  { key: "aperture", label: "光圈", options: APERTURE_OPTIONS },
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
  function select(key: string, value: string | undefined) {
    if (value && normalized[key] !== value) onChange({ ...normalized, [key]: value });
  }
  function step(key: string, options: readonly string[], amount: number) {
    const current = Math.max(0, options.indexOf(normalized[key]));
    const next = Math.max(0, Math.min(options.length - 1, current + amount));
    select(key, options[next]);
  }
  return (
    <section className="camera-control-panel nodrag nopan nowheel" aria-label="摄影机配置" onClick={(event) => event.stopPropagation()}>
      <header className="camera-control-head">
        <div><strong>摄影机配置</strong><span>{normalized.focalLength} · {normalized.aperture}</span></div>
        <button type="button" title="完成摄影机配置" onClick={onClose}><IconSymbol name="check" /></button>
      </header>
      <div className="camera-wheel-grid">
        {definitions.map((definition) => {
          const index = Math.max(0, definition.options.indexOf(normalized[definition.key]));
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
          <span>{enabled ? "已应用到生成" : "不应用到生成"}</span>
        </label>
        <button type="button" onClick={() => onChange({ ...DEFAULT_CAMERA_CONFIG })}>恢复默认</button>
      </footer>
    </section>
  );
}
