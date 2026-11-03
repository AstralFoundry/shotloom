import { t } from '../i18n/index.ts';
/**
 * 图片水印的唯一绘制实现：单体定位与平铺共用同一份文字样式，
 * 实时预览与最终导出共用同一套几何，避免"预览看到的"和"导出的"不是一回事。
 *
 * 这里的字号、边距、间距都以源图像素为单位；预览侧把 displayWidth / sourceWidth
 * 作为倍率传进来，所以两处只需要一份参数。
 */

export type WatermarkMode = "single" | "tile";

export type WatermarkPosition = "tl" | "tc" | "tr" | "ml" | "mc" | "mr" | "bl" | "bc" | "br";

export interface WatermarkSettings {
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  color: string;
  opacity: number;
  rotation: number;
  mode: WatermarkMode;
  position: WatermarkPosition;
  spacing: number;
  padding: number;
  shadow: boolean;
  shadowBlur: number;
}

export const WATERMARK_POSITIONS: WatermarkPosition[] = [
  "tl", "tc", "tr", "ml", "mc", "mr", "bl", "bc", "br",
];

export const WATERMARK_FONT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", label: "Inter" },
  { value: "'Helvetica Neue', Helvetica, Arial, sans-serif", label: "Helvetica" },
  { value: "'Times New Roman', serif", label: "Times New Roman" },
  { value: "Georgia, serif", label: "Georgia" },
  { value: "'Courier New', monospace", label: "Courier New" },
  { value: "'PingFang SC', 'Microsoft YaHei', sans-serif", label: t("watermark.font.sans") },
  { value: "'STSong', 'SimSun', serif", label: t("watermark.font.song") },
  { value: "'STKaiti', 'KaiTi', serif", label: t("watermark.font.kai") },
];

export const WATERMARK_WEIGHT_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 300, label: t("watermark.weight.light") },
  { value: 400, label: t("watermark.weight.regular") },
  { value: 600, label: t("watermark.weight.semibold") },
  { value: 800, label: t("watermark.weight.heavy") },
];

export const WATERMARK_FONT_SIZE_OPTIONS = [10, 12, 14, 16, 18, 20, 24, 32, 36, 48, 64, 72, 96, 120];

export function defaultWatermarkSettings(): WatermarkSettings {
  return {
    text: "© Shotloom",
    fontFamily: WATERMARK_FONT_OPTIONS[0]!.value,
    fontSize: 48,
    fontWeight: 400,
    color: "#000000",
    opacity: 100,
    rotation: 0,
    mode: "tile",
    position: "br",
    spacing: 120,
    padding: 30,
    shadow: false,
    shadowBlur: 4,
  };
}

function singleAnchor(width: number, height: number, settings: WatermarkSettings) {
  const top = settings.padding + settings.fontSize / 2;
  const middle = height / 2;
  const bottom = height - settings.padding - settings.fontSize / 2;
  const left = settings.padding;
  const center = width / 2;
  const right = width - settings.padding;
  const anchors: Record<WatermarkPosition, { x: number; y: number; align: CanvasTextAlign }> = {
    tl: { x: left, y: top, align: "left" },
    tc: { x: center, y: top, align: "center" },
    tr: { x: right, y: top, align: "right" },
    ml: { x: left, y: middle, align: "left" },
    mc: { x: center, y: middle, align: "center" },
    mr: { x: right, y: middle, align: "right" },
    bl: { x: left, y: bottom, align: "left" },
    bc: { x: center, y: bottom, align: "center" },
    br: { x: right, y: bottom, align: "right" },
  };
  return anchors[settings.position] || anchors.br;
}

export function drawWatermark(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  settings: WatermarkSettings,
) {
  const text = settings.text.trim();
  if (!text) return;
  context.save();
  context.font = `${settings.fontWeight} ${settings.fontSize}px ${settings.fontFamily}`;
  context.fillStyle = settings.color;
  context.globalAlpha = Math.max(0, Math.min(1, settings.opacity / 100));
  context.textBaseline = "middle";
  if (settings.shadow) {
    context.shadowColor = "rgba(0, 0, 0, 0.6)";
    context.shadowBlur = settings.shadowBlur;
    context.shadowOffsetX = settings.shadowBlur / 4;
    context.shadowOffsetY = settings.shadowBlur / 4;
  }
  const lines = settings.text.split("\n");
  const lineHeight = settings.fontSize * 1.3;
  const rotation = (settings.rotation * Math.PI) / 180;

  if (settings.mode === "single") {
    const { x, y, align } = singleAnchor(width, height, settings);
    const startY = y - ((lines.length - 1) * lineHeight) / 2;
    context.textAlign = align;
    context.translate(x, y);
    context.rotate(rotation);
    context.translate(-x, -y);
    lines.forEach((line, index) => {
      context.fillText(line, x, startY + index * lineHeight);
    });
  } else {
    context.textAlign = "center";
    const widest = Math.max(...lines.map((line) => context.measureText(line).width));
    const blockHeight = lines.length * lineHeight;
    const stepX = Math.max(1, widest + settings.spacing);
    const stepY = Math.max(1, blockHeight + settings.spacing);
    const centerX = width / 2;
    const centerY = height / 2;
    const diagonal = Math.hypot(width, height);
    context.translate(centerX, centerY);
    context.rotate(rotation);
    context.translate(-centerX, -centerY);
    for (let y = -diagonal; y < height + diagonal; y += stepY) {
      for (let x = -diagonal; x < width + diagonal; x += stepX) {
        lines.forEach((line, index) => {
          context.fillText(line, x, y + index * lineHeight);
        });
      }
    }
  }
  context.restore();
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(t('watermark.imageLoadFailed')));
    image.src = src;
  });
}

/** 导出按源图像素绘制，预览按显示尺寸缩放同一份参数，所以两边几何完全一致。 */
export function scaledWatermarkSettings(
  settings: WatermarkSettings,
  scale: number,
): WatermarkSettings {
  return {
    ...settings,
    fontSize: settings.fontSize * scale,
    spacing: settings.spacing * scale,
    padding: settings.padding * scale,
    shadowBlur: settings.shadowBlur * scale,
  };
}

export async function renderWatermarkedBlob(src: string, settings: WatermarkSettings): Promise<Blob> {
  const image = await loadImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error(t("watermark.canvasRequired"));
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  drawWatermark(context, canvas.width, canvas.height, settings);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error(t('watermark.exportFailed')));
    }, "image/png");
  });
}
