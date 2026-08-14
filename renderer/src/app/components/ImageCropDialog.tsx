import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { desktopApi } from "../../services/desktopApi.js";
import { IconSymbol } from "./IconSymbol";

export type ImageCropRect = { x: number; y: number; width: number; height: number };
type CropHandle = "move" | "nw" | "ne" | "sw" | "se";
type CropRatio = { id: string; label: string; value: number | null };

const cropRatios: CropRatio[] = [
  { id: "free", label: "自由", value: null },
  { id: "1:1", label: "1:1", value: 1 },
  { id: "4:3", label: "4:3", value: 4 / 3 },
  { id: "16:9", label: "16:9", value: 16 / 9 },
  { id: "9:16", label: "9:16", value: 9 / 16 },
];

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function ImageCropDialog({ source, title, onCancel, onConfirm }: {
  source: string;
  title: string;
  onCancel: () => void;
  onConfirm: (rect: ImageCropRect) => void | Promise<void>;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const interactionRef = useRef<{
    handle: CropHandle;
    clientX: number;
    clientY: number;
    rect: ImageCropRect;
  } | null>(null);
  const [preview, setPreview] = useState("");
  const [imageSize, setImageSize] = useState({ width: 1, height: 1 });
  const [crop, setCrop] = useState<ImageCropRect>({ x: 0.08, y: 0.08, width: 0.84, height: 0.84 });
  const [ratio, setRatio] = useState<CropRatio>(cropRatios[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    let url = "";
    void desktopApi.file.readImagePreview(source, 2048)
      .then((buffer: ArrayBuffer) => {
        if (!active) return;
        if (!buffer?.byteLength) throw new Error("图片预览为空");
        url = URL.createObjectURL(new Blob([buffer], { type: "image/jpeg" }));
        setPreview(url);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "无法读取图片");
      });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [source]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel, saving]);

  function chooseRatio(next: CropRatio) {
    setRatio(next);
    if (!next.value) return;
    const normalizedRatio = next.value * imageSize.height / imageSize.width;
    let width = 0.86;
    let height = width / normalizedRatio;
    if (height > 0.86) {
      height = 0.86;
      width = height * normalizedRatio;
    }
    setCrop({ x: (1 - width) / 2, y: (1 - height) / 2, width, height });
  }

  function startInteraction(event: ReactPointerEvent, handle: CropHandle) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    interactionRef.current = { handle, clientX: event.clientX, clientY: event.clientY, rect: crop };
  }

  function moveInteraction(event: ReactPointerEvent) {
    const interaction = interactionRef.current;
    const bounds = frameRef.current?.getBoundingClientRect();
    if (!interaction || !bounds?.width || !bounds.height) return;
    const dx = (event.clientX - interaction.clientX) / bounds.width;
    const dy = (event.clientY - interaction.clientY) / bounds.height;
    const original = interaction.rect;
    if (interaction.handle === "move") {
      setCrop({
        ...original,
        x: clamp(original.x + dx, 0, 1 - original.width),
        y: clamp(original.y + dy, 0, 1 - original.height),
      });
      return;
    }
    const leftHandle = interaction.handle === "nw" || interaction.handle === "sw";
    const topHandle = interaction.handle === "nw" || interaction.handle === "ne";
    const anchorX = leftHandle ? original.x + original.width : original.x;
    const anchorY = topHandle ? original.y + original.height : original.y;
    let movingX = clamp((leftHandle ? original.x : original.x + original.width) + dx, 0, 1);
    let movingY = clamp((topHandle ? original.y : original.y + original.height) + dy, 0, 1);
    if (ratio.value) {
      const normalizedRatio = ratio.value * imageSize.height / imageSize.width;
      let width = Math.max(0.04, Math.abs(movingX - anchorX));
      let height = Math.max(0.04, Math.abs(movingY - anchorY));
      if (width / height > normalizedRatio) height = width / normalizedRatio;
      else width = height * normalizedRatio;
      width = Math.min(width, leftHandle ? anchorX : 1 - anchorX);
      height = Math.min(height, topHandle ? anchorY : 1 - anchorY);
      if (width / height > normalizedRatio) width = height * normalizedRatio;
      else height = width / normalizedRatio;
      movingX = anchorX + (leftHandle ? -width : width);
      movingY = anchorY + (topHandle ? -height : height);
    }
    const x = Math.min(anchorX, movingX);
    const y = Math.min(anchorY, movingY);
    setCrop({ x, y, width: Math.max(0.04, Math.abs(movingX - anchorX)), height: Math.max(0.04, Math.abs(movingY - anchorY)) });
  }

  async function submit() {
    setSaving(true);
    setError("");
    try {
      await onConfirm(crop);
      onCancel();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "图片裁剪失败");
      setSaving(false);
    }
  }

  return (
    <div className="image-crop-backdrop" role="dialog" aria-modal="true" aria-label="裁剪图片">
      <section className="image-crop-dialog">
        <header>
          <div><IconSymbol name="crop" /><span><strong>裁剪图片</strong><small>{title}</small></span></div>
          <button type="button" title="关闭" onClick={onCancel}><IconSymbol name="x" /></button>
        </header>
        <div className="image-crop-stage">
          {preview ? (
            <div
              ref={frameRef}
              className="image-crop-frame"
              style={{ aspectRatio: `${imageSize.width} / ${imageSize.height}` }}
              onPointerMove={moveInteraction}
              onPointerUp={() => { interactionRef.current = null; }}
              onPointerCancel={() => { interactionRef.current = null; }}
            >
              <img src={preview} alt="裁剪预览" draggable={false} onLoad={(event) => setImageSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />
              <div className="image-crop-shade image-crop-shade--top" style={{ height: `${crop.y * 100}%` }} />
              <div className="image-crop-shade image-crop-shade--left" style={{ top: `${crop.y * 100}%`, width: `${crop.x * 100}%`, height: `${crop.height * 100}%` }} />
              <div className="image-crop-shade image-crop-shade--right" style={{ top: `${crop.y * 100}%`, left: `${(crop.x + crop.width) * 100}%`, height: `${crop.height * 100}%` }} />
              <div className="image-crop-shade image-crop-shade--bottom" style={{ top: `${(crop.y + crop.height) * 100}%` }} />
              <div className="image-crop-selection" style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.width * 100}%`, height: `${crop.height * 100}%` }} onPointerDown={(event) => startInteraction(event, "move")}>
                {(["nw", "ne", "sw", "se"] as CropHandle[]).map((handle) => <i key={handle} className={`image-crop-handle image-crop-handle--${handle}`} onPointerDown={(event) => startInteraction(event, handle)} />)}
              </div>
            </div>
          ) : <span className="image-crop-loading">{error || "正在读取图片…"}</span>}
        </div>
        <footer>
          <div className="image-crop-ratios">
            {cropRatios.map((item) => <button key={item.id} type="button" className={ratio.id === item.id ? "active" : ""} onClick={() => chooseRatio(item)}>{item.label}</button>)}
          </div>
          <span className="image-crop-size">选区 {Math.round(crop.width * 100)}% × {Math.round(crop.height * 100)}%</span>
          {error && preview && <span className="image-crop-error">{error}</span>}
          <div className="image-crop-actions">
            <button type="button" onClick={onCancel}>取消</button>
            <button className="primary" type="button" disabled={!preview || saving} onClick={() => void submit()}>{saving ? "正在裁剪…" : "完成裁剪"}</button>
          </div>
        </footer>
      </section>
    </div>
  );
}
