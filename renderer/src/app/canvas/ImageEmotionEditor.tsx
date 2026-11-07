import { t } from '@/i18n';
import { Button, Input } from 'antd';
import { lazy, Suspense, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';

import {
  DEFAULT_EMOTION_PRESET,
  DEFAULT_FACE_RECT,
  EMOTION_PRESETS,
  emotionMaskEllipse,
  faceRectPixels,
  findEmotionPreset,
  normalizeFaceRect,
  type FaceRect,
} from '@/domain/graph/imageEmotion';
import { IconSymbol } from '../components/IconSymbol';
import { ImageRecipePanelFrame } from './ImageRecipePanelFrame';

const EmotionFacePreview = lazy(() => import('./EmotionFacePreview'));

const PANEL_WIDTH = 760;
const PANEL_HEIGHT = 600;

type LayerRect = { left: number; top: number; width: number; height: number };
type DragHandle = 'move' | 'nw' | 'ne' | 'sw' | 'se';
type DragState = { handle: DragHandle; startX: number; startY: number; rect: FaceRect; width: number; height: number };

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function buildEmotionMask(imageWidth: number, imageHeight: number, rect: FaceRect): string | null {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(imageWidth));
  canvas.height = Math.max(1, Math.round(imageHeight));
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const pixels = faceRectPixels(rect, canvas.width, canvas.height);
  const ellipse = emotionMaskEllipse(pixels);
  context.globalCompositeOperation = 'destination-out';
  context.beginPath();
  context.ellipse(ellipse.centerX, ellipse.centerY, ellipse.radiusX, ellipse.radiusY, 0, 0, Math.PI * 2);
  context.fill();
  return canvas.toDataURL('image/png');
}

export function ImageEmotionEditor({
  imageWidth,
  imageHeight,
  root,
  anchorRef,
  model,
  modelSupported,
  onCancel,
  onApply,
}: {
  imageWidth: number;
  imageHeight: number;
  root: HTMLElement | null;
  anchorRef: RefObject<HTMLDivElement | null>;
  model: string;
  modelSupported: boolean;
  onCancel: () => void;
  onApply: (payload: {
    maskDataUrl: string;
    presetId: string;
    extraPrompt: string;
    faceRect: FaceRect;
  }) => Promise<boolean>;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | null>(null);
  const padRef = useRef<HTMLDivElement>(null);
  const padding = useRef(false);
  const [layer, setLayer] = useState<LayerRect>({ left: 0, top: 0, width: imageWidth, height: imageHeight });
  const [faceRect, setFaceRect] = useState<FaceRect>(DEFAULT_FACE_RECT);
  const [stage, setStage] = useState<'select' | 'edit'>('select');
  const [presetId, setPresetId] = useState(DEFAULT_EMOTION_PRESET.id);
  const [extraPrompt, setExtraPrompt] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const preset = findEmotionPreset(presetId) ?? DEFAULT_EMOTION_PRESET;
  const canEdit = Boolean(model) && modelSupported;

  useEffect(() => {
    const anchor = anchorRef.current;
    const host = root;
    if (!anchor || !host) return;
    const update = () => {
      const anchorRect = anchor.getBoundingClientRect();
      const hostRect = host.getBoundingClientRect();
      const scale = Math.min(anchorRect.width / imageWidth, anchorRect.height / imageHeight);
      const width = imageWidth * scale;
      const height = imageHeight * scale;
      setLayer({
        left: anchorRect.left - hostRect.left + (anchorRect.width - width) / 2,
        top: anchorRect.top - hostRect.top + (anchorRect.height - height) / 2,
        width,
        height,
      });
    };
    update();
    let frame = requestAnimationFrame(function sync() {
      update();
      frame = requestAnimationFrame(sync);
    });
    return () => cancelAnimationFrame(frame);
  }, [anchorRef, imageHeight, imageWidth, root]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onCancel();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onCancel]);

  function startDrag(event: ReactPointerEvent, handle: DragHandle) {
    event.preventDefault();
    event.stopPropagation();
    const bounds = layerRef.current?.getBoundingClientRect();
    if (!bounds) return;
    drag.current = {
      handle,
      startX: event.clientX,
      startY: event.clientY,
      rect: faceRect,
      width: bounds.width,
      height: bounds.height,
    };
    layerRef.current?.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: ReactPointerEvent) {
    const state = drag.current;
    if (!state) return;
    const dx = (event.clientX - state.startX) / Math.max(1, state.width);
    const dy = (event.clientY - state.startY) / Math.max(1, state.height);
    const next = { ...state.rect };
    const min = 0.08;
    if (state.handle === 'move') {
      next.x = clamp(state.rect.x + dx, 0, 1 - state.rect.width);
      next.y = clamp(state.rect.y + dy, 0, 1 - state.rect.height);
    } else {
      if (state.handle.includes('w')) {
        const x = clamp(state.rect.x + dx, 0, state.rect.x + state.rect.width - min);
        next.width = state.rect.width + (state.rect.x - x);
        next.x = x;
      }
      if (state.handle.includes('e')) {
        next.width = clamp(state.rect.width + dx, min, 1 - state.rect.x);
      }
      if (state.handle.includes('n')) {
        const y = clamp(state.rect.y + dy, 0, state.rect.y + state.rect.height - min);
        next.height = state.rect.height + (state.rect.y - y);
        next.y = y;
      }
      if (state.handle.includes('s')) {
        next.height = clamp(state.rect.height + dy, min, 1 - state.rect.y);
      }
    }
    setFaceRect(normalizeFaceRect(next));
  }

  function endDrag(event: ReactPointerEvent) {
    if (!drag.current) return;
    drag.current = null;
    if (layerRef.current?.hasPointerCapture(event.pointerId)) {
      try { layerRef.current.releasePointerCapture(event.pointerId); } catch { /* 指针已离开 */ }
    }
  }

  function selectAt(clientX: number, clientY: number) {
    const pad = padRef.current;
    if (!pad) return;
    const bounds = pad.getBoundingClientRect();
    const column = clamp(Math.floor(((clientX - bounds.left) / Math.max(1, bounds.width)) * 5), 0, 4);
    const row = clamp(Math.floor(((clientY - bounds.top) / Math.max(1, bounds.height)) * 5), 0, 4);
    const next = EMOTION_PRESETS[row * 5 + column];
    if (next) setPresetId(next.id);
  }

  function startPad(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    padding.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    selectAt(event.clientX, event.clientY);
  }

  function movePad(event: ReactPointerEvent<HTMLDivElement>) {
    if (padding.current) selectAt(event.clientX, event.clientY);
  }

  function endPad(event: ReactPointerEvent<HTMLDivElement>) {
    padding.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* 指针已离开 */ }
    }
  }

  async function submit() {
    if (saving || !canEdit) return;
    const maskDataUrl = buildEmotionMask(imageWidth, imageHeight, faceRect);
    if (!maskDataUrl) {
      setError(t('imageEmotion.error.saveMask'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      const ok = await onApply({ maskDataUrl, presetId, extraPrompt, faceRect });
      if (!ok) setSaving(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('imageEmotion.error.saveMask'));
      setSaving(false);
    }
  }

  if (!root || !imageWidth || !imageHeight) return null;
  return (
    <>
      {createPortal(
        <div
          ref={layerRef}
          className="image-emotion-layer nodrag nopan nowheel"
          style={{ left: layer.left, top: layer.top, width: layer.width, height: layer.height }}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          <span className="image-emotion-shade is-top" style={{ height: `${faceRect.y * 100}%` }} />
          <span className="image-emotion-shade is-bottom" style={{ top: `${(faceRect.y + faceRect.height) * 100}%` }} />
          <span className="image-emotion-shade is-left" style={{ top: `${faceRect.y * 100}%`, width: `${faceRect.x * 100}%`, height: `${faceRect.height * 100}%` }} />
          <span className="image-emotion-shade is-right" style={{ top: `${faceRect.y * 100}%`, left: `${(faceRect.x + faceRect.width) * 100}%`, height: `${faceRect.height * 100}%` }} />
          <div
            className="image-emotion-frame"
            style={{
              left: `${faceRect.x * 100}%`,
              top: `${faceRect.y * 100}%`,
              width: `${faceRect.width * 100}%`,
              height: `${faceRect.height * 100}%`,
            }}
            onPointerDown={(event) => startDrag(event, 'move')}
            onClick={stage === 'select' ? () => setStage('edit') : undefined}
            aria-label={t('imageEmotion.aria.canvas')}
          >
            {(['nw', 'ne', 'sw', 'se'] as const).map((handle) => (
              <span
                key={handle}
                className={`image-emotion-handle is-${handle}`}
                onPointerDown={(event) => startDrag(event, handle)}
              />
            ))}
          </div>
        </div>,
        root,
      )}
      {stage === 'select' && createPortal(
        <div
          className="image-emotion-select-bar nodrag nopan nowheel"
          style={{ left: layer.left + layer.width / 2, top: Math.max(8, layer.top - 64) }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          <button type="button" className="image-mask-icon-button" aria-label={t('imageEmotion.close')} onClick={onCancel}>
            <IconSymbol name="x" />
          </button>
          <span className="image-mask-divider" />
          <IconSymbol name="target" />
          <span className="image-emotion-select-text">{t('imageEmotion.selectTitle')}</span>
          <button type="button" className="image-emotion-manual" onClick={() => setStage('edit')}>
            <IconSymbol name="target" />
            {t('imageEmotion.manual')}
          </button>
        </div>,
        root,
      )}
      {stage === 'edit' && (
        <ImageRecipePanelFrame
          title={t('imageEmotion.header')}
          icon="smile"
          closeLabel={t('imageEmotion.close')}
          width={PANEL_WIDTH}
          height={PANEL_HEIGHT}
          root={root}
          anchorRef={anchorRef}
          onClose={onCancel}
        >
          <div className="image-emotion-body">
            <div className="image-emotion-chips">
              <span className="image-emotion-chip">
                <IconSymbol name="user" />
                {t('imageEmotion.character')} 1
              </span>
              <button type="button" className="image-emotion-manual" onClick={() => setStage('select')}>
                <IconSymbol name="target" />
                {t('imageEmotion.manual')}
              </button>
            </div>
            <div className="image-emotion-columns">
              <div className="image-emotion-preview-column">
                <Suspense fallback={<div className="image-emotion-face-stage" />}>
                  <EmotionFacePreview preset={preset} />
                </Suspense>
                <span className="image-emotion-preview-caption">{t('imageEmotion.livePreview', { label: preset.label })}</span>
                <div className="image-emotion-field">
                  <span className="image-recipe-label">{t('imageEmotion.note')}</span>
                  <Input.TextArea
                    value={extraPrompt}
                    onChange={(event) => setExtraPrompt(event.target.value)}
                    placeholder={t('imageEmotion.notePlaceholder')}
                    autoSize={{ minRows: 2, maxRows: 4 }}
                    aria-label={t('imageEmotion.note')}
                  />
                </div>
              </div>
              <div className="image-emotion-pad-column">
                <section className="image-emotion-pad-section">
                  <div className="image-emotion-axis is-top">{t('imageEmotion.axis.arousalHigh')}</div>
                  <div className="image-emotion-axis is-bottom">{t('imageEmotion.axis.arousalLow')}</div>
                  <div className="image-emotion-axis is-left">{t('imageEmotion.axis.intimacyHigh')}</div>
                  <div className="image-emotion-axis is-right">{t('imageEmotion.axis.intimacyLow')}</div>
                  <div
                    ref={padRef}
                    className="image-emotion-pad"
                    role="group"
                    aria-label={t('imageEmotion.aria.pad')}
                    onPointerDown={startPad}
                    onPointerMove={movePad}
                    onPointerUp={endPad}
                    onPointerCancel={endPad}
                  >
                    {EMOTION_PRESETS.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={`image-emotion-dot${item.id === presetId ? ' is-active' : ''}`}
                        aria-label={item.label}
                        aria-pressed={item.id === presetId}
                        title={item.label}
                        onClick={() => setPresetId(item.id)}
                      />
                    ))}
                  </div>
                </section>
              </div>
            </div>
            {!modelSupported && <div className="image-emotion-error" role="alert">{t('imageEmotion.unsupported')}{model ? <code>{model}</code> : null}</div>}
            {error && <div className="image-emotion-error" role="alert">{error}</div>}
          </div>
          <footer className="image-recipe-foot image-emotion-foot">
            <span className="image-emotion-foot-label">{t('imageEmotion.position')}</span>
            <strong>{preset.label}</strong>
            <span className="image-recipe-foot-spacer" />
            <Button type="primary" loading={saving} disabled={!canEdit || saving} onClick={() => void submit()}>
              {t('imageEmotion.generate')}
            </Button>
          </footer>
        </ImageRecipePanelFrame>
      )}
    </>
  );
}
