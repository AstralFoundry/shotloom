import { t } from '@/i18n';
import { Button, ColorPicker, Input, Modal, Segmented, Slider, Switch } from "antd";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

import {
  DEFAULT_LIGHTING_OPTIONS,
  LIGHT_POSITION_RANGE,
  LIGHT_POSITIONS,
  LIGHTING_PROMPT_PLACEHOLDERS,
  LIGHTING_STYLE_PRESETS,
  DEFAULT_LIGHTING_PROMPT_TEMPLATE,
  composeLightingPrompt,
  normalizeLightingOptions,
  type ImageLightingOptions,
} from '@/domain/graph/imageRecipe';
import { showSuccessToast, showToast } from '@/store/notificationStore';
import { IconSymbol } from "../components/IconSymbol";
import { ImageRecipePanelFrame } from "./ImageRecipePanelFrame";

const PANEL_WIDTH = 664;
const PANEL_HEIGHT = 648;
const STAGE_SIZE = 236;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/**
 * 光照球是纯 2D canvas：网格只交代方位，真正的信息是光点相对主体的位置。
 * 用 2D 而不是 WebGL，是因为这里不需要真实材质，拖动时才不会为一次预览建上下文。
 */
function drawLightingStage(
  canvas: HTMLCanvasElement,
  options: { azimuth: number; elevation: number; viewMode: "perspective" | "front"; image: HTMLImageElement | null },
) {
  const context = canvas.getContext("2d");
  if (!context) return;
  const ratio = Math.max(1, window.devicePixelRatio || 1);
  if (canvas.width !== Math.round(STAGE_SIZE * ratio)) {
    canvas.width = Math.round(STAGE_SIZE * ratio);
    canvas.height = Math.round(STAGE_SIZE * ratio);
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, STAGE_SIZE, STAGE_SIZE);

  const center = STAGE_SIZE / 2;
  const radius = STAGE_SIZE / 2 - 8;
  const radians = Math.PI / 180;
  const azimuth = options.azimuth * radians;
  const elevation = options.elevation * radians;
  const lightX = options.viewMode === "front"
    ? center + radius * Math.sin(azimuth) * 0.85
    : center + radius * Math.sin(azimuth) * Math.cos(elevation);
  const lightY = options.viewMode === "front"
    ? center - radius * Math.sin(elevation) * 0.85
    : center - radius * Math.sin(elevation);

  context.save();
  context.beginPath();
  context.arc(center, center, radius, 0, Math.PI * 2);
  context.closePath();
  context.fillStyle = "#111114";
  context.fill();
  context.strokeStyle = "rgba(255, 255, 255, .16)";
  context.lineWidth = 1;
  context.stroke();
  context.clip();

  const glow = context.createRadialGradient(lightX, lightY, 0, lightX, lightY, radius * 1.4);
  glow.addColorStop(0, "rgba(255, 252, 238, .5)");
  glow.addColorStop(.32, "rgba(255, 236, 196, .16)");
  glow.addColorStop(.68, "rgba(255, 205, 120, .05)");
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, STAGE_SIZE, STAGE_SIZE);

  context.strokeStyle = "rgba(255, 255, 255, .1)";
  context.lineWidth = .7;
  if (options.viewMode === "front") {
    for (let index = -2; index <= 2; index += 1) {
      const offset = index * (radius / 3);
      context.beginPath();
      context.moveTo(center + offset, center - radius);
      context.lineTo(center + offset, center + radius);
      context.stroke();
      context.beginPath();
      context.moveTo(center - radius, center + offset);
      context.lineTo(center + radius, center + offset);
      context.stroke();
    }
  } else {
    for (let latitude = -75; latitude <= 75; latitude += 15) {
      const ellipseRadius = radius * Math.cos(latitude * radians);
      const baseY = center - radius * Math.sin(latitude * radians);
      context.beginPath();
      context.ellipse(center, baseY, ellipseRadius, ellipseRadius * .22, 0, 0, Math.PI * 2);
      context.stroke();
    }
    for (let index = 0; index < 8; index += 1) {
      const angle = (index * Math.PI) / 4;
      context.beginPath();
      context.ellipse(center, center, radius * Math.abs(Math.cos(angle)), radius, 0, 0, Math.PI * 2);
      context.stroke();
    }
  }

  if (options.image) {
    const sourceWidth = options.image.naturalWidth || options.image.width;
    const sourceHeight = options.image.naturalHeight || options.image.height;
    const aspect = sourceWidth > 0 && sourceHeight > 0 ? sourceWidth / sourceHeight : 3 / 4;
    const maxWidth = radius * 0.9;
    const maxHeight = radius * 1.08;
    const width = Math.min(maxWidth, maxHeight * aspect);
    const height = Math.min(maxHeight, maxWidth / aspect);
    context.save();
    context.shadowColor = "rgba(0, 0, 0, .8)";
    context.shadowBlur = 14;
    context.drawImage(options.image, center - width / 2, center - height / 2, width, height);
    context.shadowBlur = 0;
    context.strokeStyle = "rgba(255, 255, 255, .22)";
    context.lineWidth = 1;
    context.strokeRect(center - width / 2, center - height / 2, width, height);
    context.restore();
  } else {
    const width = radius * 0.42;
    const height = radius * 0.62;
    context.fillStyle = "rgba(255, 255, 255, .04)";
    context.strokeStyle = "rgba(255, 255, 255, .16)";
    context.fillRect(center - width / 2, center - height / 2, width, height);
    context.strokeRect(center - width / 2, center - height / 2, width, height);
  }
  context.restore();

  const dotGlow = context.createRadialGradient(lightX, lightY, 0, lightX, lightY, 15);
  dotGlow.addColorStop(0, "rgba(255, 248, 214, .95)");
  dotGlow.addColorStop(.4, "rgba(255, 224, 138, .5)");
  dotGlow.addColorStop(1, "rgba(255, 204, 64, 0)");
  context.beginPath();
  context.fillStyle = dotGlow;
  context.arc(lightX, lightY, 15, 0, Math.PI * 2);
  context.fill();

  context.beginPath();
  context.arc(lightX, lightY, 5, 0, Math.PI * 2);
  context.fillStyle = "rgba(255, 255, 255, .95)";
  context.fill();
}

function LightingPresetThumb({
  preset,
  active,
  onSelect,
}: {
  preset: (typeof LIGHTING_STYLE_PRESETS)[number];
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className="image-lighting-preset"
      aria-pressed={active}
      onClick={onSelect}
      style={{
        backgroundImage: `linear-gradient(150deg, ${preset.tone} -18%, #0b0b10 118%)`,
      }}
    >
      <span>{preset.label}</span>
      {active && (
        <span className="image-lighting-preset-check" aria-hidden="true">
          <IconSymbol name="check" />
        </span>
      )}
    </button>
  );
}

export function ImageLightingPanel({
  root,
  anchorRef,
  imageUrl,
  initialOptions,
  onClose,
  onConfirm,
}: {
  root: HTMLElement | null;
  anchorRef: RefObject<HTMLDivElement | null>;
  imageUrl: string;
  initialOptions?: ImageLightingOptions;
  onClose: () => void;
  onConfirm: (options: ImageLightingOptions) => void;
}) {
  const [options, setOptions] = useState<ImageLightingOptions>(() => normalizeLightingOptions(initialOptions ?? DEFAULT_LIGHTING_OPTIONS));
  const [viewMode, setViewMode] = useState<"perspective" | "front">("perspective");
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateDraft, setTemplateDraft] = useState(options.promptTemplate);
  const stageRef = useRef<HTMLCanvasElement>(null);
  const previewImage = useRef<HTMLImageElement | null>(null);
  const dragStart = useRef<{ x: number; y: number; azimuth: number; elevation: number } | null>(null);
  const [imageRevision, setImageRevision] = useState(0);

  useEffect(() => {
    if (!imageUrl) {
      previewImage.current = null;
      setImageRevision((current) => current + 1);
      return;
    }
    const image = new Image();
    image.onload = () => {
      previewImage.current = image;
      setImageRevision((current) => current + 1);
    };
    image.onerror = () => {
      previewImage.current = null;
      setImageRevision((current) => current + 1);
    };
    image.src = imageUrl;
    return () => {
      image.onload = null;
      image.onerror = null;
    };
  }, [imageUrl]);

  useEffect(() => {
    const canvas = stageRef.current;
    if (!canvas) return;
    drawLightingStage(canvas, {
      azimuth: options.azimuth,
      elevation: options.elevation,
      viewMode,
      image: previewImage.current,
    });
  }, [imageRevision, options.azimuth, options.elevation, viewMode]);

  const update = (patch: Partial<ImageLightingOptions>) => setOptions((current) => ({ ...current, ...patch }));
  const prompt = composeLightingPrompt(options);

  function startDrag(event: ReactPointerEvent<HTMLCanvasElement>) {
    event.preventDefault();
    dragStart.current = { x: event.clientX, y: event.clientY, azimuth: options.azimuth, elevation: options.elevation };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: ReactPointerEvent<HTMLCanvasElement>) {
    const start = dragStart.current;
    if (!start) return;
    const azimuth = Math.round(((Math.round(start.azimuth + (event.clientX - start.x) * 1.5) % 360) + 360) % 360);
    update({
      azimuth,
      elevation: clamp(Math.round(start.elevation - (event.clientY - start.y)), LIGHT_POSITION_RANGE.elevation.min, LIGHT_POSITION_RANGE.elevation.max),
    });
  }

  function endDrag(event: ReactPointerEvent<HTMLCanvasElement>) {
    dragStart.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* 指针已经离开窗口 */ }
    }
  }

  function copyPrompt() {
    void navigator.clipboard.writeText(prompt).then(
      () => showSuccessToast(t('imageRecipe.lighting.promptCopied')),
      () => showToast(t('imageRecipe.lighting.copyFailed'), 'error'),
    );
  }

  function openTemplate() {
    setTemplateDraft(options.promptTemplate);
    setTemplateOpen(true);
  }

  return (
    <ImageRecipePanelFrame
      title={t('imageRecipe.lighting.header')}
      icon="sun"
      closeLabel={t('imageRecipe.lighting.aria.close')}
      width={PANEL_WIDTH}
      height={PANEL_HEIGHT}
      root={root}
      anchorRef={anchorRef}
      onClose={onClose}
    >
      <div className="image-lighting-body">
        <div className="image-lighting-preview">
          <Segmented
            block
            size="small"
            value={viewMode}
            onChange={(value) => setViewMode(value as "perspective" | "front")}
            options={[
              { value: 'perspective', label: t('imageRecipe.lighting.view.perspective') },
              { value: 'front', label: t('imageRecipe.lighting.view.front') },
            ]}
          />
          <canvas
            ref={stageRef}
            className="image-lighting-stage"
            aria-label={t('imageRecipe.lighting.aria.sphere')}
            onPointerDown={startDrag}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          />
        </div>

        <div className="image-lighting-controls">
          <div className="image-recipe-field-row">
            <span className="image-recipe-label">{t('imageRecipe.lighting.global')}</span>
            <span className="image-recipe-toggle">
              <span>{t('imageRecipe.lighting.smartMode')}</span>
              <Switch size="small" checked={options.smartMode} onChange={(checked) => update({ smartMode: checked })} />
            </span>
          </div>

          <div className="image-lighting-row">
            <span className="image-recipe-label">{t('imageRecipe.lighting.brightness')}</span>
            <div className="image-lighting-slider">
              <Slider
                aria-label={t('imageRecipe.lighting.brightness')}
                min={0}
                max={100}
                value={options.brightness}
                tooltip={{ formatter: (value) => `${value}%` }}
                onChange={(value) => update({ brightness: value })}
              />
            </div>
            <span className="image-recipe-value-chip">
              <IconSymbol name="sun" />
              {options.brightness}%
            </span>
          </div>

          <div className="image-recipe-field-row">
            <span className="image-recipe-label">{t('imageRecipe.lighting.color')}</span>
            <div className="image-lighting-color-row">
              <ColorPicker
                size="small"
                value={options.lightColor}
                onChange={(color) => update({ lightColor: color.toHexString() })}
              />
              <span className="image-recipe-toggle">
                <span>{t('imageRecipe.lighting.rim')}</span>
                <Switch size="small" checked={options.rimLight} onChange={(checked) => update({ rimLight: checked })} />
              </span>
            </div>
          </div>

          <div className="image-recipe-field">
            <span className="image-recipe-label">{t('imageRecipe.lighting.keyLight')}</span>
            <div className="image-lighting-positions">
              {LIGHT_POSITIONS.map((position) => (
                <button
                  key={position.id}
                  type="button"
                  className="image-recipe-choice"
                  aria-pressed={position.azimuth === options.azimuth && position.elevation === options.elevation}
                  onClick={() => update({ azimuth: position.azimuth, elevation: position.elevation })}
                >
                  {position.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="image-lighting-note">
        <span className="image-recipe-label">{t('imageRecipe.lighting.smartMode')}</span>
        <Input.TextArea
          value={options.smartDescription}
          onChange={(event) => update({ smartDescription: event.target.value })}
          placeholder={t('imageRecipe.lighting.descriptionPlaceholder')}
          disabled={!options.smartMode}
          autoSize={{ minRows: 2, maxRows: 4 }}
        />
        <span className="image-recipe-label">{t('imageRecipe.lighting.presets')}</span>
        <div className="image-lighting-presets">
          {LIGHTING_STYLE_PRESETS.map((preset) => (
            <LightingPresetThumb
              key={preset.id}
              preset={preset}
              active={options.stylePresetId === preset.id}
              onSelect={() => update({ stylePresetId: options.stylePresetId === preset.id ? '' : preset.id })}
            />
          ))}
        </div>
      </div>

      <footer className="image-recipe-foot">
        <Button size="small" onClick={() => setOptions(normalizeLightingOptions(DEFAULT_LIGHTING_OPTIONS))}>
          {t('imageRecipe.lighting.reset')}
        </Button>
        <span className="image-recipe-foot-spacer" />
        <Button size="small" onClick={copyPrompt}>{t('imageRecipe.lighting.copyPrompt')}</Button>
        <Button size="small" onClick={openTemplate}>{t('imageRecipe.lighting.editPrompt')}</Button>
        <Button size="small" type="primary" onClick={() => onConfirm(options)}>
          {t('imageRecipe.lighting.generate')}
        </Button>
      </footer>

      <Modal
        open={templateOpen}
        title={t('imageRecipe.lighting.template.title')}
        onCancel={() => setTemplateOpen(false)}
        width={620}
        footer={[
          <Button key="reset" onClick={() => setTemplateDraft(DEFAULT_LIGHTING_PROMPT_TEMPLATE)}>
            {t('imageRecipe.lighting.template.reset')}
          </Button>,
          <Button key="cancel" onClick={() => setTemplateOpen(false)}>{t('imageRecipe.common.cancel')}</Button>,
          <Button key="save" type="primary" onClick={() => {
            update({ promptTemplate: templateDraft.trim() || DEFAULT_LIGHTING_PROMPT_TEMPLATE });
            setTemplateOpen(false);
          }}>{t('imageRecipe.lighting.template.save')}</Button>,
        ]}
      >
        <p className="image-lighting-template-description">{t('imageRecipe.lighting.template.description')}</p>
        <span className="image-recipe-label">{t('imageRecipe.lighting.template.placeholders')}</span>
        <div className="image-lighting-placeholders">
          {LIGHTING_PROMPT_PLACEHOLDERS.map((placeholder) => (
            <code key={placeholder}>{`{{${placeholder}}}`}</code>
          ))}
        </div>
        <Input.TextArea
          value={templateDraft}
          onChange={(event) => setTemplateDraft(event.target.value)}
          autoSize={{ minRows: 8, maxRows: 14 }}
          spellCheck={false}
        />
        <span className="image-recipe-label">{t('imageRecipe.lighting.template.default')}</span>
        <pre className="image-lighting-template-default">{DEFAULT_LIGHTING_PROMPT_TEMPLATE}</pre>
      </Modal>
    </ImageRecipePanelFrame>
  );
}
