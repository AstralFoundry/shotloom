import { useState, useSyncExternalStore } from 'react';
import { Checkbox, Modal } from 'antd';
import { t } from '@/i18n';
import { getDomainRevision, subscribeDomain } from '@/store/domainReactivity';
import { store } from '@/store/projectStore';
import { mergeCanvasVideos } from '@/services/canvasVideoMergeService';
import { storyboardReadyVideos, storyboardShots } from '@/services/storyboardScriptService';
import { NodeThumb } from './NodeThumb';

export function StoryboardMergeDialog({ nodeId, onClose, onMerged }: { nodeId: string; onClose: () => void; onMerged?: () => void }) {
  useSyncExternalStore(subscribeDomain, getDomainRevision);
  const node = (store.project.nodes as Array<Record<string, any>>).find((item) => item.id === nodeId && !item.archived);
  const shots = storyboardShots(node);
  const videos = storyboardReadyVideos(shots);
  const [selected, setSelected] = useState(() => videos.map((video) => String(video.node.id)));
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState('');
  const included = videos.filter((video) => selected.includes(video.node.id));

  async function merge() {
    if (merging || !node || included.length < 2) return;
    setMerging(true);
    setError('');
    try {
      await mergeCanvasVideos(included, nodeId);
      onClose();
      onMerged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('canvas.storyboard.mergeFailed'));
    } finally {
      setMerging(false);
    }
  }

  return (
    <Modal
      open
      centered
      width={520}
      title={t('canvas.storyboard.pipeline.merge')}
      okText={t('canvas.storyboard.mergeCount', { count: included.length })}
      cancelText={t('canvas.storyboard.cancel')}
      confirmLoading={merging}
      okButtonProps={{ disabled: !node || included.length < 2 }}
      cancelButtonProps={{ disabled: merging }}
      closable={!merging}
      maskClosable={!merging}
      keyboard={!merging}
      onCancel={onClose}
      onOk={() => void merge()}
    >
      <div className="storyboard-merge-dialog" onClick={(event) => event.stopPropagation()}>
        <p>{t('canvas.storyboard.mergeOrder', { count: videos.length, total: shots.length })}</p>
        <div className="storyboard-merge-list">
          {videos.map(({ node: video, shotNumber }) => {
            const id = String(video.id);
            return (
              <label key={id}>
                <Checkbox disabled={merging} checked={selected.includes(id)} onChange={(event) => setSelected((current) => (
                  event.target.checked ? [...current, id] : current.filter((item) => item !== id)
                ))} aria-label={t('canvas.storyboard.shotLabel', { index: shotNumber })} />
                <NodeThumb nodeId={id} mediaKind="video" className="storyboard-merge-thumb" />
                <span><strong>{t('canvas.storyboard.shotLabel', { index: shotNumber })}</strong>{String(video.title || '')}</span>
              </label>
            );
          })}
        </div>
        {error ? <p role="alert" className="storyboard-batch-error">{error}</p> : null}
      </div>
    </Modal>
  );
}
