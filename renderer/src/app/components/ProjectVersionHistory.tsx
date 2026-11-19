/**
 * 项目版本记录抽屉。
 *
 * 预览只在组件内读取快照 payload，不写 store；恢复必须二次确认，
 * 且真正的替换由 `restoreProjectFromSnapshot` 负责（先备份再替换）。
 */
import { getLocale, t, type MessageKey } from '@/i18n';
import { Fragment, useEffect, useState, useSyncExternalStore } from 'react';
import { App, Button, Drawer, Spin } from 'antd';
import { getDomainRevision, subscribeDomain } from '@/store/domainReactivity';
import { store } from '@/store/projectStore';
import {
  loadProjectSnapshotList,
  projectSnapshotStore,
  restoreProjectFromSnapshot,
} from '@/store/projectSnapshotStore';
import { readProjectSnapshot } from '@/services/projectSnapshotService';
import { snapshotPreview } from '@/domain/snapshots/SnapshotPolicy';
import { formatTime } from '@/utils/format';
import { EmptyState } from './EmptyState';
import { IconSymbol } from './IconSymbol';
import { ProjectSnapshotCanvas } from './ProjectSnapshotCanvas';

const REASON_LABEL: Record<string, MessageKey> = {
  auto: 'project.version.reason.auto',
  manual: 'project.version.reason.manual',
  before_restore: 'project.version.reason.beforeRestore',
};

type Preview = ReturnType<typeof snapshotPreview>;

export function ProjectVersionHistory({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { modal } = App.useApp();
  useSyncExternalStore(subscribeDomain, getDomainRevision);
  const [selectedId, setSelectedId] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewPayload, setPreviewPayload] = useState<Record<string, unknown> | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [loadedKey, setLoadedKey] = useState('');
  const [busy, setBusy] = useState(false);
  const directory = store.projectDir;
  const previewKey = `${directory}:${selectedId}`;
  const snapshots = projectSnapshotStore.snapshots;
  const selectedSnapshot = snapshots.find(snapshot => snapshot.id === selectedId);

  useEffect(() => {
    if (!open) return;
    void loadProjectSnapshotList(store.projectDir);
  }, [open, directory]);

  useEffect(() => {
    if (!open) {
      setSelectedId('');
      setPreview(null);
    }
  }, [open]);

  useEffect(() => { setSelectedId(''); }, [directory]);

  useEffect(() => {
    if (open && !projectSnapshotStore.loading && snapshots.length && !snapshots.some(snapshot => snapshot.id === selectedId)) {
      setSelectedId(snapshots[0]?.id || '');
    }
  }, [open, snapshots, selectedId, projectSnapshotStore.loading]);

  useEffect(() => {
    setPreview(null);
    setPreviewPayload(null);
    setPreviewError(false);
    setLoadedKey('');
    setPreviewLoading(false);
    if (!open || !selectedId || selectedSnapshot?.degraded) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    void readProjectSnapshot(directory, selectedId).then((payload) => {
      if (cancelled) return;
      setPreview(payload ? snapshotPreview(payload) : null);
      setPreviewPayload(payload);
      setLoadedKey(`${directory}:${selectedId}`);
      setPreviewError(!payload);
    }).catch(() => { if (!cancelled) setPreviewError(true); })
      .finally(() => { if (!cancelled) setPreviewLoading(false); });
    return () => { cancelled = true; };
  }, [open, selectedId, directory, selectedSnapshot?.degraded]);

  function confirmRestore(snapshotId: string) {
    if (loadedKey !== previewKey || !previewPayload) return;
    modal.confirm({
      title: t('project.version.restoreConfirmTitle'),
      content: t('project.version.restoreConfirmBody'),
      okText: t('project.version.restore'),
      cancelText: t('project.version.cancel'),
      onOk: async () => {
        if (store.projectDir !== directory) return;
        setBusy(true);
        try {
          const result = await restoreProjectFromSnapshot(snapshotId);
          if (result.ok) {
            setSelectedId('');
            setPreview(null);
            onClose();
          } else {
            modal.error({
              title: t('project.version.restoreFailedTitle'),
              content: t('project.version.restoreFailed', { reason: result.reason }),
            });
          }
        } finally {
          setBusy(false);
        }
      },
    });
  }

  return (
    <Drawer
      title={t('project.version.title')}
      placement="right"
      width={900}
      className="version-history-drawer"
      // 确认弹窗属于 antd 浮层（560），Drawer 必须压在其下，否则「恢复」确认会被抽屉挡住。
      zIndex={520}
      open={open}
      onClose={onClose}
      destroyOnHidden
    >
      {projectSnapshotStore.error && <p className="version-history-error" role="alert">{projectSnapshotStore.error}</p>}
      {projectSnapshotStore.loading ? <div className="version-history-empty"><Spin /><p role="status">{t('project.version.loading')}</p></div> : !snapshots.length ? (
        <EmptyState icon="clock" text={t('project.version.empty')} />
      ) : <div className="version-history-grid">
        <aside className="version-history-sidebar" aria-label={t('project.version.title')}>
          <div className="version-history-section-title"><span>{t('project.version.saved')}</span><span>{snapshots.length}</span></div>
          <div className="version-history-list">
            {snapshots.map((snapshot, index) => {
              const date = new Date(snapshot.createdAt);
              const day = date.toLocaleDateString(getLocale(), { year: 'numeric', month: 'long', day: 'numeric' });
              const previousDay = index ? new Date(snapshots[index - 1]!.createdAt).toDateString() : '';
              return <Fragment key={snapshot.id || snapshot.createdAt}>
              {date.toDateString() !== previousDay && <div className="version-history-date">{day}</div>}
              <button type="button" key={snapshot.id || snapshot.createdAt}
                disabled={busy || !snapshot.id}
                aria-pressed={snapshot.id === selectedId}
                className={`version-history-row${snapshot.id === selectedId ? ' is-selected' : ''}`}
                onClick={() => setSelectedId(snapshot.id || '')}>
                <time dateTime={snapshot.createdAt}>{date.toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit', hour12: false })}</time>
                <span className="version-history-reason">{snapshot.degraded ? t('project.version.degraded') : t(REASON_LABEL[String(snapshot.reason || 'auto')] || 'project.version.reason.auto')}</span>
              </button>
              </Fragment>;
            })}
          </div>
        </aside>
        <section className="version-history-preview" aria-busy={previewLoading}>
          <div className="version-history-preview-head">
            <div><h3>{selectedSnapshot ? formatTime(selectedSnapshot.createdAt) : t('project.version.canvasPreview')}</h3>
              <p className="version-history-meta">
                {selectedSnapshot && <span>{t(REASON_LABEL[String(selectedSnapshot.reason || 'auto')] || 'project.version.reason.auto')} · {Math.max(1, Math.round((selectedSnapshot.payloadBytes || 0) / 1024))} KB</span>}
                {preview && loadedKey === previewKey && <span>{t('project.version.counts', { nodes: preview.nodeCount, edges: preview.edgeCount })}</span>}
              </p>
            </div>
            <span className="version-history-readonly" title={t('project.version.hint')}>{t('project.version.readOnly')}</span>
          </div>
          <div className="version-history-preview-body">
            {previewLoading && <div className="version-history-empty"><Spin /><p role="status">{t('project.version.previewLoading')}</p></div>}
            {previewError && <div className="version-history-empty" role="alert"><EmptyState icon="file" text={t('project.version.previewError')} /></div>}
            {selectedSnapshot?.degraded && <div className="version-history-empty"><EmptyState icon="archive" text={t('project.version.degraded')} /></div>}
            {!selectedSnapshot?.degraded && !preview && !previewLoading && !previewError && <div className="version-history-empty"><EmptyState icon="clock" text={t('project.version.select')} /></div>}
            {preview && loadedKey === previewKey && <>
              {previewPayload && <ProjectSnapshotCanvas key={`${directory}:${selectedId}`} payload={previewPayload} />}
              <details className="version-history-node-details">
                <summary>{t('project.version.nodeList')}</summary>
                <ol className="version-history-nodes">{preview.nodes.map(node => <li key={node.id}>{node.title || node.id}</li>)}</ol>
                {preview.truncated && <p className="version-history-hint">{t('project.version.truncated')}</p>}
              </details>
            </>}
          </div>
          <footer className="version-history-footer">
            <span title={t('project.version.hint')}>{t('project.version.backupNotice')}</span>
            <Button type="primary" loading={busy} disabled={!preview || loadedKey !== previewKey || !previewPayload || previewLoading || Boolean(selectedSnapshot?.degraded)} onClick={() => selectedId && confirmRestore(selectedId)}>
              <IconSymbol name="refresh" />{t('project.version.restore')}
            </Button>
          </footer>
        </section>
      </div>}
    </Drawer>
  );
}
