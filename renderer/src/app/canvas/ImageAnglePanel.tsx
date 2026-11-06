import { t } from '@/i18n';
import { Button, Segmented, Slider } from "antd";
import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

import {
  ANGLE_DISTANCE_RANGE,
  ANGLE_HORIZONTAL_RANGE,
  ANGLE_PITCH_RANGE,
  ANGLE_PRESETS,
  DEFAULT_ANGLE_PARAMS,
  angleDistanceLabel,
  anglePresetId,
  normalizeAngleParams,
  type ImageAngleParams,
} from '@/domain/graph/imageRecipe';
import { IconSymbol } from "../components/IconSymbol";
import { ImageRecipePanelFrame } from "./ImageRecipePanelFrame";

const PANEL_WIDTH = 664;
const PANEL_HEIGHT = 540;

/** 半径按面板宽度定死，立方体和球体共用同一套尺度，缩放时不会一半大一半小。 */
const SPHERE_RADIUS = 132;
const CUBE_SIZE = 104;
/** 摄像头模式下主体卡的最大外框；宽度按真实图片比例收在框内。 */
const SUBJECT_MAX_WIDTH = 120;
const SUBJECT_MAX_HEIGHT = 150;
const SUBJECT_MIN_SIZE = 44;
/** 机位标记贴着轨道走，半径取球半径的 0.9，正好在主体卡外面一圈。 */
const CAMERA_ORBIT_RATIO = 0.9;
/** 把"前方 / 后方"的深度差折成屏幕上下偏移，避免正面机位压在主体上。 */
const FRONT_DEPTH_BIAS = 0.45;
const MERIDIANS = [0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165];
const PARALLELS = [-60, -40, -20, 0, 20, 40, 60];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function previewScale(cameraDistance: number) {
  return 1.06 - ((cameraDistance - 1) / 9) * 0.26;
}

function AngleSlider({
  label,
  value,
  min,
  max,
  step = 1,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  display: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="image-recipe-field">
      <span className="image-recipe-field-head">
        <span>{label}</span>
        <span className="image-recipe-value">{display}</span>
      </span>
      <Slider
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        tooltip={{ open: false }}
        onChange={onChange}
      />
    </label>
  );
}

export function ImageAnglePanel({
  root,
  anchorRef,
  imageUrl,
  initialParams,
  onClose,
  onConfirm,
}: {
  root: HTMLElement | null;
  anchorRef: RefObject<HTMLDivElement | null>;
  imageUrl: string;
  initialParams?: ImageAngleParams;
  onClose: () => void;
  onConfirm: (params: ImageAngleParams) => void;
}) {
  const [params, setParams] = useState<ImageAngleParams>(() => normalizeAngleParams(initialParams ?? DEFAULT_ANGLE_PARAMS));
  const [previewMode, setPreviewMode] = useState<"camera" | "skybox">("camera");
  const [dragging, setDragging] = useState(false);
  // 摄像头模式要把主体放平，卡片比例只能取自真实图片；缺图时按 3:4 占位。
  const [imageAspect, setImageAspect] = useState(3 / 4);
  const dragStart = useRef<{ x: number; y: number; horizontalAngle: number; pitchAngle: number } | null>(null);
  const activePreset = anglePresetId(params);
  const update = (patch: Partial<ImageAngleParams>) => setParams((current) => ({ ...current, ...patch }));
  const distanceLabel = angleDistanceLabel(params.cameraDistance);
  const currentPresetLabel = ANGLE_PRESETS.find((preset) => preset.id === activePreset)?.label
    ?? t('imageRecipe.angle.preset.custom');

  function startDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("button")) return;
    event.preventDefault();
    dragStart.current = {
      x: event.clientX,
      y: event.clientY,
      horizontalAngle: params.horizontalAngle,
      pitchAngle: params.pitchAngle,
    };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const start = dragStart.current;
    if (!start) return;
    update({
      horizontalAngle: clamp(Math.round(start.horizontalAngle + (event.clientX - start.x) * 0.5), ANGLE_HORIZONTAL_RANGE.min, ANGLE_HORIZONTAL_RANGE.max),
      pitchAngle: clamp(Math.round(start.pitchAngle - (event.clientY - start.y) * 0.5), ANGLE_PITCH_RANGE.min, ANGLE_PITCH_RANGE.max),
    });
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragStart.current) return;
    dragStart.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* 指针已经离开窗口 */ }
    }
  }

  function bump(horizontal: number, pitch: number) {
    update({
      horizontalAngle: clamp(Math.round(params.horizontalAngle + horizontal), ANGLE_HORIZONTAL_RANGE.min, ANGLE_HORIZONTAL_RANGE.max),
      pitchAngle: clamp(Math.round(params.pitchAngle + pitch), ANGLE_PITCH_RANGE.min, ANGLE_PITCH_RANGE.max),
    });
  }

  const radians = Math.PI / 180;
  const stageScale = previewScale(params.cameraDistance);
  const cardWidth = imageAspect >= SUBJECT_MAX_WIDTH / SUBJECT_MAX_HEIGHT
    ? SUBJECT_MAX_WIDTH
    : Math.max(SUBJECT_MIN_SIZE, Math.round(SUBJECT_MAX_HEIGHT * imageAspect));
  const cardHeight = Math.max(SUBJECT_MIN_SIZE, Math.round(cardWidth / imageAspect));
  // 90° 为右侧、270° 为左侧；cos 只用来把"前方机位"压到轨道下方、"后方机位"抬到上方，
  // 这样正面视角的摄像头不会正好落在主体上。
  const cameraDirectionX = Math.sin(params.horizontalAngle * radians) * Math.cos(params.pitchAngle * radians);
  const cameraDirectionY = -Math.sin(params.pitchAngle * radians) + FRONT_DEPTH_BIAS * Math.cos(params.horizontalAngle * radians);
  const cameraDirectionLength = Math.hypot(cameraDirectionX, cameraDirectionY) || 1;
  const cameraOffset = SPHERE_RADIUS * CAMERA_ORBIT_RATIO * stageScale;
  const cameraX = (cameraDirectionX / cameraDirectionLength) * cameraOffset;
  const cameraY = (cameraDirectionY / cameraDirectionLength) * cameraOffset;
  const cameraSightAngle = (Math.atan2(-cameraY, -cameraX) * 180) / Math.PI;
  const cubeStyle = { "--image-angle-cube-half": `${CUBE_SIZE / 2}px` } as CSSProperties;

  return (
    <ImageRecipePanelFrame
      title={t('imageRecipe.angle.header')}
      icon="camera"
      closeLabel={t('imageRecipe.angle.aria.close')}
      width={PANEL_WIDTH}
      height={PANEL_HEIGHT}
      root={root}
      anchorRef={anchorRef}
      onClose={onClose}
    >
      <div className="image-recipe-chips" role="group" aria-label={t('imageRecipe.angle.commonAngles')}>
        {/* 自定义是"没有一个预设匹配"的状态标记，点它不该把参数重置成某个角度。 */}
        <span
          className={`image-recipe-chip image-recipe-chip--state${activePreset === 'custom' ? ' is-active' : ''}`}
        >
          {t('imageRecipe.angle.preset.custom')}
        </span>
        {ANGLE_PRESETS.filter((preset) => preset.id !== 'custom').map((preset) => (
          <button
            key={preset.id}
            type="button"
            className="image-recipe-chip"
            aria-pressed={preset.id === activePreset}
            onClick={() => update({ horizontalAngle: preset.horizontalAngle, pitchAngle: preset.pitchAngle })}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="image-angle-body">
        <div
          className={`image-angle-stage is-${previewMode}${dragging ? " is-dragging" : ""}`}
          role="group"
          aria-label={t('imageRecipe.angle.aria.stage')}
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <div className="image-angle-viewport">
            {/* 指向主体的虚线画在主体下面：线延伸到球心，被不透明的主体卡自然截断。 */}
            {previewMode === "camera" && (
              <span
                className="image-angle-camera-sight"
                style={{
                  left: `calc(50% + ${cameraX}px)`,
                  top: `calc(50% + ${cameraY}px)`,
                  width: cameraOffset,
                  transform: `rotate(${cameraSightAngle}deg)`,
                }}
                aria-hidden="true"
              />
            )}
            <div
              className="image-angle-orbit"
              style={{ transform: `scale(${stageScale}) rotateX(${-params.pitchAngle}deg) rotateY(${params.horizontalAngle}deg)` }}
            >
              <div className="image-angle-sphere" style={{ width: SPHERE_RADIUS * 2, height: SPHERE_RADIUS * 2 }}>
                {MERIDIANS.map((angle) => (
                  <span key={`meridian-${angle}`} className="image-angle-meridian" style={{ transform: `rotateY(${angle}deg)` }} />
                ))}
                {PARALLELS.map((latitude) => {
                  const scale = Math.cos(latitude * radians);
                  const diameter = SPHERE_RADIUS * 2 * scale;
                  const offset = SPHERE_RADIUS * Math.sin(latitude * radians);
                  return (
                    <span
                      key={`parallel-${latitude}`}
                      className="image-angle-parallel"
                      style={{ width: diameter, height: diameter, transform: `translate(-50%, -50%) rotateX(90deg) translateZ(${offset}px)` }}
                    />
                  );
                })}
                {/* 天空盒是看"盒子外面"：图像贴在立方体正面，其余面标出方向。 */}
                {previewMode === "skybox" && (
                  <div className="image-angle-cube" style={cubeStyle}>
                    <span className="image-angle-face is-front">
                      {imageUrl
                        ? <img src={imageUrl} alt="" draggable={false} />
                        : <span className="image-angle-face-empty">{t('imageRecipe.angle.face.empty')}</span>}
                    </span>
                    <span className="image-angle-face is-back">{t('imageRecipe.angle.face.back')}</span>
                    <span className="image-angle-face is-right">{t('imageRecipe.angle.face.right')}</span>
                    <span className="image-angle-face is-left">{t('imageRecipe.angle.face.left')}</span>
                    <span className="image-angle-face is-top">{t('imageRecipe.angle.face.top')}</span>
                    <span className="image-angle-face is-bottom">{t('imageRecipe.angle.face.bottom')}</span>
                  </div>
                )}
              </div>
            </div>
            {/* 摄像头是看"镜头里的主体"：平面主体不随轨道旋转，只反映景别。 */}
            {previewMode === "camera" && (
              <div
                className="image-angle-subject"
                style={{ width: cardWidth, height: cardHeight, transform: `translate(-50%, -50%) scale(${stageScale})` }}
              >
                {imageUrl
                  ? (
                    <img
                      src={imageUrl}
                      alt=""
                      draggable={false}
                      onLoad={(event) => {
                        const image = event.currentTarget;
                        if (image.naturalWidth > 0 && image.naturalHeight > 0) setImageAspect(image.naturalWidth / image.naturalHeight);
                      }}
                    />
                  )
                  : <span className="image-angle-subject-empty">{t('imageRecipe.angle.face.empty')}</span>}
              </div>
            )}
          </div>

          <button type="button" className="image-angle-arrow is-up" aria-label={t('imageRecipe.angle.aria.up')} onClick={() => bump(0, 5)}>
            <IconSymbol name="chevron-up" />
          </button>
          <button type="button" className="image-angle-arrow is-down" aria-label={t('imageRecipe.angle.aria.down')} onClick={() => bump(0, -5)}>
            <IconSymbol name="chevron-down" />
          </button>
          <button type="button" className="image-angle-arrow is-left" aria-label={t('imageRecipe.angle.aria.left')} onClick={() => bump(-5, 0)}>
            <IconSymbol name="chevron-left" />
          </button>
          <button type="button" className="image-angle-arrow is-right" aria-label={t('imageRecipe.angle.aria.right')} onClick={() => bump(5, 0)}>
            <IconSymbol name="chevron-right" />
          </button>

          {previewMode === "camera" && (
            <span
              className="image-angle-camera"
              style={{ left: `calc(50% + ${cameraX}px)`, top: `calc(50% + ${cameraY}px)` }}
              aria-hidden="true"
            >
              <span className="image-angle-camera-shoe" />
              <span className="image-angle-camera-body">
                <i className="image-angle-camera-lens" />
              </span>
            </span>
          )}
        </div>

        <div className="image-angle-controls">
          <Segmented
            block
            size="small"
            value={previewMode}
            onChange={(value) => setPreviewMode(value as "camera" | "skybox")}
            options={[
              { value: 'skybox', label: t('imageRecipe.angle.mode.skybox') },
              { value: 'camera', label: t('imageRecipe.angle.mode.camera') },
            ]}
          />
          <span className="image-recipe-label">{t('imageRecipe.angle.commonAngles')}</span>
          <div className="image-angle-preset-grid">
            {ANGLE_PRESETS.filter((preset) => preset.id !== 'custom').map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="image-recipe-choice"
                aria-pressed={preset.id === activePreset}
                onClick={() => update({ horizontalAngle: preset.horizontalAngle, pitchAngle: preset.pitchAngle })}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <AngleSlider
            label={t('imageRecipe.angle.horizontal')}
            value={params.horizontalAngle}
            min={ANGLE_HORIZONTAL_RANGE.min}
            max={ANGLE_HORIZONTAL_RANGE.max}
            display={`${params.horizontalAngle}°`}
            onChange={(value) => update({ horizontalAngle: value })}
          />
          <AngleSlider
            label={t('imageRecipe.angle.pitch')}
            value={params.pitchAngle}
            min={ANGLE_PITCH_RANGE.min}
            max={ANGLE_PITCH_RANGE.max}
            display={`${params.pitchAngle}°`}
            onChange={(value) => update({ pitchAngle: value })}
          />
          <AngleSlider
            label={t('imageRecipe.angle.distance')}
            value={params.cameraDistance}
            min={ANGLE_DISTANCE_RANGE.min}
            max={ANGLE_DISTANCE_RANGE.max}
            step={0.1}
            display={`${params.cameraDistance.toFixed(1)} ${distanceLabel}`}
            onChange={(value) => update({ cameraDistance: Number(value.toFixed(1)) })}
          />
          <div className="image-recipe-field-row">
            <span className="image-recipe-label">{t('imageRecipe.angle.lens')}</span>
            <Segmented
              size="small"
              value={params.wideAngle ? 'wide' : 'standard'}
              onChange={(value) => update({ wideAngle: value === 'wide' })}
              options={[
                { value: 'standard', label: t('imageRecipe.angle.lens.standard') },
                { value: 'wide', label: t('imageRecipe.angle.lens.wide') },
              ]}
            />
          </div>
        </div>
      </div>

      <footer className="image-recipe-foot">
        <span className="image-recipe-foot-label">{t('imageRecipe.angle.current')}</span>
        <strong>{currentPresetLabel}</strong>
        <span className="image-recipe-foot-meta">
          {params.horizontalAngle}° / {params.pitchAngle}° · {params.cameraDistance.toFixed(1)} {distanceLabel}
        </span>
        <span className="image-recipe-foot-spacer" />
        <Button size="small" onClick={() => setParams(DEFAULT_ANGLE_PARAMS)}>
          {t('imageRecipe.angle.reset')}
        </Button>
        <Button size="small" type="primary" onClick={() => onConfirm(params)}>
          {t('imageRecipe.angle.generate')}
        </Button>
      </footer>
    </ImageRecipePanelFrame>
  );
}
