import { t } from '@/i18n';
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { IconSymbol } from "./IconSymbol";
import {
  WATERMARK_FONT_OPTIONS,
  WATERMARK_FONT_SIZE_OPTIONS,
  WATERMARK_POSITIONS,
  WATERMARK_WEIGHT_OPTIONS,
  defaultWatermarkSettings,
  drawWatermark,
  renderWatermarkedBlob,
  scaledWatermarkSettings,
  type WatermarkMode,
  type WatermarkSettings,
} from "../../utils/watermarkRender.ts";

const PANEL_WIDTH = 320;
const PANEL_MAX_HEIGHT = 480;
const GAP = 12;

type Rect = { left: number; top: number; width: number; height: number };

/**
 * 水印编辑器挂在画布浮层根节点上，而不是节点内部：面板比节点高得多，
 * 留在节点里会被媒体卡的 overflow 裁掉。预览画布则精确覆盖节点图片的屏幕矩形，
 * 因此两者的定位都从同一个 anchorRect 推出来。
 */
function panelPlacement(rect: Rect, host: { width: number; height: number }) {
  const width = Math.min(PANEL_WIDTH, Math.max(0, host.width - GAP * 2));
  const height = Math.max(0, Math.min(PANEL_MAX_HEIGHT, host.height - GAP * 2));
  const right = rect.left + rect.width + GAP;
  const left = right + width <= host.width - GAP ? right : rect.left - GAP - width;
  const clampedLeft = Math.max(GAP, Math.min(host.width - width - GAP, left));
  const top = Math.max(GAP, Math.min(host.height - height - GAP, rect.top));
  return { left: clampedLeft, top, width, height };
}

function SliderField({ label, value, min, max, suffix, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="canvas-image-watermark-field">
      <span className="canvas-image-watermark-field-head">
        <span>{label}</span>
        <span className="canvas-image-watermark-value">{value}{suffix || ""}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </label>
  );
}

export function ImageWatermarkEditor({
  imageUrl,
  imageWidth,
  imageHeight,
  semanticZoom = 1,
  root,
  anchorRef,
  onCancel,
  onApply,
}: {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  semanticZoom?: number;
  root: HTMLElement | null;
  anchorRef: RefObject<HTMLDivElement | null>;
  onCancel: () => void;
  onApply: (blob: Blob) => void | Promise<void>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [settings, setSettings] = useState<WatermarkSettings>(defaultWatermarkSettings);
  const [rect, setRect] = useState<Rect>({ left: 0, top: 0, width: imageWidth, height: imageHeight });
  const [hostSize, setHostSize] = useState({ width: 0, height: 0 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const anchor = anchorRef.current;
    const host = root;
    if (!anchor || !host) return;
    const update = () => {
      const anchorRect = anchor.getBoundingClientRect();
      const hostRect = host.getBoundingClientRect();
      setRect({
        left: anchorRect.left - hostRect.left,
        top: anchorRect.top - hostRect.top,
        width: anchorRect.width || imageWidth,
        height: anchorRect.height || imageHeight,
      });
      setHostSize({ width: hostRect.width, height: hostRect.height });
    };
    update();
    // 节点拖动不触发 resize/scroll，只能逐帧跟随画布视口。
    let frame = requestAnimationFrame(function sync() {
      update();
      frame = requestAnimationFrame(sync);
    });
    return () => cancelAnimationFrame(frame);
  }, [anchorRef, imageHeight, imageWidth, root]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) {
        event.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [onCancel, saving]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !rect.width || !rect.height || !imageWidth) return;
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(rect.height * ratio));
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.scale(ratio, ratio);
    drawWatermark(
      context,
      rect.width,
      rect.height,
      scaledWatermarkSettings(settings, rect.width / imageWidth),
    );
  }, [imageWidth, rect.height, rect.width, settings]);

  const update = useCallback((patch: Partial<WatermarkSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  async function submit() {
    if (!settings.text.trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      const blob = await renderWatermarkedBlob(imageUrl, settings);
      await onApply(blob);
      // 落盘失败时宿主不会关掉面板，这里复位，否则按钮会永远停在"处理中"。
      setSaving(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("ui.ImageWatermarkEditor.text.c6271fbb"));
      setSaving(false);
    }
  }

  if (!root) return null;
  const placement = panelPlacement(rect, hostSize);
  const single = settings.mode === "single";

  return createPortal(
    <>
      <canvas
        ref={canvasRef}
        className="canvas-image-watermark-preview nodrag nopan"
        style={{
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          borderRadius: `calc(var(--canvas-node-radius) * ${semanticZoom})`,
        }}
        aria-hidden="true"
      />
      <div
        className="canvas-image-watermark-panel nodrag nopan nowheel"
        style={{ left: placement.left, top: placement.top, width: placement.width, height: placement.height }}
        role="dialog"
        aria-label={t("ui.ImageWatermarkEditor.arialabel.e46824ff")}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="canvas-image-watermark-head">
          <strong>{t("ui.ImageWatermarkEditor.arialabel.e46824ff")}</strong>
          <button type="button" aria-label={t("ui.CanvasToolbarCustomizeDialog.arialabel.6c14bd7f")} disabled={saving} onClick={onCancel}>
            <IconSymbol name="x" />
          </button>
        </header>
        <div className="canvas-image-watermark-body">
          <label className="canvas-image-watermark-field">
            <span className="canvas-image-watermark-field-head"><span>{t("ui.ImageWatermarkEditor.text.ca25db13")}</span></span>
            <textarea
              rows={2}
              value={settings.text}
              placeholder={t("ui.ImageWatermarkEditor.placeholder.cf7407af")}
              onChange={(event) => update({ text: event.currentTarget.value })}
            />
          </label>

          <div className="canvas-image-watermark-row">
            <select
              aria-label={t("ui.ImageWatermarkEditor.arialabel.b50d4d83")}
              value={settings.fontFamily}
              onChange={(event) => update({ fontFamily: event.currentTarget.value })}
            >
              {WATERMARK_FONT_OPTIONS.map((option) => (
                <option key={option.label} value={option.value}>{option.label}</option>
              ))}
            </select>
            <select
              aria-label={t("ui.ImageWatermarkEditor.arialabel.b361526f")}
              value={String(settings.fontWeight)}
              onChange={(event) => update({ fontWeight: Number(event.currentTarget.value) })}
            >
              {WATERMARK_WEIGHT_OPTIONS.map((option) => (
                <option key={option.value} value={String(option.value)}>{option.label}</option>
              ))}
            </select>
            <select
              aria-label={t("ui.ImageWatermarkEditor.arialabel.576ccdb1")}
              value={String(settings.fontSize)}
              onChange={(event) => update({ fontSize: Number(event.currentTarget.value) })}
            >
              {WATERMARK_FONT_SIZE_OPTIONS.map((size) => (
                <option key={size} value={String(size)}>{size}px</option>
              ))}
            </select>
          </div>

          <div className="canvas-image-watermark-row">
            <label className="canvas-image-watermark-color">
              <span>{t("ui.ImageWatermarkEditor.text.8ef48860")}</span>
              <input
                type="color"
                value={settings.color}
                onChange={(event) => update({ color: event.currentTarget.value })}
              />
            </label>
            <SliderField
              label={t("ui.ImageWatermarkEditor.label.61b101b5")}
              value={settings.opacity}
              min={0}
              max={100}
              suffix="%"
              onChange={(opacity) => update({ opacity })}
            />
          </div>

          <SliderField
            label={t("ui.ImageWatermarkEditor.label.a69e51e5")}
            value={settings.rotation}
            min={-180}
            max={180}
            suffix="°"
            onChange={(rotation) => update({ rotation })}
          />

          <div className="canvas-image-watermark-field">
            <span className="canvas-image-watermark-field-head"><span>{t("ui.ImageWatermarkEditor.text.596ba37b")}</span></span>
            <div className="canvas-image-watermark-segments" role="group" aria-label={t("ui.ImageWatermarkEditor.text.596ba37b")}>
              {(["single", "tile"] as WatermarkMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={settings.mode === mode}
                  onClick={() => update({ mode })}
                >
                  {mode === "single" ? t("ui.ImageWatermarkEditor.text.a1fb8e7c") : t("ui.ImageWatermarkEditor.text.30c39af4")}
                </button>
              ))}
            </div>
          </div>

          {single ? (
            <>
              <div className="canvas-image-watermark-positions" role="group" aria-label={t("ui.ImageWatermarkEditor.arialabel.da8a9b1a")}>
                {WATERMARK_POSITIONS.map((position) => (
                  <button
                    key={position}
                    type="button"
                    aria-label={t("ui.ImageWatermarkEditor.text.0be1783a", { value0: position })}
                    aria-pressed={settings.position === position}
                    onClick={() => update({ position })}
                  >
                    <span />
                  </button>
                ))}
              </div>
              <SliderField
                label={t("ui.ImageWatermarkEditor.label.0edb3b78")}
                value={settings.padding}
                min={0}
                max={200}
                suffix="px"
                onChange={(padding) => update({ padding })}
              />
            </>
          ) : (
            <SliderField
              label={t("ui.ImageWatermarkEditor.label.66cb5fb6")}
              value={settings.spacing}
              min={40}
              max={400}
              suffix="px"
              onChange={(spacing) => update({ spacing })}
            />
          )}

          <div className="canvas-image-watermark-field">
            <span className="canvas-image-watermark-field-head"><span>{t("ui.ImageWatermarkEditor.text.7cfeac8f")}</span></span>
            <div className="canvas-image-watermark-segments" role="group" aria-label={t("ui.ImageWatermarkEditor.text.7cfeac8f")}>
              {[false, true].map((shadow) => (
                <button
                  key={String(shadow)}
                  type="button"
                  aria-pressed={settings.shadow === shadow}
                  onClick={() => update({ shadow })}
                >
                  {shadow ? t("ui.ImageWatermarkEditor.text.b4217093") : t("ui.ImageWatermarkEditor.text.a3332f1c")}
                </button>
              ))}
            </div>
          </div>
          {settings.shadow && (
            <SliderField
              label={t("ui.ImageWatermarkEditor.label.efae679c")}
              value={settings.shadowBlur}
              min={0}
              max={20}
              onChange={(shadowBlur) => update({ shadowBlur })}
            />
          )}
          {error && <p className="canvas-image-watermark-error" role="alert">{error}</p>}
        </div>
        <footer className="canvas-image-watermark-foot">
          <button type="button" className="button ghost" disabled={saving} onClick={onCancel}>{t("ui.ImageWatermarkEditor.text.4d0b4688")}</button>
          <button
            type="button"
            className="button primary"
            disabled={saving || !settings.text.trim()}
            onClick={() => void submit()}
          >
            {saving ? t("ui.ImageWatermarkEditor.text.1cac8ac7") : t("ui.ImageWatermarkEditor.text.4562024d")}
          </button>
        </footer>
      </div>
    </>,
    root,
  );
}
