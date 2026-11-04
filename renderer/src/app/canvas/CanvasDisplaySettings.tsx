import { useEffect, useRef, useState } from 'react';
import { t } from '@/i18n';
import { CANVAS_COLORS, CANVAS_EDGE_MODES, CANVAS_PATTERNS, type CanvasAppearance } from '../../utils/canvasAppearance';
import type { AgentLayoutMode } from '../../services/agentLayoutService';
import { IconSymbol } from '../components/IconSymbol';

export function CanvasDisplaySettings({ appearance, onChange, onAutoLayout }: {
  appearance: CanvasAppearance;
  onChange: (patch: Partial<CanvasAppearance>) => Promise<void>;
  onAutoLayout?: ((options?: { mode?: AgentLayoutMode; includeConnected?: boolean }) => boolean) | undefined;
}) {
  const [panel, setPanel] = useState<'layout' | 'background' | 'edges' | null>(null);
  const [moreColors, setMoreColors] = useState(() => CANVAS_COLORS.indexOf(appearance.color) >= 3);
  const [includeConnected, setIncludeConnected] = useState(true);
  const [saving, setSaving] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!panel) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setPanel(null); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setPanel(null); } };
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('pointerdown', close, true); document.removeEventListener('keydown', key, true); };
  }, [panel]);
  const change = async (patch: Partial<CanvasAppearance>) => {
    setSaving(true);
    try { await onChange(patch); } finally { setSaving(false); }
  };
  return <div className="canvas-display-settings" ref={root}>
    <div className="canvas-display-triggers">
      {([['layout', 'columns', t('canvas.display.layout')], ['background', 'grid', t('canvas.display.background')], ['edges', 'workflow', t('canvas.display.edges')]] as const).map(([id, icon, label]) =>
        <button key={id} type="button" title={label} aria-label={label} aria-expanded={panel === id} aria-controls={`canvas-display-${id}`} className={panel === id ? 'active' : ''}
          onClick={() => setPanel(current => current === id ? null : id)}><IconSymbol name={icon} /></button>)}
    </div>
    {panel && <div id={`canvas-display-${panel}`} className={`canvas-display-panel canvas-display-panel--${panel}`} role="dialog" aria-label={t(`canvas.display.${panel === 'background' ? 'background' : panel === 'layout' ? 'layout' : 'edges'}`)}>
      <header><strong>{panel === 'background' ? t('canvas.display.background') : panel === 'layout' ? t('canvas.display.layout') : t('canvas.display.edges')}</strong>
        <button type="button" aria-label={t('canvas.display.close')} onClick={() => setPanel(null)}><IconSymbol name="x" /></button></header>
      {panel === 'background' && <fieldset disabled={saving}>
        <legend hidden>{t('canvas.display.background')}</legend>
        <h4>{t('canvas.display.pattern')}</h4>
        <div className="canvas-display-swatches">{CANVAS_PATTERNS.map(pattern => <button key={pattern} type="button" aria-pressed={appearance.pattern === pattern} onClick={() => void change({ pattern })}>
          <span className="canvas-display-sample" data-pattern={pattern} />
          <span>{t(`canvas.display.pattern.${pattern}`)}</span>{appearance.pattern === pattern && <IconSymbol name="check" />}</button>)}</div>
        <h4>{t('canvas.display.color')}</h4>
        <div className="canvas-display-swatches">{CANVAS_COLORS.slice(0, moreColors ? undefined : 3).map(color => <button key={color} type="button" aria-pressed={appearance.color === color} onClick={() => void change({ color })}>
          <span className="canvas-display-sample" data-color={color} /><span>{t(`canvas.display.color.${color}`)}</span>{appearance.color === color && <IconSymbol name="check" />}</button>)}</div>
        <button type="button" className="canvas-display-more" aria-expanded={moreColors} onClick={() => setMoreColors(value => !value)}>{t(moreColors ? 'canvas.display.fewer' : 'canvas.display.more')}<IconSymbol name="chevron-down" /></button>
      </fieldset>}
      {panel === 'edges' && <fieldset disabled={saving} className="canvas-display-edge-options">
        {CANVAS_EDGE_MODES.map(edges => <button key={edges} type="button" aria-pressed={appearance.edges === edges} onClick={() => void change({ edges })}>
          <IconSymbol name={edges === 'manual' ? 'cursor' : 'workflow'} /><span>{t(`canvas.display.edges.${edges}`)}</span>{appearance.edges === edges && <IconSymbol name="check" />}</button>)}
        <small>{t('canvas.display.edges.hint')}</small>
      </fieldset>}
      {panel === 'layout' && <div className="canvas-display-layout-options">
        <p>{t('ui.BottomModeBar.text.ffa60850')}</p>
        {(['workflow', 'horizontal', 'vertical', 'grid'] as const).map(mode => <button key={mode} type="button" disabled={!onAutoLayout} onClick={() => { onAutoLayout?.({ mode, includeConnected }); setPanel(null); }}><IconSymbol name={mode === 'workflow' ? 'workflow' : mode === 'grid' ? 'grid' : mode === 'horizontal' ? 'columns' : 'list'} />{t(`canvas.display.layout.${mode}`)}</button>)}
        <label><input type="checkbox" checked={includeConnected} onChange={event => setIncludeConnected(event.target.checked)} />{t('ui.BottomModeBar.text.df42ff54')}</label>
      </div>}
    </div>}
  </div>;
}
