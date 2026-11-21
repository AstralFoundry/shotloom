import { getLocale, t } from '@/i18n';
import { showSuccessToast, showToast } from '@/store/notificationStore';
import { Button, Modal, Switch, Tooltip } from "antd";
import { useState, type ReactNode } from "react";
import { IconSymbol } from "../components/IconSymbol";
import { CINEMA_CAMERAS, CINEMA_LENSES, findCinemaCamera, findCinemaLens } from "../../utils/cinemaCameraLibrary.ts";
import {
  APERTURE_OPTIONS,
  DEFAULT_CAMERA_CONFIG,
  FOCAL_LENGTH_OPTIONS,
  applyCameraConfigToPrompt,
  normalizeCameraConfig,
} from "../../utils/cameraConfig.ts";

type Direction = -1 | 1;

function cycleOption<T>(options: readonly T[], index: number, direction: Direction): T {
  const next = index < 0 ? (direction === 1 ? 0 : options.length - 1) : index + direction;
  return options[(next + options.length) % options.length]!;
}

function CameraSetting({ label, value, hint, children, onCycle }: {
  label: string;
  value: string;
  hint?: string | undefined;
  children: ReactNode;
  onCycle: (direction: Direction) => void;
}) {
  const previous = t('canvas.camera.previous', { label });
  const next = t('canvas.camera.next', { label });
  return (
    <div className="camera-setting" role="group" aria-label={label}>
      <button type="button" className="camera-setting-step" title={previous} aria-label={previous} onClick={() => onCycle(-1)}>
        <IconSymbol name="chevron-up" />
      </button>
      <Tooltip title={hint} placement="top" mouseEnterDelay={0.5}>
        <div className="camera-setting-card">
          <span>{label}</span>
          <div className="camera-setting-value">{children}</div>
        </div>
      </Tooltip>
      <button type="button" className="camera-setting-step" title={next} aria-label={next} onClick={() => onCycle(1)}>
        <IconSymbol name="chevron-down" />
      </button>
      <span className="camera-setting-caption">{value}</span>
    </div>
  );
}

export function CameraControlPanel({ config, enabled, onApply, onClose }: {
  config: Record<string, unknown>;
  enabled: boolean;
  onApply: (config: Record<string, string>, enabled: boolean) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => normalizeCameraConfig(config));
  const [applyToGeneration, setApplyToGeneration] = useState(enabled);
  const camera = findCinemaCamera(draft.cameraProfileId);
  const lens = findCinemaLens(draft.lensProfileId);
  const chinese = getLocale() === 'zh-CN';
  const cameraName = (chinese ? camera?.zhName : camera?.name) || draft.camera;
  const lensName = (chinese ? lens?.zhName : lens?.name) || draft.lens;
  const focal = Number.parseFloat(draft.focalLength);
  const aperture = Number.parseFloat(draft.aperture.slice(2));
  const focalCaption = focal < 35 ? t('canvas.camera.wide') : focal >= 85 ? t('canvas.camera.telephoto') : t('canvas.camera.normal');
  const apertureCaption = aperture <= 2.8 ? t('canvas.camera.wideAperture') : aperture >= 8 ? t('canvas.camera.narrowAperture') : t('canvas.camera.mediumAperture');

  function reset() {
    setDraft({ ...DEFAULT_CAMERA_CONFIG });
    setApplyToGeneration(false);
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(applyCameraConfigToPrompt('', draft));
      showSuccessToast(t('canvas.camera.promptCopied'));
    } catch {
      showToast(t('canvas.camera.copyFailed'), 'error');
    }
  }

  return (
    <Modal
      open
      centered
      keyboard={false}
      width={780}
      modalRender={(content) => (
        <div onKeyDown={(event) => {
          // React Flow receives key events through the portal's React ancestry.
          event.stopPropagation();
          if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
          }
        }}>
          {content}
        </div>
      )}
      className="camera-control-modal"
      classNames={{ mask: "camera-control-mask" }}
      onCancel={onClose}
      title={
        <div className="camera-control-heading">
          <strong>{t('canvas.camera.title')}</strong>
          <span>{t('canvas.camera.description')}</span>
        </div>
      }
      footer={
        <div className="camera-control-actions">
          <Button type="text" icon={<IconSymbol name="rotate-ccw" />} onClick={reset}>
            {t('canvas.camera.reset')}
          </Button>
          <div className="camera-control-actions-end">
            <Button type="text" onClick={() => void copyPrompt()}>{t('canvas.camera.copyPrompt')}</Button>
            <label className="camera-apply-toggle">
              <span>{applyToGeneration ? t('canvas.camera.on') : t('canvas.camera.off')}</span>
              <Switch
                size="small"
                checked={applyToGeneration}
                onChange={setApplyToGeneration}
                aria-label={t('canvas.camera.enable')}
              />
            </label>
            <Button className="camera-control-apply" icon={<IconSymbol name="camera" />} onClick={() => onApply(draft, applyToGeneration)}>
              {t('canvas.camera.apply')}
            </Button>
          </div>
        </div>
      }
    >
      <div className="camera-control-settings">
        <CameraSetting
          label={t('ui.CameraControlPanel.label.0756885e')}
          value={cameraName}
          hint={camera && chinese ? camera.description : camera?.sensor}
          onCycle={direction => setDraft(current => {
            const profile = cycleOption(CINEMA_CAMERAS, CINEMA_CAMERAS.findIndex(item => item.id === current.cameraProfileId), direction);
            return { ...current, camera: profile.name, cameraProfileId: profile.id };
          })}
        >
          <IconSymbol className="camera-setting-equipment" name="cinema-camera" style={{ color: camera?.bodyColor, stroke: camera?.trimColor }} />
        </CameraSetting>
        <CameraSetting
          label={t('ui.CameraControlPanel.label.c7d1925f')}
          value={lensName}
          hint={lens && chinese ? lens.description : lens?.mount}
          onCycle={direction => setDraft(current => {
            const profile = cycleOption(CINEMA_LENSES, CINEMA_LENSES.findIndex(item => item.id === current.lensProfileId), direction);
            return { ...current, lens: profile.name, lensProfileId: profile.id };
          })}
        >
          <IconSymbol className="camera-setting-equipment" name="cinema-lens" style={{ color: lens?.bodyColor, stroke: lens?.trimColor }} />
        </CameraSetting>
        <CameraSetting
          label={t('ui.CameraControlPanel.label.7bf130cc')}
          value={focalCaption}
          onCycle={direction => setDraft(current => ({
            ...current,
            focalLength: cycleOption(FOCAL_LENGTH_OPTIONS, FOCAL_LENGTH_OPTIONS.indexOf(current.focalLength), direction),
          }))}
        >
          <strong>{focal}</strong><small>mm</small>
        </CameraSetting>
        <CameraSetting
          label={t('ui.CameraControlPanel.label.dbce052d')}
          value={apertureCaption}
          onCycle={direction => setDraft(current => ({
            ...current,
            aperture: cycleOption(APERTURE_OPTIONS, APERTURE_OPTIONS.indexOf(current.aperture), direction),
          }))}
        >
          <strong><span>f/</span>{draft.aperture.slice(2)}</strong>
        </CameraSetting>
      </div>
      <div className="camera-control-summary">
        <span>{t('canvas.camera.summary')}</span>
        <div aria-live="polite">{cameraName} · {lensName} · {draft.focalLength} · {draft.aperture}</div>
      </div>
    </Modal>
  );
}
