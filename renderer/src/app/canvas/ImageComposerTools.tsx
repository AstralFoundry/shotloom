import { Popover, Slider } from 'antd';
import {
  Clapperboard, Contrast, ContactRound, FastForward, Film, Grid2x2, Grid3x3,
  Maximize2, Package, Palette, PersonStanding, Ratio, Rewind, Route, ScanFace, Type, X,
} from 'lucide-react';
import { useState } from 'react';
import { t } from '@/i18n';
import { IMAGE_COMPOSITION_GROUPS, getImageCompositionPreset, type ImageCompositionPreset } from '@/domain/graph/ImageCompositionPresets';
import type { ImageStylePreset } from '@/utils/imageStylePresets';
import { useAppStore } from '../store/appStore';
import { ImageStylePicker } from './ImageStylePicker';

type ImageToolMenu = 'style' | 'composition' | 'font';

const presetColumns: Array<Array<keyof typeof IMAGE_COMPOSITION_GROUPS>> = [
  ['storyboard'],
  ['coverage', 'continuity'],
  ['sheets'],
];
const presetIcons = {
  shortStoryboard: Clapperboard, blockingStoryboard: Route, pitchGrid: Grid2x2, storyboard25: Film,
  cameraGrid: Grid3x3, lightCorrection: Contrast, before5Seconds: Rewind, after3Seconds: FastForward,
  characterFourView: ContactRound, characterThreeView: PersonStanding, faceThreeView: ScanFace, productThreeView: Package,
};

function popupContainer(trigger: HTMLElement) {
  return trigger.closest<HTMLElement>('.ant-modal') ?? document.body;
}

function PresetPicker({ selected, onSelect, onClose }: {
  selected: ImageCompositionPreset | undefined;
  onSelect: (id: ImageCompositionPreset) => void;
  onClose: () => void;
}) {
  const [inspected, setInspected] = useState(selected ?? 'characterFourView');
  const ratio = getImageCompositionPreset(inspected)?.ratio;
  return <div className="image-composition-popover" onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
  }}>
    <div className="image-composition-columns">
      {presetColumns.map(column => <div key={column[0]}>
        {column.map(group => <section key={group} className="image-composition-group">
          <h4>{t(`canvas.imageComposition.group.${group}`)}</h4>
          {(Object.keys(IMAGE_COMPOSITION_GROUPS[group]) as ImageCompositionPreset[]).map(id => {
            const Icon = presetIcons[id];
            return <button
              key={id}
              type="button"
              className="image-composition-choice"
              aria-pressed={selected === id}
              data-inspected={inspected === id}
              onPointerEnter={() => setInspected(id)}
              onFocus={() => setInspected(id)}
              onClick={() => onSelect(id)}
            >
              <span className="image-composition-icon"><Icon aria-hidden /></span>
              {t(`canvas.imageComposition.${id}.label`)}
            </button>;
          })}
        </section>)}
      </div>)}
    </div>
    <div className="image-composition-detail">
      <span>{t(`canvas.imageComposition.${inspected}.summary`)}</span>
      <span className="image-composition-ratio"><Ratio aria-hidden />{ratio === 'original' ? t('canvas.imageTools.sourceRatio') : ratio}</span>
    </div>
  </div>;
}

export function ImageComposerTools({
  menu, setMenu, selectedStyle, compositionId, onStyle, onComposition, onExpand, onClose,
}: {
  menu: string;
  setMenu: (menu: ImageToolMenu | '') => void;
  selectedStyle: ImageStylePreset;
  compositionId: unknown;
  onStyle: (style: ImageStylePreset | null) => void;
  onComposition: (id: string) => void;
  onExpand: (() => void) | undefined;
  onClose: (() => void) | undefined;
}) {
  const size = useAppStore(store => store.canvasPromptFontSize);
  const setSize = useAppStore(store => store.setCanvasPromptFontSize);
  const composition = getImageCompositionPreset(compositionId)?.id;
  const styleLabel = t('canvas.imageTools.style');
  const presetLabel = t('canvas.imageTools.preset');
  const fontLabel = t('canvas.imageTools.fontSize');
  const expandLabel = t('canvas.imageTools.expand');
  const closePopup = () => setMenu('');
  const popupProps = {
    trigger: 'click' as const,
    placement: 'topRight' as const,
    align: { overflow: { adjustX: true, adjustY: true, shiftX: true, shiftY: true } },
    arrow: false,
    destroyOnHidden: true,
    getPopupContainer: popupContainer,
    classNames: { root: 'image-composer-popover' },
  };

  return <div className="image-composer-tools">
    <div className="image-composer-tool-group" data-active={Boolean(selectedStyle.id)}>
      <Popover
        {...popupProps}
        open={menu === 'style'}
        onOpenChange={open => setMenu(open ? 'style' : '')}
        content={<ImageStylePicker selected={selectedStyle.id} onClose={closePopup}
          onSelect={style => { onStyle(style); closePopup(); }} />}
      >
        <button type="button" className="image-composer-tool"
          aria-label={styleLabel} aria-haspopup="dialog" aria-expanded={menu === 'style'}
          title={selectedStyle.id ? selectedStyle.label : styleLabel}>
          <Palette aria-hidden /><span>{selectedStyle.id ? selectedStyle.label : styleLabel}</span>
        </button>
      </Popover>
      {selectedStyle.id && <button type="button" className="image-composer-clear" aria-label={t('canvas.imageTools.clearStyle')} title={t('canvas.imageTools.clearStyle')} onClick={() => { onStyle(null); closePopup(); }}>
        <X aria-hidden />
      </button>}
    </div>
    <div className="image-composer-tool-group" data-active={Boolean(composition)}>
      <Popover
        {...popupProps}
        open={menu === 'composition'}
        onOpenChange={open => setMenu(open ? 'composition' : '')}
        content={<PresetPicker selected={composition} onClose={closePopup}
          onSelect={id => { onComposition(id); closePopup(); }} />}
      >
        <button type="button" className="image-composer-tool"
          aria-label={presetLabel} aria-haspopup="dialog" aria-expanded={menu === 'composition'}
          title={composition ? t(`canvas.imageComposition.${composition}.label`) : presetLabel}>
          <Grid3x3 aria-hidden /><span>{composition ? t(`canvas.imageComposition.${composition}.label`) : presetLabel}</span>
        </button>
      </Popover>
      {composition && <button type="button" className="image-composer-clear" aria-label={t('canvas.imageTools.clearPreset')} title={t('canvas.imageTools.clearPreset')} onClick={() => { onComposition(''); closePopup(); }}>
        <X aria-hidden />
      </button>}
    </div>
    <div className="image-composer-view-tools">
      <Popover
        trigger="click"
        placement="topRight"
        open={menu === 'font'}
        onOpenChange={open => setMenu(open ? 'font' : '')}
        getPopupContainer={popupContainer}
        content={<div className="image-composer-font-size">
          <Slider min={10} max={20} step={1} value={size} onChange={setSize} ariaLabelForHandle={fontLabel} tooltip={{ open: false }} />
          <span>{size}px</span>
        </div>}
      >
        <button type="button" className="image-composer-tool" title={fontLabel} aria-label={fontLabel} aria-expanded={menu === 'font'}>
          <Type aria-hidden />
        </button>
      </Popover>
      {onExpand && <button type="button" className="image-composer-tool" title={expandLabel} aria-label={expandLabel} aria-haspopup="dialog" onClick={onExpand}>
        <Maximize2 aria-hidden />
      </button>}
      {onClose && <button type="button" className="image-composer-tool" title={t('canvas.imageTools.closeExpanded')}
        aria-label={t('canvas.imageTools.closeExpanded')} onClick={onClose}>
        <X aria-hidden />
      </button>}
    </div>
  </div>;
}
