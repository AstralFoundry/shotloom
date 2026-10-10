import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { type ReactFlowState, useStore } from "@xyflow/react";
import { inlineCropToolbarPosition } from "../../utils/inlineCropToolbar.mjs";

export type ImageCropRect = { x: number; y: number; width: number; height: number };
type CropHandle = "move" | "nw" | "ne" | "sw" | "se";
const ratios = [
  { label: "自由", value: null },
  { label: "1:1", value: 1 },
  { label: "4:3", value: 4 / 3 },
  { label: "16:9", value: 16 / 9 },
  { label: "9:16", value: 9 / 16 },
];
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function ImageCropEditor({ nodeId, root, imageWidth, imageHeight, onCancel, onConfirm, onSplit }: {
  nodeId: string;
  root: HTMLElement | null;
  imageWidth: number;
  imageHeight: number;
  onCancel: () => void;
  onConfirm: (rect: ImageCropRect) => void | Promise<void>;
  onSplit: (rows: number, cols: number, selected: number[], rect: ImageCropRect) => void | Promise<void>;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const interaction = useRef<{ handle: CropHandle; x: number; y: number; rect: ImageCropRect } | null>(null);
  const draggedCell = useRef(false);
  const [mode, setMode] = useState<"crop" | "grid">("crop");
  const [rect, setRect] = useState<ImageCropRect>({ x: .08, y: .08, width: .84, height: .84 });
  const [ratio, setRatio] = useState<number | null>(null);
  const [rows, setRows] = useState(2);
  const [cols, setCols] = useState(2);
  const [selected, setSelected] = useState([0, 1, 2, 3]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const placement = useStore((state: ReactFlowState) => {
    const node = state.nodeLookup.get(nodeId);
    const position = node?.internals.positionAbsolute;
    return inlineCropToolbarPosition({
      node: { x: Number(position?.x || 0), y: Number(position?.y || 0), width: Number(node?.measured.width || node?.width || 0), height: Number(node?.measured.height || node?.height || 0) },
      viewport: { x: state.transform[0], y: state.transform[1], zoom: state.transform[2] },
      canvas: { width: root?.clientWidth || 440, height: root?.clientHeight || 800 },
      mode,
    });
  }, (a, b) => a.left === b.left && a.top === b.top && a.width === b.width && a.visible === b.visible);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) { event.stopPropagation(); onCancel(); }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [onCancel, saving]);

  function start(event: ReactPointerEvent, handle: CropHandle) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    draggedCell.current = false;
    interaction.current = { handle, x: event.clientX, y: event.clientY, rect };
  }
  function move(event: ReactPointerEvent) {
    const drag = interaction.current;
    const bounds = frameRef.current?.getBoundingClientRect();
    if (!drag || !bounds?.width || !bounds.height) return;
    const dx = (event.clientX - drag.x) / bounds.width;
    const dy = (event.clientY - drag.y) / bounds.height;
    if (Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y) > 4) draggedCell.current = true;
    if (drag.handle === "move") {
      setRect({ ...drag.rect, x: clamp(drag.rect.x + dx, 0, 1 - drag.rect.width), y: clamp(drag.rect.y + dy, 0, 1 - drag.rect.height) });
      return;
    }
    const left = drag.handle === "nw" || drag.handle === "sw";
    const top = drag.handle === "nw" || drag.handle === "ne";
    const anchorX = left ? drag.rect.x + drag.rect.width : drag.rect.x;
    const anchorY = top ? drag.rect.y + drag.rect.height : drag.rect.y;
    let movingX = clamp((left ? drag.rect.x : drag.rect.x + drag.rect.width) + dx, 0, 1);
    let movingY = clamp((top ? drag.rect.y : drag.rect.y + drag.rect.height) + dy, 0, 1);
    if (mode === "crop" && ratio && imageWidth > 0 && imageHeight > 0) {
      const normalized = ratio * imageHeight / imageWidth;
      let width = Math.abs(movingX - anchorX);
      let height = Math.abs(movingY - anchorY);
      if (width / Math.max(height, .001) > normalized) height = width / normalized;
      else width = height * normalized;
      width = Math.min(width, left ? anchorX : 1 - anchorX);
      height = Math.min(height, top ? anchorY : 1 - anchorY);
      movingX = anchorX + (left ? -width : width);
      movingY = anchorY + (top ? -height : height);
    }
    const width = Math.max(.04, Math.abs(movingX - anchorX));
    const height = Math.max(.04, Math.abs(movingY - anchorY));
    setRect({ x: clamp(Math.min(anchorX, movingX), 0, 1 - width), y: clamp(Math.min(anchorY, movingY), 0, 1 - height), width, height });
  }
  function chooseRatio(value: number | null) {
    setRatio(value);
    if (!value || !imageWidth || !imageHeight) return;
    const normalized = value * imageHeight / imageWidth;
    const width = Math.min(.86, .86 * normalized);
    const height = width / normalized;
    setRect({ x: (1 - width) / 2, y: (1 - height) / 2, width, height });
  }
  async function submit() {
    setSaving(true);
    setError("");
    try {
      if (mode === "grid") await onSplit(rows, cols, selected, rect);
      else await onConfirm(rect);
      onCancel();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "图片处理失败");
      setSaving(false);
    }
  }
  const handles = (["nw", "ne", "sw", "se"] as CropHandle[]).map((handle) =>
    <i key={handle} className={`canvas-image-crop-handle is-${handle}`} onPointerDown={(event) => start(event, handle)} />);
  return <>
    <div ref={frameRef} className="canvas-image-crop-layer nodrag nopan nowheel"
      onPointerDown={(event) => event.stopPropagation()}
      onPointerMove={move}
      onPointerUp={() => { interaction.current = null; }}
      onPointerCancel={() => { interaction.current = null; }}>
      <div className="canvas-image-crop-shade is-top" style={{ height: `${rect.y * 100}%` }} />
      <div className="canvas-image-crop-shade is-left" style={{ top: `${rect.y * 100}%`, width: `${rect.x * 100}%`, height: `${rect.height * 100}%` }} />
      <div className="canvas-image-crop-shade is-right" style={{ top: `${rect.y * 100}%`, left: `${(rect.x + rect.width) * 100}%`, height: `${rect.height * 100}%` }} />
      <div className="canvas-image-crop-shade is-bottom" style={{ top: `${(rect.y + rect.height) * 100}%` }} />
      <div className="canvas-image-crop-selection" style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` }} onPointerDown={mode === "crop" ? (event) => start(event, "move") : undefined}>
        {mode === "grid" && <div className="canvas-image-crop-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>
          {Array.from({ length: rows * cols }, (_, index) => <button key={index} type="button" aria-label={`第 ${Math.floor(index / cols) + 1} 行第 ${index % cols + 1} 列`} aria-pressed={selected.includes(index)} className={selected.includes(index) ? "is-selected" : ""} onPointerDown={(event) => start(event, "move")} onClick={(event) => {
            event.stopPropagation();
            if (draggedCell.current) { draggedCell.current = false; return; }
            setSelected((current) => current.includes(index) ? current.filter((item) => item !== index) : [...current, index]);
          }}>{index + 1}</button>)}
        </div>}
        {handles}
      </div>
    </div>
    {root && placement.visible && createPortal(<div className="canvas-image-crop-toolbar nodrag nopan nowheel" style={{ left: placement.left, top: placement.top, width: placement.width }} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
      <button type="button" title="取消裁剪" onClick={onCancel}>×</button>
      <span className="canvas-image-crop-divider" />
      <select aria-label="处理方式" value={mode} onChange={(event) => setMode(event.target.value as "crop" | "grid")}> <option value="crop">裁剪</option><option value="grid">宫格</option></select>
      {mode === "crop" ? <select aria-label="裁剪比例" value={ratio === null ? "free" : String(ratio)} onChange={(event) => chooseRatio(event.target.value === "free" ? null : Number(event.target.value))}>{ratios.map((item) => <option key={item.label} value={item.value === null ? "free" : String(item.value)}>{item.label}</option>)}</select> : <>
        <select aria-label="宫格行数" value={rows} onChange={(event) => { const value = Number(event.target.value); setRows(value); setSelected(Array.from({ length: value * cols }, (_, index) => index)); }}>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value} 行</option>)}</select>
        <select aria-label="宫格列数" value={cols} onChange={(event) => { const value = Number(event.target.value); setCols(value); setSelected(Array.from({ length: rows * value }, (_, index) => index)); }}>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value} 列</option>)}</select>
      </>}
      <button className="canvas-image-crop-confirm" type="button" disabled={saving || (mode === "grid" && !selected.length)} title={mode === "grid" ? `创建 ${selected.length} 个图片节点` : "确认裁剪"} onClick={() => void submit()}>{saving ? "…" : "↑"}</button>
      {error && <span className="canvas-image-crop-error" role="alert">{error}</span>}
    </div>, root)}
  </>;
}
