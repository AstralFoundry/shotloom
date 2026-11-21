import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Button, Checkbox, Modal, Pagination } from 'antd';
import { t } from '@/i18n';
import { assetCategories, assetCategoryFor } from '../../domain/asset/assetCategories';
import { assetLibraryKey, assetMatchesSearch, assetMediaKind } from '../../domain/asset/AssetLibraryCatalog';
import { subscribeDomain, getDomainRevision } from '../../store/domainReactivity';
import { MaterialGrid, type MaterialItem } from './MaterialGrid';
import { IconSymbol, type IconName } from './IconSymbol';
import { SearchInput } from './SearchInput';
import type { CreationViewController } from '../views/CreationView';
import './AssetLibraryBrowser.css';

export type AssetLibraryScope = 'library' | 'local' | 'files';
export type AssetLibrarySelection = { item: MaterialItem; scope: AssetLibraryScope };
type Source = { id: AssetLibraryScope; label: string; icon: IconName; items: MaterialItem[] };
const MEDIA_TYPES = [
  ['all', 'assets.browser.allTypes'], ['image', 'ui.CreationView.text.604dfedb'],
  ['video', 'ui.CreationView.text.42baf234'], ['audio', 'ui.CreationView.text.0c2d8d74'],
  ['text', 'ui.CreationView.text.e77f069b'], ['file', 'ui.CreationView.text.803b3b26'],
] as const;
const selectionKey = (scope: string, item: MaterialItem) => `${scope}:${assetLibraryKey(item)}`;

export function AssetLibraryBrowser({ sources, initialScope, initialCategory = 'all', initialKeyword = '', focusedAssetId,
  onPreview, onAction, onInsert, onClose, onImport, onBusyChange, headerActions, selectionActions,
}: {
  sources: Source[];
  initialScope?: AssetLibraryScope;
  initialCategory?: string;
  initialKeyword?: string;
  focusedAssetId?: string;
  onPreview: (item: MaterialItem, src: string, kind: 'image' | 'video') => void;
  onAction?: (action: string, item: MaterialItem, scope: AssetLibraryScope) => void;
  onInsert?: (item: MaterialItem, scope: AssetLibraryScope) => void | Promise<void>;
  onClose?: () => void;
  onImport?: () => void | Promise<void>;
  onBusyChange?: (busy: boolean) => void;
  headerActions?: ReactNode;
  selectionActions?: (selection: AssetLibrarySelection[]) => ReactNode;
}) {
  const [scope, setScope] = useState<AssetLibraryScope>(initialScope || sources[0]?.id || 'files');
  const [category, setCategory] = useState(initialCategory);
  const [keyword, setKeyword] = useState(initialKeyword);
  const [kind, setKind] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(40);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const busyRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const items = sources.find(source => source.id === scope)?.items || [];
  const filtered = useMemo(() => items.filter(item =>
    (kind === 'all' || assetMediaKind(item) === kind) &&
    (category === 'all' || assetCategoryFor(item.category).id === assetCategoryFor(category).id) &&
    assetMatchesSearch(item, keyword)), [items, kind, category, keyword]);
  const currentPage = Math.max(1, Math.min(page, Math.ceil(filtered.length / pageSize)));
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const selectedItems = sources.flatMap(source => source.items.filter(item => selected.has(selectionKey(source.id, item)))
    .map(item => ({ item, scope: source.id })));
  const selectedPageKeys = new Set(visible.filter(item => selected.has(selectionKey(scope, item))).map(assetLibraryKey));
  const allPageSelected = visible.length > 0 && selectedPageKeys.size === visible.length;
  const countFor = (id: string) => id === 'all' ? items.length : items.filter(item => assetCategoryFor(item.category).id === id).length;

  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }); }, [currentPage, pageSize, scope, category, kind, keyword]);
  useEffect(() => {
    if (!focusedAssetId) return;
    const index = filtered.findIndex(item => item.assetId === focusedAssetId);
    if (index >= 0) setPage(Math.floor(index / pageSize) + 1);
  }, [focusedAssetId, pageSize]);

  function changeFilter(change: () => void) { change(); setPage(1); }
  function toggle(item: MaterialItem) {
    if (busyRef.current) return;
    const key = selectionKey(scope, item);
    setSelected(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  }
  async function run(operation: () => Promise<void> | void) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); onBusyChange?.(true); setError('');
    try { await operation(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('assets.browser.operationFailed')); }
    finally { busyRef.current = false; setBusy(false); onBusyChange?.(false); }
  }
  async function insertSelected() {
    if (!onInsert || !selectedItems.length) return;
    await run(async () => {
      for (const { item, scope: source } of selectedItems) {
        await onInsert(item, source);
        setSelected(current => { const next = new Set(current); next.delete(selectionKey(source, item)); return next; });
      }
      onClose?.();
    });
  }

  return <section className="asset-library-browser" aria-label={t('assets.browser.title')}>
    <header className="asset-library-header">
      <span className="asset-library-heading-icon"><IconSymbol name="folder" /></span>
      <div className="asset-library-heading"><span>{t('assets.browser.eyebrow')}</span><h2>{t('assets.browser.title')}</h2></div>
      <div className="asset-library-search"><SearchInput autoFocus value={keyword} onChange={value => changeFilter(() => setKeyword(value))} placeholder={t('assets.browser.search')} /></div>
      {headerActions}
      {onClose && <Button type="text" className="asset-library-close" aria-label={t('imageRecipe.common.close')} disabled={busy} onClick={onClose} icon={<IconSymbol name="x" />} />}
    </header>
    <div className="asset-library-body">
      <aside className="asset-library-sidebar" aria-label={t('assets.browser.filters')}>
        <nav className="asset-library-sources" aria-label={t('ui.CreationView.arialabel.60849240')}>
          {sources.map(source => <button key={source.id} type="button" className={scope === source.id ? 'is-active' : ''} aria-pressed={scope === source.id} onClick={() => changeFilter(() => setScope(source.id))}>
            <IconSymbol name={source.icon} /><span>{source.label}</span><small>{source.items.length}</small>
          </button>)}
        </nav>
        <div className="asset-library-filter-group"><h3>{t('ui.CreationView.arialabel.74e3df5b')}</h3>
          {MEDIA_TYPES.map(([id, label]) => <button type="button" key={id} className={kind === id ? 'is-active' : ''} aria-pressed={kind === id} onClick={() => changeFilter(() => setKind(id))}>{t(label)}</button>)}
        </div>
        <div className="asset-library-filter-group"><h3>{t('assets.collection.label')}</h3>
          {[{ id: 'all', label: t('ui.CreationView.text.a8e369c4') }, ...assetCategories].map(entry => <button type="button" key={entry.id} className={category === entry.id ? 'is-active' : ''} aria-pressed={category === entry.id} onClick={() => changeFilter(() => setCategory(entry.id))}>
            <span>{entry.label}</span><small>{countFor(entry.id)}</small>
          </button>)}
        </div>
      </aside>
      <div className="asset-library-results">
        <div className="asset-library-scroll" ref={scrollRef} aria-busy={busy}>
          {filtered.length ? <MaterialGrid variant="library" materials={visible} selectedKeys={selectedPageKeys} {...(focusedAssetId ? { focusedAssetId } : {})}
            onToggleSelected={toggle} onPreview={onPreview} showLibraryAction={false} showFileAction={Boolean(onAction)} showRenameAction={Boolean(onAction) && scope === 'library'} showDeleteAction={Boolean(onAction)}
            showPromoteAction={Boolean(onAction) && scope === 'library'} showCopyAction={Boolean(onAction) && scope === 'local'}
            onAction={(action, item) => onAction?.(action, item, scope)} /> :
            <div className="asset-library-empty"><IconSymbol name={keyword ? 'search' : 'folder'} /><strong>{t(keyword || kind !== 'all' || category !== 'all' ? 'ui.CreationView.text.8e9479a5' : 'ui.CreationView.text.a4abb52f')}</strong>
              <p>{t('assets.browser.emptyHint')}</p>
              {(keyword || kind !== 'all' || category !== 'all') && <Button onClick={() => changeFilter(() => { setKeyword(''); setKind('all'); setCategory('all'); })}>{t('ui.AssetPickerDialog.text.4bbc4e5f')}</Button>}
            </div>}
        </div>
        <div className="asset-library-pagination">
          <Checkbox checked={allPageSelected} indeterminate={selectedPageKeys.size > 0 && !allPageSelected} disabled={busy || !visible.length} onChange={() => setSelected(current => {
            const next = new Set(current); for (const item of visible) { const key = selectionKey(scope, item); if (allPageSelected) next.delete(key); else next.add(key); } return next;
          })}>{t('assets.browser.selectPage')}</Checkbox>
          <Pagination current={currentPage} pageSize={pageSize} total={filtered.length} showSizeChanger pageSizeOptions={[20, 40, 80]} showTotal={total => t('assets.browser.total', { count: total })} onChange={(next, size) => { setPage(next); setPageSize(size); }} />
        </div>
      </div>
    </div>
    <footer className="asset-library-footer">
      {onImport && <Button icon={<IconSymbol name="upload" />} disabled={busy} onClick={() => void run(onImport)}>{t('ui.CreationView.text.60e2bcad')}</Button>}
      <span className="asset-library-selection-count">{t('assets.browser.selection', { count: selectedItems.length })}</span>
      {error && <span className="asset-library-error" role="alert">{error}</span>}
      {!!selectedItems.length && <Button type="text" disabled={busy} onClick={() => setSelected(new Set())}>{t('assets.browser.clearSelection')}</Button>}
      {selectionActions?.(selectedItems)}
      {onClose && <Button disabled={busy} onClick={onClose}>{t('imageRecipe.common.cancel')}</Button>}
      {onInsert && <Button type="primary" icon={<IconSymbol name="check" />} loading={busy} disabled={!selectedItems.length} onClick={() => void insertSelected()}>{t('assets.browser.insert')}</Button>}
    </footer>
  </section>;
}

export function AssetLibraryModal({ open, onClose, controller, request }: { open: boolean; onClose: () => void; controller: CreationViewController;
  request?: { scope: AssetLibraryScope; category: string; name: string; assetId: string } | null;
}) {
  const revision = useSyncExternalStore(subscribeDomain, getDomainRevision, getDomainRevision);
  const [busy, setBusy] = useState(false);
  const resources = useMemo(() => controller.loadMaterials(), [controller, revision]);
  const sources: Source[] = [
    { id: 'files', label: t('assets.browser.canvasFiles'), icon: 'image', items: resources.materials },
    { id: 'library', label: t('ui.ProjectSearch.text.96cb64ae'), icon: 'folder', items: resources.projectAssets },
    { id: 'local', label: t('ui.CreationView.text.d2199cbf'), icon: 'archive', items: resources.localAssets },
  ];
  return <Modal open={open} centered title={null} footer={null} closable={false} destroyOnHidden width="min(1440px, calc(100vw - 48px))" className="asset-library-modal"
    styles={{ container: { padding: 0 }, body: { padding: 0 } }} mask={{ closable: !busy }} keyboard={!busy} onCancel={() => { if (!busy) onClose(); }}>
    <AssetLibraryBrowser sources={sources} initialScope={request?.scope || (resources.materials.length ? 'files' : resources.projectAssets.length ? 'library' : 'local')}
      {...(request ? { initialCategory: request.category, initialKeyword: request.name, focusedAssetId: request.assetId } : {})}
      onPreview={controller.previewMaterial} onClose={onClose} onInsert={controller.applyMaterial} onBusyChange={setBusy} onImport={controller.importMaterials} />
  </Modal>;
}
