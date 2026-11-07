import { t } from '@/i18n';
import { Input, Select, Slider } from 'antd';
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';

import { defaultConfigForType, getModelInfo, getModelSchema } from '@/domain/catalog/ModelCatalog';
import { IconSymbol } from '../components/IconSymbol';
import { GenerationSettingsPanel } from './GenerationSettingsPanel';
import { toGenerationConfigParam, type GenerationNodeState } from './generationNodeState';
import type { WorkflowNodeActions } from './WorkflowCanvas';

const BOTTOMBAR_HEIGHT = 48;
const PANEL_GAP = 12;
/** 画布像素保持不透明，靠元素透明度让底图透出来；这样导出的蒙版才有完整 alpha。 */
const PAINT_COLOR = '#6d6cff';

type Rect = { left: number; top: number; width: number; height: number };
type DrawMode = 'paint' | 'erase';
type DrawState = { pointerId: number; erase: boolean; last: { x: number; y: number } | null };

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** 把绘制画布降采样后判断是否还有涂抹；避免每次移动都读全尺寸像素。 */
function canvasHasPaint(canvas: HTMLCanvasElement): boolean {
  const context = canvas.getContext('2d');
  if (!context) return false;
  const sample = document.createElement('canvas');
  sample.width = 32;
  sample.height = 32;
  const sampleContext = sample.getContext('2d');
  if (!sampleContext) return false;
  sampleContext.drawImage(canvas, 0, 0, sample.width, sample.height);
  const data = sampleContext.getImageData(0, 0, sample.width, sample.height).data;
  for (let index = 3; index < data.length; index += 4) {
    if ((data[index] ?? 0) > 8) return true;
  }
  return false;
}

/**
 * 白色底 + 透明涂抹区：与 Images Edit 的蒙版约定一致。
 * 用 destination-out 一次性挖空，比逐像素改 alpha 快，也不会在 4K 图上卡住。
 */
function buildMaskDataUrl(paintCanvas: HTMLCanvasElement): string {
  const mask = document.createElement('canvas');
  mask.width = paintCanvas.width;
  mask.height = paintCanvas.height;
  const context = mask.getContext('2d');
  if (!context) return paintCanvas.toDataURL('image/png');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, mask.width, mask.height);
  context.globalCompositeOperation = 'destination-out';
  context.drawImage(paintCanvas, 0, 0);
  return mask.toDataURL('image/png');
}

function IconButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`image-mask-icon-button${active ? ' is-active' : ''}`}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function ImageMaskEditor({
  imageWidth,
  imageHeight,
  semanticZoom = 1,
  root,
  anchorRef,
  models,
  initialModel,
  nodeId,
  actions,
  onCancel,
  onApply,
}: {
  imageWidth: number;
  imageHeight: number;
  semanticZoom?: number;
  root: HTMLElement | null;
  anchorRef: RefObject<HTMLDivElement | null>;
  models: string[];
  initialModel: string;
  nodeId: string;
  actions: WorkflowNodeActions;
  onCancel: () => void;
  onApply: (payload: {
    prompt: string;
    maskDataUrl: string;
    model: string;
    config: Record<string, unknown>;
  }) => Promise<boolean>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef<DrawState | null>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const [rect, setRect] = useState<Rect>({ left: 0, top: 0, width: imageWidth, height: imageHeight });
  const [host, setHost] = useState({ width: 0, height: 0 });
  const [mode, setMode] = useState<DrawMode>('paint');
  const [model, setModel] = useState(() => models.includes(initialModel) ? initialModel : (models[0] ?? ''));
  const [config, setConfig] = useState<Record<string, unknown>>(() => {
    const first = models.includes(initialModel) ? initialModel : (models[0] ?? '');
    return first ? defaultConfigForType('imageGeneration', first) : {};
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [brushSize, setBrushSize] = useState(() => Math.max(12, Math.round(Math.min(imageWidth, imageHeight) * 0.08)));
  const [prompt, setPrompt] = useState('');
  const [hasPaint, setHasPaint] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const brushMax = Math.max(24, Math.round(Math.min(imageWidth, imageHeight) / 3));
  const canEdit = Boolean(model) && models.length > 0;
  const params = useMemo(() => (
    model
      ? getModelSchema('imageGeneration', model).params
          .map(toGenerationConfigParam)
          .filter((param) => param.key !== 'prompt' && param.key !== 'model')
      : []
  ), [model]);
  const settingsState = { activeInputMode: undefined, inputModes: [], params, config } as unknown as GenerationNodeState;

  useEffect(() => {
    const anchor = anchorRef.current;
    const hostElement = root;
    if (!anchor || !hostElement) return;
    const update = () => {
      const anchorRect = anchor.getBoundingClientRect();
      const hostRect = hostElement.getBoundingClientRect();
      // 节点被手动拉成非图片比例时，预览是 contain 的；蒙版必须贴在可见图像上，
      // 否则涂抹位置会和实际像素错位。
      const scale = Math.min(anchorRect.width / imageWidth, anchorRect.height / imageHeight);
      const width = imageWidth * scale;
      const height = imageHeight * scale;
      setRect({
        left: anchorRect.left - hostRect.left + (anchorRect.width - width) / 2,
        top: anchorRect.top - hostRect.top + (anchorRect.height - height) / 2,
        width,
        height,
      });
      setHost({ width: hostRect.width, height: hostRect.height });
    };
    update();
    // 节点拖动时 canvas 和两条浮条都要跟着底图走，只能逐帧读锚点。
    let frame = requestAnimationFrame(function sync() {
      update();
      frame = requestAnimationFrame(sync);
    });
    return () => cancelAnimationFrame(frame);
  }, [anchorRef, imageWidth, imageHeight, root]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = Math.max(1, Math.round(imageWidth));
    canvas.height = Math.max(1, Math.round(imageHeight));
    setHasPaint(false);
    setBrushSize(Math.max(12, Math.round(Math.min(imageWidth, imageHeight) * 0.08)));
  }, [imageWidth, imageHeight, root]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      if (settingsOpen) setSettingsOpen(false);
      else onCancel();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onCancel, settingsOpen]);

  useEffect(() => {
    if (!settingsOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (settingsRef.current?.contains(target) || settingsButtonRef.current?.contains(target))) return;
      // Select / 下拉弹层挂在 body 上，点选项不算“点外面”，否则会先把设置面板关掉。
      if (target instanceof Element && target.closest('.ant-select-dropdown, .ant-picker-dropdown')) return;
      setSettingsOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [settingsOpen]);

  function pointFor(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget;
    const bounds = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * canvas.width,
      y: ((event.clientY - bounds.top) / Math.max(1, bounds.height)) * canvas.height,
    };
  }

  function stroke(from: { x: number; y: number }, to: { x: number; y: number }, erase: boolean) {
    const context = canvasRef.current?.getContext('2d');
    if (!context) return;
    context.save();
    context.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
    context.strokeStyle = PAINT_COLOR;
    context.fillStyle = PAINT_COLOR;
    context.lineWidth = brushSize;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
    if (Math.hypot(to.x - from.x, to.y - from.y) < 0.5) {
      context.beginPath();
      context.arc(to.x, to.y, brushSize / 2, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  function start(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!canEdit) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointFor(event);
    drawing.current = { pointerId: event.pointerId, erase: mode === 'erase', last: point };
    stroke(point, point, mode === 'erase');
    if (mode === 'paint') setHasPaint(true);
    setError('');
  }

  function move(event: ReactPointerEvent<HTMLCanvasElement>) {
    const state = drawing.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const point = pointFor(event);
    stroke(state.last ?? point, point, state.erase);
    state.last = point;
  }

  function end(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    drawing.current = null;
    const canvas = canvasRef.current;
    if (canvas) setHasPaint(canvasHasPaint(canvas));
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* 指针已经离开窗口 */ }
    }
  }

  function resetMask() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
    setHasPaint(false);
    setError('');
  }

  function changeModel(nextModel: string) {
    setModel(nextModel);
    setConfig(defaultConfigForType('imageGeneration', nextModel));
  }

  async function submit() {
    if (saving || !canEdit) return;
    const nextPrompt = prompt.trim();
    if (!nextPrompt) {
      setError(t('imageMask.error.prompt'));
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas || !hasPaint) {
      setError(t('imageMask.error.mask'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      const ok = await onApply({
        prompt: nextPrompt,
        maskDataUrl: buildMaskDataUrl(canvas),
        model,
        config,
      });
      if (!ok) setSaving(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('imageMask.error.saveMask'));
      setSaving(false);
    }
  }

  if (!root || !imageWidth || !imageHeight) return null;
  const topLeft = clamp(rect.left + rect.width / 2, 190, Math.max(190, host.width - 190));
  const topTop = Math.max(8, rect.top - 96);
  const bottomWidth = Math.min(560, Math.max(320, host.width - 24));
  const bottomLeft = clamp(rect.left + rect.width / 2 - bottomWidth / 2, 12, Math.max(12, host.width - bottomWidth - 12));
  let bottomTop = rect.top + rect.height + PANEL_GAP;
  if (bottomTop + BOTTOMBAR_HEIGHT + 8 > host.height) {
    bottomTop = Math.min(rect.top + rect.height - BOTTOMBAR_HEIGHT - PANEL_GAP, host.height - BOTTOMBAR_HEIGHT - 8);
  }
  bottomTop = Math.max(rect.top + 8, bottomTop);

  return (
    <>
      {canEdit && createPortal(
        <canvas
          ref={canvasRef}
          className="canvas-image-mask-layer nodrag nopan nowheel"
          aria-label={t('imageMask.aria.canvas')}
          style={{
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            borderRadius: `calc(var(--canvas-node-radius) * ${semanticZoom})`,
          }}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onDoubleClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        />,
        root,
      )}
      {createPortal(
        <>
          <div
            className="image-mask-topbar nodrag nopan nowheel"
            style={{ left: topLeft, top: topTop }}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            <IconButton label={t('imageMask.close')} onClick={onCancel}>
              <IconSymbol name="x" />
            </IconButton>
            <span className="image-mask-divider" />
            <IconButton label={t('imageMask.mode.paint')} active={mode === 'paint'} onClick={() => setMode('paint')}>
              <IconSymbol name="brush" />
            </IconButton>
            <IconButton label={t('imageMask.mode.erase')} active={mode === 'erase'} onClick={() => setMode('erase')}>
              <IconSymbol name="eraser" />
            </IconButton>
            <span className="image-mask-divider" />
            <Slider
              className="image-mask-slider"
              aria-label={t('imageMask.brushSize')}
              min={6}
              max={brushMax}
              step={2}
              value={clamp(brushSize, 6, brushMax)}
              tooltip={{ open: false }}
              onChange={(value) => setBrushSize(clamp(value, 6, brushMax))}
            />
            <span className="image-mask-brush-value">{brushSize}px</span>
            <span className="image-mask-divider" />
            <IconButton label={t('imageMask.reset')} onClick={resetMask}>
              <IconSymbol name="refresh" />
            </IconButton>
          </div>
          <div
            className="image-mask-bottombar nodrag nopan nowheel"
            style={{ left: bottomLeft, top: bottomTop, width: bottomWidth }}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            <Input
              className="image-mask-prompt"
              value={prompt}
              onChange={(event) => {
                setPrompt(event.target.value);
                setError('');
              }}
              onPressEnter={() => void submit()}
              placeholder={t('imageMask.promptPlaceholder')}
              aria-label={t('imageMask.prompt')}
              disabled={!canEdit || saving}
            />
            <button
              ref={settingsButtonRef}
              type="button"
              className={`image-mask-icon-button${settingsOpen ? ' is-active' : ''}`}
              aria-label={t('imageMask.aria.settings')}
              aria-expanded={settingsOpen}
              title={t('imageMask.aria.settings')}
              onClick={() => setSettingsOpen((current) => !current)}
            >
              <IconSymbol name="sliders" />
            </button>
            <button
              type="button"
              className="image-mask-generate"
              aria-label={t('imageMask.generate')}
              title={t('imageMask.generate')}
              disabled={!canEdit || !hasPaint || !prompt.trim() || saving}
              onClick={() => void submit()}
            >
              <IconSymbol name="spark" />
            </button>
            {error && <div className="image-mask-error" role="alert">{error}</div>}
            {!canEdit && <div className="image-mask-error" role="alert">{t('imageMask.noModels')}</div>}
            {settingsOpen && canEdit && (
              <div
                ref={settingsRef}
                className="image-mask-settings"
                role="group"
                aria-label={t('imageMask.aria.settings')}
                style={{ maxHeight: Math.max(240, Math.min(560, bottomTop - 20)) }}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
              >
                <section className="image-mask-model-section">
                  <p>{t('imageMask.model')}</p>
                  <Select
                    className="image-mask-model-select"
                    size="small"
                    value={model}
                    onChange={changeModel}
                    showSearch
                    optionFilterProp="label"
                    aria-label={t('imageMask.model')}
                    options={models.map((item) => ({ value: item, label: getModelInfo(item)?.name || item }))}
                  />
                </section>
                <GenerationSettingsPanel
                  nodeId={nodeId}
                  state={settingsState}
                  actions={actions}
                  onConfigChange={(key, value) => setConfig((current) => ({ ...current, [key]: value }))}
                />
              </div>
            )}
          </div>
        </>,
        root,
      )}
    </>
  );
}
