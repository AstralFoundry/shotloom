import { App, Button, Input, Segmented, Select, Upload } from 'antd';
import { ImagePlus, Palette, Pencil, Plus, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { t, type MessageKey } from '@/i18n';
import {
  IMAGE_STYLE_CATEGORIES, listImageStylePresets, normalizeCustomImageStyle,
  type CustomImageStyle, type ImageStyleCategory, type ImageStylePreset,
} from '@/utils/imageStylePresets';
import { saveAppSettings, settingsStore } from '@/store/settingsStore';

type StyleScope = 'public' | 'custom';
type StyleDraft = Omit<CustomImageStyle, 'category'> & { category?: ImageStyleCategory };

function categoryLabel(id: string) {
  return t(`canvas.imageTools.styleGroup.${id}` as MessageKey);
}

async function readCover(file: File) {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not create an image canvas');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/webp', 0.82);
  } finally {
    bitmap.close();
  }
}

export function ImageStylePicker({ selected, onSelect, onClose }: {
  selected: string;
  onSelect: (style: ImageStylePreset) => void;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const fieldId = useId();
  const [scope, setScope] = useState<StyleScope>('public');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<StyleDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [readingCover, setReadingCover] = useState(false);
  const { custom } = settingsStore.imageStyleLibrary;
  const styles: readonly ImageStylePreset[] = scope === 'custom' ? custom : listImageStylePresets();
  const categories = IMAGE_STYLE_CATEGORIES.filter(id => styles.some(style => style.category === id));
  const query = search.trim().toLocaleLowerCase();
  const visible = styles.filter(style =>
    (!category || category === style.category)
    && `${style.label} ${style.id} ${style.category ? categoryLabel(style.category) : ''}`.toLocaleLowerCase().includes(query),
  );
  const canSave = Boolean(draft?.category && draft.label.trim() && draft.prompt.trim());
  const emptyLibrary = scope === 'custom' && custom.length === 0;

  function createStyle() {
    setDraft({ id: `custom:${crypto.randomUUID()}`, label: '', prompt: '' });
  }

  async function persist(next: CustomImageStyle[]) {
    if (saving) return false;
    setSaving(true);
    try {
      await saveAppSettings({ imageStyleLibrary: { custom: next } });
      return true;
    } catch {
      void message.error(t('canvas.imageTools.styleSaveFailed'));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function saveDraft() {
    if (!canSave || readingCover) return;
    const style = normalizeCustomImageStyle(draft);
    if (!style) return;
    const updated = custom.some(item => item.id === style.id)
      ? custom.map(item => item.id === style.id ? style : item)
      : [...custom, style];
    if (await persist(updated)) {
      setDraft(null);
      setCategory('');
      setSearch('');
    }
  }

  async function uploadCover(file: File, draftId: string) {
    setReadingCover(true);
    try {
      const cover = await readCover(file);
      setDraft(current => current?.id === draftId ? { ...current, cover } : current);
    } catch {
      void message.error(t('canvas.imageTools.coverReadFailed'));
    } finally {
      setReadingCover(false);
    }
  }

  return <div className={`image-style-popover${draft ? ' is-editing' : ''}`} onKeyDown={event => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    if (draft) setDraft(null);
    else onClose();
  }}>
    {!draft && <div className="image-style-picker-header">
      <Segmented<StyleScope>
        value={scope}
        aria-label={t('canvas.imageTools.style')}
        options={[
          { value: 'public', label: t('canvas.imageTools.publicStyles') },
          { value: 'custom', label: t('canvas.imageTools.customStyles') },
        ]}
        onChange={next => { setScope(next); setCategory(''); setDraft(null); }}
      />
      {!emptyLibrary && <Input
        variant="borderless"
        allowClear
        aria-label={t('canvas.imageTools.searchStyles')}
        placeholder={t('canvas.imageTools.searchStyles')}
        value={search}
        onChange={event => setSearch(event.target.value)}
      />}
      {scope === 'custom' && !emptyLibrary && <Button type="text" className="image-style-create" icon={<Plus aria-hidden />} onClick={createStyle}>
        {t('canvas.imageTools.addStyle')}
      </Button>}
    </div>}
    {!draft && categories.length > 0 && <div className="image-style-picker-categories">
      <Segmented
        value={category}
        aria-label={t('canvas.imageTools.styleCategory')}
        options={[
          { value: '', label: t('canvas.imageTools.allStyles') },
          ...categories.map(id => ({ value: id, label: categoryLabel(id) })),
        ]}
        onChange={setCategory}
      />
    </div>}
    {draft ? <form className="image-style-picker-form" aria-labelledby={`${fieldId}-title`} onSubmit={event => {
      event.preventDefault();
      if (canSave && !saving) void saveDraft();
    }}>
      <header className="image-style-form-heading">
        <h3 id={`${fieldId}-title`}>{t(custom.some(item => item.id === draft.id) ? 'canvas.imageTools.editStyle' : 'canvas.imageTools.addStyle')}</h3>
      </header>
      <div className="image-style-form-body">
        <div className="image-style-picker-fields">
          <div className="image-style-form-field">
            <label htmlFor={`${fieldId}-name`}>{t('canvas.imageTools.styleName')}</label>
            <Input
              id={`${fieldId}-name`}
              variant="filled"
              aria-required="true"
              value={draft.label}
              onChange={event => setDraft({ ...draft, label: event.target.value })}
            />
          </div>
          <div className="image-style-form-field">
            <label htmlFor={`${fieldId}-category`}>{t('canvas.imageTools.requiredCategory')}</label>
            <Select<ImageStyleCategory>
              id={`${fieldId}-category`}
              variant="filled"
              aria-required
              placeholder={t('canvas.imageTools.selectCategory')}
              value={draft.category ?? null}
              options={IMAGE_STYLE_CATEGORIES.map(id => ({ value: id, label: categoryLabel(id) }))}
              onChange={next => setDraft({ ...draft, category: next })}
            />
          </div>
        </div>
        <div className="image-style-form-field">
          <label htmlFor={`${fieldId}-prompt`}>{t('canvas.imageTools.stylePrompt')}</label>
          <Input.TextArea
            id={`${fieldId}-prompt`}
            variant="filled"
            aria-required="true"
            value={draft.prompt}
            autoSize={{ minRows: 3, maxRows: 6 }}
            onChange={event => setDraft({ ...draft, prompt: event.target.value })}
          />
        </div>
        <div className="image-style-picker-cover-field">
          {draft.cover && <img src={draft.cover} alt="" />}
          <Upload
            accept="image/png,image/jpeg,image/webp,image/avif"
            showUploadList={false}
            disabled={readingCover || saving}
            beforeUpload={file => { void uploadCover(file, draft.id); return Upload.LIST_IGNORE; }}
          >
            <Button type={draft.cover ? 'text' : 'dashed'} className="image-style-cover-trigger"
              icon={<ImagePlus aria-hidden />} loading={readingCover}>
              {t(draft.cover ? 'canvas.imageTools.replaceCover' : 'canvas.imageTools.optionalCover')}
            </Button>
          </Upload>
          {draft.cover && <Button type="text" onClick={() => {
            const { cover: _cover, ...next } = draft;
            setDraft(next);
          }}>{t('canvas.imageTools.removeCover')}</Button>}
        </div>
      </div>
      <div className="image-style-picker-form-actions">
        <Button type="text" onClick={() => setDraft(null)}>{t('canvas.optimizer.cancel')}</Button>
        <Button type="primary" htmlType="submit" loading={saving} disabled={!canSave || readingCover}>
          {t('canvas.imageTools.saveStyle')}
        </Button>
      </div>
    </form> : emptyLibrary ? <div className="image-style-picker-empty image-style-library-empty">
      <span>{t('canvas.imageTools.noCustomStyles')}</span>
      <Button icon={<Plus aria-hidden />} onClick={createStyle}>{t('canvas.imageTools.addStyle')}</Button>
    </div> : visible.length ? <div className="image-style-card-grid">
      {visible.map(style => {
        const isCustom = style.id.startsWith('custom:');
        const cover = isCustom ? style.cover : `./image-style-covers/${style.id}.webp`;
        return <div className="image-style-card" key={style.id}>
          <button type="button" className="image-style-card-select" aria-pressed={style.id === selected} onClick={() => onSelect(style)}>
            {cover ? <img className="image-style-card-cover" src={cover} alt="" loading="lazy" />
              : <span className="image-style-card-cover"><Palette aria-hidden /></span>}
            <span title={style.label}>{style.label}</span>
          </button>
          {isCustom && <div className="image-style-card-actions">
            <Button type="text" size="small" icon={<Pencil aria-hidden />} title={t('canvas.imageTools.editStyle')}
              aria-label={t('canvas.imageTools.editStyle')} onClick={() => setDraft(normalizeCustomImageStyle(style) ?? null)} />
            <Button type="text" size="small" icon={<Trash2 aria-hidden />} title={t('canvas.imageTools.deleteStyle')}
              aria-label={t('canvas.imageTools.deleteStyle')} disabled={saving}
              onClick={() => void persist(custom.filter(item => item.id !== style.id))} />
          </div>}
        </div>;
      })}
    </div> : <p className="image-style-picker-empty">{t('canvas.imageTools.noStyles')}</p>}
  </div>;
}
