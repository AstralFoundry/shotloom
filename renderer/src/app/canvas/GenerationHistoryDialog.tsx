import { t } from '@/i18n';
import { Button, Modal } from 'antd';
import { useMemo, useState } from 'react';

import {
  listNodeGenerationHistory,
  reinsertGenerationHistory,
  type GenerationHistoryItem,
} from '../adapters/canvas/imageHistoryActions';
import { showToast } from '@/store/notificationStore';
import { IconSymbol } from '../components/IconSymbol';
import { useMediaPreviewCache } from './useMediaPreviewCache';

function HistoryThumb({ item }: { item: GenerationHistoryItem }) {
  const { url } = useMediaPreviewCache({
    path: item.path,
    kind: item.kind === 'text' ? 'text' : item.kind,
    mimeType: item.mimeType,
    maxSize: 480,
    fallbackUrl: item.previewUrl,
    revision: item.taskId,
  });
  if (item.kind === 'text') {
    return <div className="generation-history-text">{item.text.slice(0, 240)}</div>;
  }
  if (!url) {
    return (
      <div className="generation-history-empty-thumb">
        <IconSymbol name={item.kind === 'image' ? 'image' : item.kind === 'video' ? 'film' : 'waveform'} />
      </div>
    );
  }
  if (item.kind === 'video') {
    return <video className="generation-history-media" src={url} muted playsInline preload="metadata" />;
  }
  if (item.kind === 'audio') {
    return (
      <div className="generation-history-empty-thumb">
        <IconSymbol name="waveform" />
      </div>
    );
  }
  return <img className="generation-history-media" src={url} alt={item.title} />;
}

function HistoryCard({ item, busy, onInsert }: { item: GenerationHistoryItem; busy: boolean; onInsert: () => void }) {
  const created = item.createdAt ? new Date(item.createdAt) : null;
  const date = created && !Number.isNaN(created.getTime()) ? created.toLocaleString() : '';
  return (
    <article className="generation-history-card">
      <div className="generation-history-thumb"><HistoryThumb item={item} /></div>
      <div className="generation-history-meta">
        <span>{item.model || t('imageHistory.itemTitle')}</span>
        <span>{date}</span>
      </div>
      {item.kind !== 'text' && <p className="generation-history-prompt">{item.prompt || item.title}</p>}
      <div className="generation-history-actions">
        <Button size="small" type="primary" loading={busy} onClick={onInsert}>{t('imageHistory.insert')}</Button>
      </div>
    </article>
  );
}

export function GenerationHistoryDialog({ open, nodeId, onClose }: { open: boolean; nodeId: string; onClose: () => void }) {
  const items = useMemo(() => (open && nodeId ? listNodeGenerationHistory(nodeId) : []), [nodeId, open]);
  const [busyKey, setBusyKey] = useState('');
  function insert(item: GenerationHistoryItem) {
    const key = `${item.taskId}:${item.materialId}`;
    setBusyKey(key);
    const ok = reinsertGenerationHistory(nodeId, item.taskId, item.materialId);
    setBusyKey('');
    if (!ok) {
      showToast(t('imageHistory.error'), 'error');
      return;
    }
    onClose();
  }
  return (
    <Modal open={open} title={t('imageHistory.title')} footer={null} width={760} onCancel={onClose} destroyOnHidden>
      {items.length === 0 ? (
        <p className="generation-history-empty">{t('imageHistory.empty')}</p>
      ) : (
        <div className="generation-history-grid">
          {items.map((item) => (
            <HistoryCard
              key={`${item.taskId}:${item.materialId}`}
              item={item}
              busy={busyKey === `${item.taskId}:${item.materialId}`}
              onInsert={() => insert(item)}
            />
          ))}
        </div>
      )}
    </Modal>
  );
}
