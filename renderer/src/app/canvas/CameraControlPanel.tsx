import { t } from '@/i18n';
import { Select, Switch } from "antd";
import { useRef } from "react";
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
  const root = useRef<HTMLElement>(null);
  const normalized = normalizeCameraConfig(config) as Record<string, string>;
  function select(key: string, value: string | undefined) {
    if (value && normalized[key] !== value) onChange({ ...normalized, [key]: value });
  }
  return (
    <section
      ref={root}
      className="camera-control-panel nodrag nopan nowheel"
      aria-label={t("ui.CameraControlPanel.arialabel.5b628c80")}
      onClick={(event) => event.stopPropagation()}
    >
      <header className="camera-control-head">
        <div><strong>{t("ui.CameraControlPanel.arialabel.5b628c80")}</strong><span>{normalized.focalLength} · {normalized.aperture}</span></div>
        <button type="button" title={t("ui.CameraControlPanel.title.d0c1c6f9")} onClick={onClose}><IconSymbol name="check" /></button>
      </header>
      <div className="camera-select-grid">
        {definitions.map((definition) => (
          <label key={definition.key} className="camera-select-field">
            <span>{definition.label}</span>
            <Select
              value={normalized[definition.key] ?? null}
              aria-label={definition.label}
              onChange={(value) => select(definition.key, value ?? undefined)}
              options={definition.options.map((option) => ({ value: option, label: option }))}
              popupMatchSelectWidth={false}
              // 面板住在画布里：弹层挂回面板，避免随画布缩放/平移漂移。
              getPopupContainer={() => root.current || document.body}
            />
          </label>
        ))}
      </div>
      <footer>
        <label className="camera-apply-toggle">
          <Switch size="small" checked={enabled} onChange={onToggle} />
          <span>{enabled ? t("ui.CameraControlPanel.text.a020d3f6") : t("ui.CameraControlPanel.text.f2ed5f47")}</span>
        </label>
        <button type="button" onClick={() => onChange(normalizeCameraConfig(DEFAULT_CAMERA_CONFIG))}>{t("ui.CameraControlPanel.text.a191935b")}</button>
      </footer>
    </section>
  );
}
