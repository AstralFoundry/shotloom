import { t } from '@/i18n';
import { useEffect, useMemo, useRef, useState } from 'react';
import { App, Button, Modal, Upload } from 'antd';
import { IconSymbol } from '../components/IconSymbol';
import { SearchInput } from '../components/SearchInput';
import { importPoseCatalogText, loadPoseCatalog } from '@/services/poseLibraryService';
import {
  POSE_LIBRARY_HOMEPAGE,
  POSE_LIBRARY_PAGE_SIZE,
  POSE_LIBRARY_MAX_SELECTION,
  defaultPoseAngle,
  filterPoses,
  poseCatalogStats,
  poseFacets,
  type Pose,
  type PoseCatalog,
  type PoseItem,
} from '@/domain/pose/PoseLibrary';
import { insertPoseReferences, type PosePick } from './poseLibraryActions';

const ALL = '';

function PoseImage({ src, alt, className = 'pose-card-image' }: { src: string; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) {
    return (
      <span className={`${className}-placeholder`} aria-hidden="true">
        {t('canvas.pose.imageUnavailable')}
      </span>
    );
  }
  return <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />;
}

export function PoseLibraryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { message } = App.useApp();
  const [catalog, setCatalog] = useState<PoseCatalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [keyword, setKeyword] = useState('');
  const [system, setSystem] = useState(ALL);
  const [category, setCategory] = useState(ALL);
  const [angle, setAngle] = useState(ALL);
  const [shownAngles, setShownAngles] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<Map<string, PosePick>>(() => new Map());
  const [inserting, setInserting] = useState(false);
  const [visibleCount, setVisibleCount] = useState(60);
  const abortRef = useRef<AbortController | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setPicked(new Map());
    if (catalog) return;
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setLoading(true);
    setError('');
    void loadPoseCatalog({ signal: controller.signal })
      .then((value) => setCatalog(value))
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [open, catalog]);

  const facets = useMemo(() => {
    const poses = catalog?.poses || [];
    return poseFacets(poses, { keyword, system, category, angle });
  }, [catalog, keyword, system, category, angle]);
  const filtered = useMemo(() => {
    const result = filterPoses(catalog?.poses || [], { keyword, system, category, angle });
    return result;
  }, [catalog, keyword, system, category, angle]);
  const stats = catalog ? poseCatalogStats(catalog) : null;
  const selection = [...picked.values()];

  useEffect(() => {
    setVisibleCount(60);
    if (gridRef.current) gridRef.current.scrollTop = 0;
  }, [keyword, system, category, angle]);

  function shownItem(pose: Pose): PoseItem | undefined {
    return defaultPoseAngle(pose, shownAngles[pose.key] || angle);
  }

  function toggle(pose: Pose, item: PoseItem) {
    setPicked((current) => {
      const next = new Map(current);
      if (next.has(item.id)) next.delete(item.id);
      else if (next.size >= POSE_LIBRARY_MAX_SELECTION) {
        message.warning(t('canvas.pose.maxSelection', { count: POSE_LIBRARY_MAX_SELECTION }));
        return current;
      } else {
        next.set(item.id, { pose, item });
      }
      return next;
    });
  }

  async function insert() {
    if (!selection.length || inserting) return;
    setInserting(true);
    try {
      const result = await insertPoseReferences(selection);
      if (result.created) {
        message.success(t('canvas.pose.inserted', { count: result.created }));
        setPicked(new Map());
        onClose();
      }
      if (result.failed.length) {
        message.warning(t('canvas.pose.insertFailed', { count: result.failed.length, first: result.failed[0] || '' }));
      }
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setInserting(false);
    }
  }

  function importPack(file: File) {
    void file.text().then((text) => {
      try {
        const next = importPoseCatalogText(text);
        setCatalog(next);
        setKeyword('');
        setSystem(ALL);
        setCategory(ALL);
        setAngle(ALL);
        message.success(t('canvas.pose.imported', { count: next.poses.length }));
      } catch (cause) {
        message.error(cause instanceof Error ? cause.message : String(cause));
      }
    }).catch((cause) => message.error(cause instanceof Error ? cause.message : String(cause)));
    return false;
  }

  function retry() {
    setCatalog(null);
    setError('');
    setLoading(true);
    void loadPoseCatalog({ force: true })
      .then((value) => setCatalog(value))
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setLoading(false));
  }

  const libraryEmpty = Boolean(catalog) && !loading && stats?.poses === 0;
  const scopeLabel = system || t('canvas.pose.allSystems');

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={1140}
      destroyOnHidden
      closable={false}
      title={null}
      footer={null}
      className="pose-library-modal"
      styles={{ body: { padding: 0 } }}
    >
      <div className="pose-library-shell">
        <header className="pose-library-header">
          <span className="pose-library-header-icon"><IconSymbol name="user" /></span>
          <div className="pose-library-header-text">
            <strong>{t('canvas.pose.title')}</strong>
            <span>{t('canvas.pose.description')}</span>
          </div>
          <div className="pose-library-header-search">
            <SearchInput value={keyword} onChange={setKeyword} placeholder={t('canvas.pose.search')} />
          </div>
          <button type="button" className="pose-library-close" aria-label={t('canvas.pose.close')} onClick={onClose}>✕</button>
        </header>
        <div className="pose-library-body">
          <aside className="pose-library-sidebar" aria-label={t('canvas.pose.filters')}>
            <div className="pose-sidebar-group">
              <span className="pose-sidebar-label">{t('canvas.pose.systems')}</span>
              <button type="button" className={system ? '' : 'is-active'} onClick={() => setSystem(ALL)}>
                <span>{t('canvas.pose.allSystems')}</span><em>{stats?.poses || 0}</em>
              </button>
              {facets.systems.map((facet) => (
                <button key={facet.name} type="button" className={system === facet.name ? 'is-active' : ''} onClick={() => { setSystem(facet.name); setCategory(ALL); }}>
                  <span title={facet.name}>{facet.name}</span><em>{facet.count}</em>
                </button>
              ))}
            </div>
            <div className="pose-sidebar-group">
              <span className="pose-sidebar-label">{t('canvas.pose.categories')}</span>
              <button type="button" className={category ? '' : 'is-active'} onClick={() => setCategory(ALL)}>
                <span>{t('canvas.pose.allCategories')}</span><em>{stats?.poses || 0}</em>
              </button>
              {facets.categories.map((facet) => (
                <button key={facet.name} type="button" className={category === facet.name ? 'is-active' : ''} onClick={() => setCategory(facet.name)}>
                  <span title={facet.name}>{facet.name}</span><em>{facet.count}</em>
                </button>
              ))}
            </div>
            <div className="pose-sidebar-actions">
              <Upload accept=".json,application/json" showUploadList={false} beforeUpload={(file) => importPack(file)}>
                <Button size="small" block>{t('canvas.pose.importPack')}</Button>
              </Upload>
              <a href={POSE_LIBRARY_HOMEPAGE} target="_blank" rel="noreferrer">{t('canvas.pose.source')}</a>
            </div>
          </aside>
          <main className="pose-library-main">
            <div className="pose-library-main-head">
              <span>{scopeLabel} <em>{t('canvas.pose.poseCount', { count: filtered.length })}</em></span>
              <div className="pose-angle-chips" role="group" aria-label={t('canvas.pose.angles')}>
                <button type="button" className={angle ? '' : 'is-active'} onClick={() => setAngle(ALL)}>{t('canvas.pose.allAngles')}</button>
                {facets.angles.map((facet) => (
                  <button key={facet.name} type="button" className={angle === facet.name ? 'is-active' : ''} onClick={() => setAngle(facet.name)}>{facet.name}</button>
                ))}
              </div>
            </div>
            {loading ? (
              <div className="pose-library-state">{t('canvas.pose.loading')}</div>
            ) : error ? (
              <div className="pose-library-state is-error">
                <span>{error}</span>
                <Button onClick={retry}>{t('canvas.pose.retry')}</Button>
              </div>
            ) : libraryEmpty ? (
              <div className="pose-library-state">
                <span className="pose-library-state-icon"><IconSymbol name="user" /></span>
                <strong>{t('canvas.pose.emptyTitle')}</strong>
                <span>{t('canvas.pose.emptyBody')}</span>
                <Upload accept=".json,application/json" showUploadList={false} beforeUpload={(file) => importPack(file)}>
                  <Button type="primary">{t('canvas.pose.importPack')}</Button>
                </Upload>
              </div>
            ) : !filtered.length ? (
              <div className="pose-library-state">
                <strong>{t('canvas.pose.noMatchTitle')}</strong>
                <Button onClick={() => { setKeyword(''); setSystem(ALL); setCategory(ALL); setAngle(ALL); }}>{t('canvas.pose.reset')}</Button>
              </div>
            ) : (
              <div
                className="pose-library-grid"
                ref={gridRef}
                onScroll={(event) => {
                  const element = event.currentTarget;
                  if (element.scrollTop + element.clientHeight >= element.scrollHeight - 320) {
                    setVisibleCount((count) => Math.min(filtered.length, count + POSE_LIBRARY_PAGE_SIZE * 2));
                  }
                }}
              >
                {filtered.slice(0, visibleCount).map((pose) => {
                  const item = shownItem(pose);
                  if (!item) return null;
                  const selected = picked.has(item.id);
                  return (
                    <article className={`pose-card${selected ? ' is-selected' : ''}`} key={pose.key}>
                      <div className="pose-card-visual">
                        <button type="button" className="pose-card-image" onClick={() => toggle(pose, item)} aria-pressed={selected} aria-label={`${pose.name} · ${item.angle}`}>
                          <PoseImage src={item.thumbUrl || item.imageUrl} alt={`${pose.name} · ${item.angle}`} />
                        </button>
                        {pose.code ? <span className="pose-card-code">{pose.code}</span> : null}
                        <button type="button" className={`pose-card-select${selected ? ' is-selected' : ''}`} aria-label={t('canvas.pose.toggleSelect')} onClick={() => toggle(pose, item)}>
                          {selected ? '✓' : ''}
                        </button>
                      </div>
                      <div className="pose-card-body">
                        <strong title={pose.name}>{pose.name}</strong>
                        <span><em>{pose.category}</em><i>{item.angle}</i></span>
                      </div>
                      <div className="pose-card-angles">
                        {pose.items.map((angleItem) => (
                          <button
                            key={angleItem.id}
                            type="button"
                            className={`${angleItem.angle === item.angle ? 'is-active' : ''}${picked.has(angleItem.id) ? ' is-picked' : ''}`}
                            onClick={() => setShownAngles((current) => ({ ...current, [pose.key]: angleItem.angle }))}
                            title={t('canvas.pose.switchAngle', { angle: angleItem.angle })}
                          >
                            <PoseImage src={angleItem.thumbUrl || angleItem.imageUrl} alt={angleItem.angle} className="pose-angle-thumb" />
                          </button>
                        ))}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </main>
        </div>
        <footer className="pose-library-footer">
          <span>{t('canvas.pose.footerHint')}</span>
          <div className="pose-library-footer-right">
            <span>{t('canvas.pose.selected', { count: selection.length, max: POSE_LIBRARY_MAX_SELECTION })}</span>
            <Button type="primary" disabled={!selection.length || inserting} loading={inserting} onClick={() => void insert()}>
              {t('canvas.pose.insert')}
            </Button>
          </div>
        </footer>
      </div>
    </Modal>
  );
}
