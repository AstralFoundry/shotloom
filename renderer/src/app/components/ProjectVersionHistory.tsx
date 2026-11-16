/**
 * 项目版本记录抽屉。
 *
 * 预览只在组件内读取快照 payload，不写 store；恢复必须二次确认，
 * 且真正的替换由 `restoreProjectFromSnapshot` 负责（先备份再替换）。
 */
import { t, type MessageKey } from '@/i18n';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { App, Button, Drawer, List, Tag } from 'antd';
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
    setPreview(null);
    setPreviewPayload(null);
    setPreviewError(false);
    setLoadedKey('');
    setPreviewLoading(false);
    if (!open || !selectedId) {
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
  }, [open, selectedId, directory]);

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

  const snapshots = projectSnapshotStore.snapshots;

  return (
    <Drawer
      title={t('project.version.title')}
      placement="right"
      width={760}
      // 确认弹窗属于 antd 浮层（560），Drawer 必须压在其下，否则「恢复」确认会被抽屉挡住。
      zIndex={520}
      open={open}
      onClose={onClose}
      destroyOnHidden
    >
      <p className="version-history-hint">{t('project.version.hint')}</p>
      {projectSnapshotStore.loading && <p>{t('project.version.loading')}</p>}
      {!projectSnapshotStore.loading && !snapshots.length && (
        <EmptyState icon="clock" text={t('project.version.empty')} />
      )}
      <div className="version-history-grid">
        <List
          size="small"
          dataSource={snapshots}
          renderItem={(snapshot) => (
            <List.Item
              onClick={() => setSelectedId(snapshot.id || '')}
              className={snapshot.id === selectedId ? 'is-selected' : ''}
            >
              <div className="version-history-row">
                <strong>{formatTime(snapshot.createdAt)}</strong>
                <span className="version-history-meta">
                  <Tag>{t(REASON_LABEL[String(snapshot.reason || 'auto')] || 'project.version.reason.auto')}</Tag>
                  {snapshot.degraded && <Tag color="orange">{t('project.version.degraded')}</Tag>}
                  <small>{Math.max(1, Math.round((snapshot.payloadBytes || 0) / 1024))} KB</small>
                </span>
              </div>
            </List.Item>
          )}
        />
        <div className="version-history-preview">
          {previewLoading && <p role="status">{t('project.version.previewLoading')}</p>}
          {previewError && <p role="alert">{t('project.version.previewError')}</p>}
          {!preview && !previewLoading && !previewError && <p className="version-history-hint">{t('project.version.select')}</p>}
          {preview && loadedKey === previewKey && (
            <>
              {previewPayload && <ProjectSnapshotCanvas key={`${directory}:${selectedId}`} payload={previewPayload} />}
              <p className="version-history-hint">{t('project.version.previewHint')}</p>
              <p>
                {t('project.version.counts', {
                  nodes: preview.nodeCount,
                  edges: preview.edgeCount,
                })}
              </p>
              <ol className="version-history-nodes">
                {preview.nodes.map((node) => (
                  <li key={node.id}>
                    {node.title || node.id}
                    <small> · {node.type}</small>
                  </li>
                ))}
              </ol>
              {preview.truncated && <p className="version-history-hint">{t('project.version.truncated')}</p>}
              <Button
                type="primary"
                disabled={busy}
                onClick={() => selectedId && confirmRestore(selectedId)}
              >
                {t('project.version.restore')}
              </Button>
            </>
          )}
        </div>
      </div>
    </Drawer>
  );
}
