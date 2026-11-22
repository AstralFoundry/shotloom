import { Input, Popover, Segmented } from 'antd';
import { Camera, PanelsTopLeft, Search, X } from 'lucide-react';
import { useState } from 'react';
import { t } from '@/i18n';
import { VIDEO_MOTION_CATEGORIES, VIDEO_MOTIONS, VIDEO_PROMPT_TEMPLATES, selectedVideoMotions } from '@/domain/graph/VideoComposerPresets';
import { ComposerViewTools, popupContainer } from './ImageComposerTools';

function VideoToolPicker({ motion, selected, onChoose }: {
  motion: boolean;
  selected: string[];
  onChoose: (id: string, prompt: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<keyof typeof VIDEO_MOTION_CATEGORIES | ''>('');
  const searchLabel = t(motion ? 'canvas.videoTools.searchMotion' : 'canvas.videoTools.searchTemplate');
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visible = (motion ? VIDEO_MOTIONS.filter(item => !category || item.category === category) : VIDEO_PROMPT_TEMPLATES)
    .filter(item => `${item.name} ${item.id} ${item.description} ${'category' in item ? VIDEO_MOTION_CATEGORIES[item.category as keyof typeof VIDEO_MOTION_CATEGORIES] : ''}`.toLocaleLowerCase().includes(normalizedQuery));
  return <div className={motion ? 'image-style-popover' : 'video-template-popover'}>
    <div className="image-style-picker-header">
      <Input className="video-composer-search" variant="filled" prefix={<Search aria-hidden />} allowClear aria-label={searchLabel} placeholder={searchLabel}
        value={query} onChange={event => setQuery(event.target.value)} />
    </div>
    {motion && <div className="image-style-picker-categories">
      <Segmented value={category} onChange={setCategory} aria-label={t('canvas.videoTools.motion')}
        options={[{ label: t('canvas.imageTools.allStyles'), value: '' }, ...Object.entries(VIDEO_MOTION_CATEGORIES)
          .map(([value, label]) => ({ label, value: value as keyof typeof VIDEO_MOTION_CATEGORIES }))]} />
    </div>}
    {visible.length ? <div className={motion ? 'image-style-card-grid' : 'video-template-list'}>
      {visible.map(item => <button key={item.id} type="button"
        className={motion ? 'image-style-card-select' : 'video-template-option'}
        aria-pressed={motion ? selected.includes(item.id) : undefined} title={item.description}
        onClick={() => onChoose(item.id, item.prompt)}>
        {motion && <img className="image-style-card-cover" src={`./video-motion-covers/${item.id}.webp`} alt="" loading="lazy" />}
        {!motion && <PanelsTopLeft aria-hidden />}
        <span><strong>{item.name}</strong>{!motion && <small>{item.description}</small>}</span>
      </button>)}
    </div> : <p className="image-style-picker-empty">{t('canvas.videoTools.empty')}</p>}
  </div>;
}

export function VideoComposerTools({ menu, setMenu, motionIds, onToggleMotion, onTemplateOpen, onTemplate, onExpand, onClose }: {
  menu: string;
  setMenu: (menu: string) => void;
  motionIds: unknown;
  onToggleMotion: (id: string) => void;
  onTemplateOpen: () => void;
  onTemplate: (prompt: string) => void;
  onExpand?: (() => void) | undefined;
  onClose?: (() => void) | undefined;
}) {
  const selected = selectedVideoMotions(motionIds);
  const selectedIds = selected.map(item => item.id);
  return <div className="image-composer-tools">
    {(['motion', 'template'] as const).map(kind => {
      const motion = kind === 'motion';
      const label = t(motion ? 'canvas.videoTools.motion' : 'canvas.videoTools.template');
      const Icon = motion ? Camera : PanelsTopLeft;
      return <Popover key={kind} trigger="click" placement="topRight" arrow={false} destroyOnHidden
        open={menu === kind} onOpenChange={open => setMenu(open ? kind : '')}
        align={{ overflow: { adjustX: true, adjustY: true, shiftX: true, shiftY: true } }}
        getPopupContainer={popupContainer} classNames={{ root: 'image-composer-popover' }}
        content={<VideoToolPicker motion={motion} selected={selectedIds} onChoose={(id, prompt) => {
          if (motion) onToggleMotion(id);
          else onTemplate(prompt);
          setMenu('');
        }} />}>
        <button type="button" className="image-composer-tool" aria-expanded={menu === kind}
          onPointerDown={motion ? undefined : onTemplateOpen}>
          <Icon aria-hidden /><span>{label}</span>
        </button>
      </Popover>;
    })}
    <ComposerViewTools menu={menu} setMenu={setMenu} onExpand={onExpand} onClose={onClose} />
  </div>;
}

export function VideoMotionTags({ ids, onRemove }: { ids: unknown; onRemove: (id: string) => void }) {
  const selected = selectedVideoMotions(ids);
  if (!selected.length) return null;
  return <div className="image-composer-prompt-tools">
    {selected.map(item => <span key={item.id}>
      <Camera aria-hidden />{item.name}
      <button type="button" className="image-composer-clear" aria-label={t('canvas.videoTools.removeMotion', { name: item.name })}
        onClick={() => onRemove(item.id)}><X aria-hidden /></button>
    </span>)}
  </div>;
}
