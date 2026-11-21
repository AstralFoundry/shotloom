import { useState } from 'react';
import { Button } from 'antd';
import { storyboardOutputFields, storyboardOutputMedia, type StoryboardShot, type StoryboardOutputKind } from '@/domain/graph/StoryboardScript';
import { isActiveTaskStatus, isFailedTaskStatus, statusLabel } from '@/domain/tasks/TaskStatus';
import { t } from '@/i18n';
import { storyboardAssetMedia, storyboardBatch, storyboardGenerationTargets, storyboardShotInputSources } from '@/services/storyboardScriptService';
import { store } from '@/store/projectStore';
import { IconSymbol } from '../components/IconSymbol';
import { StoryboardAssetPreview, StoryboardAssetThumb } from './StoryboardAssetPicker';

type NodeRecord = Record<string, any>;

export function StoryboardShotProduction({ script, shot, disabled, onEditAssets, onFocus, onGenerate, onRetry }: {
  script: NodeRecord;
  shot: StoryboardShot;
  disabled: boolean;
  onEditAssets: () => void;
  onFocus: (id: string) => void;
  onGenerate: (kind: StoryboardOutputKind, force: boolean) => void;
  onRetry: (batchId: string) => void;
}) {
  const [previewId, setPreviewId] = useState('');
  const nodes = store.project.nodes as NodeRecord[];
  const nodeById = (id: string) => nodes.find((node) => node.id === id && !node.archived);
  const keyframe = script.storyboardVideoInputMode === 'keyframe';
  const refs = storyboardShotInputSources(script, shot);
  const preview = nodeById(previewId);

  function renderOutput(kind: StoryboardOutputKind) {
    const node = nodeById(shot[storyboardOutputFields[kind]] || '');
    const mediaKind = storyboardOutputMedia(kind);
    const hasMedia = Boolean(node && storyboardAssetMedia(node) === mediaKind);
    const label = t(kind === 'actionBoard' ? 'canvas.storyboard.actionBoard' : kind === 'video' ? 'canvas.storyboard.shotVideo' : keyframe ? 'canvas.storyboard.firstFrame' : 'canvas.storyboard.image');
    const batch = storyboardBatch(script, kind);
    const item = batch?.kind === kind ? batch.items.find((candidate) => candidate.shotId === shot.id) : undefined;
    const target = storyboardGenerationTargets(script, [shot], kind, hasMedia)[0]?.state;
    const generating = target === 'busy';
    const failed = !generating && (item?.status === 'failed' || isFailedTaskStatus(node?.status));
    const status = generating
      ? item?.status === 'waiting' || item?.status === 'submitting'
        ? t(item.status === 'waiting' ? 'canvas.storyboard.batchWaiting' : 'canvas.storyboard.batchSubmitting')
        : statusLabel(String(isActiveTaskStatus(item?.status) ? item?.status : node?.status || 'running'))
      : failed ? t('canvas.storyboard.status.failed')
      : hasMedia ? t('canvas.storyboard.status.ready')
      : item?.status === 'cancelled' ? t('canvas.storyboard.status.cancelled')
      : t('canvas.storyboard.status.notGenerated');
    const error = failed ? String(item?.error || node?.error || '') : '';
    const hint = target === 'noPrompt'
      ? t(kind === 'video' ? 'canvas.storyboard.videoPromptNeeded' : 'canvas.storyboard.imagePromptNeeded')
      : target === 'missingKeyframe' ? t('canvas.storyboard.reviewFirstFrame')
      : target === 'uncertain' ? t('plugins.submissionUnknown')
      : !hasMedia && !generating ? t(kind === 'video' ? 'canvas.storyboard.videoProductionHint' : 'canvas.storyboard.imageProductionHint') : '';
    const retry = batch && item?.retryable && target === 'ready';

    return (
      <article key={kind} aria-label={label}>
        <header className="storyboard-production-heading">
          <strong><IconSymbol name={kind === 'video' ? 'film' : 'image'} /><span>{label}</span></strong>
          <span role="status" className={generating ? 'status-warn' : failed ? 'status-bad' : hasMedia ? 'status-good' : 'status-muted'}>{status}</span>
        </header>
        {hasMedia && node ? (
          <button type="button" className="storyboard-reading-preview"
            aria-label={t('canvas.storyboard.previewAsset', { title: label })}
            onClick={() => setPreviewId(node.id)}>
            <StoryboardAssetThumb nodeId={node.id} media={mediaKind} />
            <span><IconSymbol name={kind === 'video' ? 'play' : 'maximize'} /></span>
          </button>
        ) : null}
        {error ? <p className="storyboard-batch-error">{error}</p> : null}
        <div className="storyboard-production-foot">
          {hint ? <p className="storyboard-production-hint">{hint}</p> : null}
          <div className="storyboard-production-actions">
            <Button type={kind === 'video' ? 'primary' : 'default'}
              icon={<IconSymbol name={kind === 'video' ? 'film' : 'image'} />}
              disabled={disabled || target !== 'ready'}
              onClick={() => retry ? onRetry(batch.id) : onGenerate(kind, hasMedia)}>
              {t(retry ? 'canvas.storyboard.batchRetryOne' : hasMedia ? 'canvas.storyboard.regenerate'
                  : kind === 'video' ? 'canvas.storyboard.generateShotVideo'
                  : kind === 'image' ? 'canvas.storyboard.generateShotImage' : 'canvas.storyboard.generate')}
            </Button>
            {node ? (
              <Button type="text" icon={<IconSymbol name="arrow-up-right" />} onClick={() => onFocus(node.id)}>
                {t('canvas.storyboard.openCanvasOutput')}
              </Button>
            ) : null}
          </div>
        </div>
      </article>
    );
  }

  return (
    <section className="storyboard-reading-production" aria-label={t('canvas.storyboard.production', { index: shot.shotNumber })}>
      {renderOutput('video')}
      {renderOutput('image')}
      <article aria-label={t('canvas.storyboard.referencesTitle')}>
        <header className="storyboard-production-heading">
          <strong><span>{t('canvas.storyboard.referencesTitle')}</span><small>{refs.length}</small></strong>
          <Button size="small" type="text" disabled={disabled} onClick={onEditAssets}>{t('canvas.storyboard.editAssets')}</Button>
        </header>
        {refs.length ? <p className="storyboard-production-hint">{t('canvas.storyboard.referencesHint')}</p> : null}
        {!refs.length ? <p className="storyboard-production-hint">{t('canvas.storyboard.noAssets')}</p> : (
          <ul className="storyboard-production-references">
            {refs.map(({ id, node, role, via }) => {
              const media = node ? storyboardAssetMedia(node) : undefined;
              const title = String(node?.title || t('canvas.storyboard.missingAsset'));
              return (
                <li key={id}>
                  <button type="button" disabled={!media} aria-label={t('canvas.storyboard.previewAsset', { title })} onClick={() => setPreviewId(id)}>
                    <StoryboardAssetThumb nodeId={id} media={media} />
                  </button>
                  <div>
                    <strong>{title}</strong>
                    <span>{[role && t(`canvas.storyboard.assetRole.${role}`), ...via.map((source) => t(`canvas.storyboard.assetSource.${source}`))].filter(Boolean).join(' · ')}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </article>
      {renderOutput('actionBoard')}
      {preview ? <StoryboardAssetPreview node={preview} onClose={() => setPreviewId('')} /> : null}
    </section>
  );
}
