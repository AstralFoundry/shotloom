import { t } from '@/i18n';
import { Segmented, Select, Switch } from "antd";
import { useRef, useState } from "react";
import { IconSymbol } from "../components/IconSymbol";
import {
  CINEMA_CAMERAS,
  CINEMA_LENSES,
  composeCinemaPrompt,
  DEFAULT_CINEMA_CAMERA_ID,
  DEFAULT_CINEMA_LENS_ID,
  findCinemaCamera,
  findCinemaLens,
} from "../../utils/cinemaCameraLibrary.ts";
import {
  APERTURE_OPTIONS,
  DEFAULT_CAMERA_CONFIG,
  FOCAL_LENGTH_OPTIONS,
  normalizeCameraConfig,
} from "../../utils/cameraConfig.ts";

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
  const [tab, setTab] = useState<'camera' | 'lens'>('camera');
  const normalized = normalizeCameraConfig(config);
  const camera = findCinemaCamera(normalized.cameraProfileId || DEFAULT_CINEMA_CAMERA_ID) ?? CINEMA_CAMERAS[0]!;
  const lens = findCinemaLens(normalized.lensProfileId || DEFAULT_CINEMA_LENS_ID) ?? CINEMA_LENSES[0]!;
  const prompt = composeCinemaPrompt({
    cameraId: camera.id,
    lensId: lens.id,
    focalLength: normalized.focalLength,
    aperture: normalized.aperture,
  });

  function commit(patch: Record<string, string>) {
    const nextCamera = findCinemaCamera(patch.cameraProfileId || camera.id) ?? camera;
    const nextLens = findCinemaLens(patch.lensProfileId || lens.id) ?? lens;
    onChange({
      ...normalized,
      ...patch,
      camera: nextCamera.name,
      lens: nextLens.name,
      cameraProfileId: nextCamera.id,
      lensProfileId: nextLens.id,
    });
  }

  return (
    <section
      ref={root}
      className="camera-control-panel nodrag nopan nowheel"
      aria-label={t("ui.CameraControlPanel.arialabel.5b628c80")}
      onClick={(event) => event.stopPropagation()}
    >
      <header className="camera-control-head">
        <div>
          <strong>{t("ui.CameraControlPanel.libraryTitle")}</strong>
          <span>{camera.zhName} · {lens.zhName}</span>
        </div>
        <button type="button" title={t("ui.CameraControlPanel.title.d0c1c6f9")} onClick={onClose}><IconSymbol name="check" /></button>
      </header>

      <Segmented
        className="camera-library-tabs"
        size="small"
        value={tab}
        onChange={(value) => setTab(value as 'camera' | 'lens')}
        options={[
          { value: 'camera', label: t('ui.CameraControlPanel.label.0756885e') },
          { value: 'lens', label: t('ui.CameraControlPanel.label.c7d1925f') },
        ]}
      />

      <div className="camera-profile-grid" role="group" aria-label={tab === 'camera' ? t('ui.CameraControlPanel.label.0756885e') : t('ui.CameraControlPanel.label.c7d1925f')}>
        {tab === 'camera'
          ? CINEMA_CAMERAS.map((profile) => (
              <button
                key={profile.id}
                type="button"
                className={`camera-profile-card is-camera${profile.id === camera.id ? ' is-active' : ''}`}
                aria-pressed={profile.id === camera.id}
                onClick={() => commit({ cameraProfileId: profile.id })}
              >
                <strong>{profile.zhName}</strong>
                <em>{profile.name} · {profile.sensor}</em>
                <span>{profile.description}</span>
                <small>{profile.useCase}</small>
              </button>
            ))
          : CINEMA_LENSES.map((profile) => (
              <button
                key={profile.id}
                type="button"
                className={`camera-profile-card is-lens${profile.id === lens.id ? ' is-active' : ''}`}
                aria-pressed={profile.id === lens.id}
                onClick={() => commit({ lensProfileId: profile.id })}
              >
                <strong>{profile.zhName}</strong>
                <em>{profile.name} · {profile.mount}</em>
                <span>{profile.description}</span>
                <small>{profile.useCase}</small>
              </button>
            ))}
      </div>

      <div className="camera-select-grid">
        <label className="camera-select-field">
          <span>{t("ui.CameraControlPanel.label.7bf130cc")}</span>
          <Select
            value={normalized.focalLength}
            aria-label={t("ui.CameraControlPanel.label.7bf130cc")}
            onChange={(value) => commit({ focalLength: value })}
            options={FOCAL_LENGTH_OPTIONS.map((option) => ({ value: option, label: option }))}
            popupMatchSelectWidth={false}
            getPopupContainer={() => root.current || document.body}
          />
        </label>
        <label className="camera-select-field">
          <span>{t("ui.CameraControlPanel.label.dbce052d")}</span>
          <Select
            value={normalized.aperture}
            aria-label={t("ui.CameraControlPanel.label.dbce052d")}
            onChange={(value) => commit({ aperture: value })}
            options={APERTURE_OPTIONS.map((option) => ({ value: option, label: option }))}
            popupMatchSelectWidth={false}
            getPopupContainer={() => root.current || document.body}
          />
        </label>
      </div>

      <div className="camera-prompt-preview">
        <span>{t('ui.CameraControlPanel.promptPreview')}</span>
        <p>{prompt}</p>
      </div>

      <footer>
        <label className="camera-apply-toggle">
          <Switch
            size="small"
            checked={enabled}
            onChange={(next) => {
              if (next && (!normalized.cameraProfileId || !normalized.lensProfileId)) {
                onChange({
                  ...normalized,
                  camera: camera.name,
                  lens: lens.name,
                  cameraProfileId: camera.id,
                  lensProfileId: lens.id,
                });
              }
              onToggle(next);
            }}
          />
          <span>{enabled ? t("ui.CameraControlPanel.text.a020d3f6") : t("ui.CameraControlPanel.text.f2ed5f47")}</span>
        </label>
        <button type="button" onClick={() => onChange({ ...normalizeCameraConfig(DEFAULT_CAMERA_CONFIG) })}>{t("ui.CameraControlPanel.text.a191935b")}</button>
      </footer>
    </section>
  );
}
