import { statusLabel, statusTone } from '@/domain/tasks/TaskStatus';
import { t } from '@/i18n';
import { Fragment, memo, useContext, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Handle, Position, useStoreApi, useUpdateNodeInternals } from '@xyflow/react';
import { createPortal } from 'react-dom';
import { App, Button, Dropdown, InputNumber, Modal, Select, Tooltip } from 'antd';
import { IconSymbol } from '../components/IconSymbol';
import { StoryboardAssetChips, StoryboardAssetPicker } from './StoryboardAssetPicker';
import { CanvasNodeLabelRootContext, type WorkflowNodeRenderer } from './WorkflowCanvas';
import { store, touchProject } from '../../store/projectStore';
import { getDomainRevision, subscribeDomain } from '../../store/domainReactivity';
import { getAvailableModelIdsByType } from '../../store/settingsStore';
import { modelCatalog } from '../../domain/catalog/ModelCatalog';
import {
  addStoryboardShot,
  cancelStoryboardRun,
  createStoryboardOutputNodes,
  isStoryboardRunActive,
  removeStoryboardShot,
  runStoryboardScriptGeneration,
  runStoryboardShots,
  retryStoryboardBatch,
  storyboardBatch,
  setStoryboardGenerationSettings,
  storyboardShots,
  storyboardReadyVideos,
  storyboardGenerationTargets,
  storyboardFinalVideo,
  storyboardAssetMedia,
  storyboardShotAssetBindings,
  updateStoryboardShot,
} from '@/services/storyboardScriptService';
import { MAX_STORYBOARD_SHOTS, STORYBOARD_CONTEXT_HANDLE, storyboardRowHandle, storyboardShotSummary, type StoryboardShot, type StoryboardOutputKind } from '@/domain/graph/StoryboardScript';
import { StoryboardPromptInput } from './StoryboardPromptInput';
import { StoryboardMergeDialog } from './StoryboardMergeDialog';
import { StoryboardScriptEditor } from './StoryboardScriptEditor';

type AnyRecord = Record<string, any>;

const pendingPortMeasurements = new WeakMap<ReturnType<typeof useStoreApi>['getState'], Set<string>>();

function queuePortMeasurement(
  getState: ReturnType<typeof useStoreApi>['getState'],
  update: ReturnType<typeof useUpdateNodeInternals>,
  nodeId: string,
) {
  const pending = pendingPortMeasurements.get(getState);
  if (pending) {
    pending.add(nodeId);
    return;
  }
  const ids = new Set([nodeId]);
  pendingPortMeasurements.set(getState, ids);
  // React Flow recalculates absolute positions across the graph on each call.
  // Submit all storyboard ports affected by this layout together.
  queueMicrotask(() => {
    pendingPortMeasurements.delete(getState);
    update([...ids]);
  });
}

function nodeById(nodeId: string): AnyRecord | null {
  if (!nodeId) return null;
  return (store.project.nodes as AnyRecord[]).find((node) => node.id === nodeId) || null;
}

function readyOutput(shot: StoryboardShot, kind: 'image' | 'video') {
  const output = nodeById(kind === 'image' ? shot.imageNodeId : shot.videoNodeId);
  return Boolean(output && storyboardAssetMedia(output) === kind);
}

function PipelineDot({ tone }: { tone: string }) {
  return <i className={`storyboard-pipeline-dot tone-${tone}`} aria-hidden="true" />;
}

function batchStatusLabel(status: string): string {
  if (status === 'waiting') return t('canvas.storyboard.batchWaiting');
  if (status === 'submitting') return t('canvas.storyboard.batchSubmitting');
  return statusLabel(status);
}

export const StoryboardScriptNode: WorkflowNodeRenderer = memo(({ node, selected, actions }) => {
  // 画布节点对象就地更新，只有订阅 revision 才能在生成回执写入后重画镜头行。
  useSyncExternalStore(subscribeDomain, getDomainRevision);
  const { modal, message } = App.useApp();
  const data = node as AnyRecord;
  const labelRoot = useContext(CanvasNodeLabelRootContext);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [assetShotId, setAssetShotId] = useState<string | null>(null);
  const shots = storyboardShots(data);
  const summary = storyboardShotSummary(shots);
  const rowsRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const [rowsHeight, setRowsHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const updateNodeInternals = useUpdateNodeInternals();
  const { getState } = useStoreApi();
  const rowKey = shots.map((shot) => shot.id).join(',');
  useLayoutEffect(() => {
    const rows = rowsRef.current;
    if (!rows) return;
    const observer = new ResizeObserver(() => {
      setRowsHeight(rows.clientHeight);
      queuePortMeasurement(getState, updateNodeInternals, node.id);
    });
    observer.observe(rows);
    if (composerRef.current) observer.observe(composerRef.current);
    return () => observer.disconnect();
  }, [getState, node.id, updateNodeInternals]);
  useLayoutEffect(() => {
    queuePortMeasurement(getState, updateNodeInternals, node.id);
  }, [getState, node.id, rowKey, rowsHeight, scrollTop, updateNodeInternals]);
  const busy = data.status === 'running' || data.status === 'queued';
  const error = String(data.error || data.storyboardParseError || '');
  const source = String(data.prompt || '');
  const assetShot = shots.find((shot) => shot.id === assetShotId);
  const textModels = getAvailableModelIdsByType('textGeneration');
  const currentModel = textModels.find((model) => model === data.model) || textModels[0] || '';
  const countValue = Number(data.storyboardShotCount) > 0 ? Number(data.storyboardShotCount) : 'auto';
  const durationValue = Number(data.storyboardShotDuration) > 0 ? Number(data.storyboardShotDuration) : 'auto';
  const batch = storyboardBatch(data);
  const batchByShot = new Map(batch?.items.map((item) => [item.shotId, item]));
  const batchCount = (status: string) => batch?.items.filter((item) => item.status === status).length ?? 0;
  const batchSummary = batch ? t('canvas.storyboard.batchSummary', {
    done: batchCount('completed'), total: batch.items.length, failed: batchCount('failed'), waiting: batchCount('waiting'),
    running: batchCount('submitting') + batchCount('queued') + batchCount('running'), stopped: batchCount('cancelled'),
  }) : '';
  const running = isStoryboardRunActive(String(node.id));
  const imageShots = shots.filter((shot) => {
    const output = nodeById(shot.imageNodeId);
    return output && !output.archived;
  });
  const videoShots = shots.filter((shot) => {
    const output = nodeById(shot.videoNodeId);
    return output && !output.archived;
  });
  const readyImages = shots.filter((shot) => readyOutput(shot, 'image')).length;
  const readyVideos = storyboardReadyVideos(shots).length;
  const finalVideo = storyboardFinalVideo(String(node.id));
  const videoMode = data.storyboardVideoInputMode === 'keyframe' ? 'keyframe' : 'direct';
  const pipelineDisabled = !shots.length || busy || running || Boolean(data.locked);
  const actionBoardCount = storyboardGenerationTargets(data, shots, 'actionBoard').filter(({ state }) => state === 'ready').length;

  const title = String(data.title || t('canvas.storyboard.title'));
  function saveTitle() {
    const value = titleDraft?.trim();
    if (value && value !== title && !data.locked) actions.update(String(node.id), { title: value, titleOverride: value });
    setTitleDraft(null);
  }
  const label = (
    <div className="work-node-kicker">
      <IconSymbol className="work-node-type-icon" name="clapperboard" aria-hidden="true" />
      {titleDraft === null ? (
        <>
          <span className="work-node-title nodrag nopan" title={title}>{title}</span>
          <button type="button" className="nodrag nopan" disabled={Boolean(data.locked)} aria-label={t('canvas.storyboard.renameNode')}
            onClick={(event) => { event.stopPropagation(); setTitleDraft(title); }}>
            <IconSymbol name="pencil" />
          </button>
        </>
      ) : (
        <input className="work-node-title-input nodrag nopan" autoFocus aria-label={t('canvas.storyboard.renameNode')}
          value={titleDraft} onFocus={(event) => event.currentTarget.select()}
          onPointerDown={(event) => event.stopPropagation()} onChange={(event) => setTitleDraft(event.target.value)} onBlur={saveTitle}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
            if (event.key === 'Escape') { event.preventDefault(); setTitleDraft(null); }
          }} />
      )}
    </div>
  );

  const select = () => actions.select(String(node.id));

  function updatePrompt(value: string) {
    data.prompt = value;
    touchProject({ sessionDelay: 250, coalesceSession: true });
  }

  function commitShot(shotId: string, patch: Parameters<typeof updateStoryboardShot>[2]) {
    updateStoryboardShot(String(node.id), shotId, patch);
  }

  function submit() {
    if (!source.trim() || !currentModel || busy || sending || data.locked) return;
    const go = () => {
      setSending(true);
      try {
        if (!data.model || data.model !== currentModel) setStoryboardGenerationSettings(String(node.id), { model: currentModel });
        const task = runStoryboardScriptGeneration(String(node.id));
        if (task) message.success(t('canvas.storyboard.aiStarted'));
      } finally {
        setSending(false);
      }
    };
    if (!shots.length) return go();
    modal.confirm({
      title: t('canvas.storyboard.replaceConfirmTitle'),
      content: t('canvas.storyboard.replaceConfirmBody'),
      okText: t('canvas.storyboard.replaceConfirmOk'),
      cancelText: t('canvas.storyboard.cancel'),
      onOk: go,
    });
  }

  function confirmMediaGeneration(kind: StoryboardOutputKind) {
    modal.confirm({
      title: t(kind === 'actionBoard' ? 'canvas.storyboard.actionBoards' : kind === 'image' ? 'canvas.storyboard.generateImages' : 'canvas.storyboard.generateVideos'),
      content: kind === 'actionBoard' ? t('canvas.storyboard.confirmActionBoards', { count: actionBoardCount }) : t('canvas.storyboard.confirmMediaGeneration'),
      okText: t('canvas.storyboard.generate'),
      cancelText: t('canvas.storyboard.cancel'),
      onOk: () => { void runStoryboardShots(String(node.id), kind); },
    });
  }

  function confirmRetry(shotId?: string) {
    if (!batch || running || busy) return;
    modal.confirm({
      title: t(shotId ? 'canvas.storyboard.batchRetryOne' : 'canvas.storyboard.batchRetry'),
      content: t('canvas.storyboard.batchRetryConfirm'),
      okText: t('canvas.storyboard.generate'),
      cancelText: t('canvas.storyboard.cancel'),
      onOk: () => { void retryStoryboardBatch(String(node.id), batch.id, shotId); },
    });
  }

  function confirmBatchStop() {
    modal.confirm({
      title: t('canvas.storyboard.batchStop'),
      content: t('canvas.storyboard.batchStopConfirm'),
      okText: t('canvas.storyboard.batchStop'),
      cancelText: t('canvas.storyboard.cancel'),
      onOk: () => cancelStoryboardRun(String(node.id)),
    });
  }

  const pipeline = [
    { key: 'script', label: t('canvas.storyboard.pipeline.script'), tone: shots.length ? 'done' : 'idle', hint: t('canvas.storyboard.pipeline.shots', { count: shots.length }) },
    { key: 'images', label: t('canvas.storyboard.pipeline.images'), tone: readyImages ? 'done' : shots.length ? 'current' : 'idle', hint: t('canvas.storyboard.pipeline.ready', { done: readyImages, total: shots.length }) },
    { key: 'videos', label: t('canvas.storyboard.pipeline.videos'), tone: readyVideos ? 'done' : shots.length ? 'current' : 'idle', hint: t('canvas.storyboard.pipeline.ready', { done: readyVideos, total: shots.length }) },
    { key: 'merge', label: t('canvas.storyboard.pipeline.merge'), tone: finalVideo ? 'done' : readyVideos >= 2 ? 'current' : 'idle', hint: finalVideo ? t('canvas.storyboard.mergeReady') : readyVideos >= 2 ? t('canvas.storyboard.mergeCount', { count: readyVideos }) : t('canvas.storyboard.mergeNeedVideos') },
  ];

  return (
    <div
      className={`storyboard-script-node${selected ? ' selected' : ''}`}
      data-storyboard-script={node.id}
      onClick={(event) => { event.stopPropagation(); select(); }}
    >
      {labelRoot ? createPortal(label, labelRoot) : null}
      <div className="storyboard-node-head">
        <IconSymbol className="storyboard-node-icon" name="clapperboard" />
        <div className="storyboard-node-title-block">
          <strong title={title}>{title}</strong>
        </div>
        {batchSummary ? <span className="storyboard-batch-summary" title={batchSummary} aria-live="polite">{batchSummary}</span> : null}
        <span className="storyboard-node-summary">{t('canvas.storyboard.summary', { count: summary.count, seconds: summary.totalDuration })}</span>
        <div className="storyboard-node-head-actions nodrag">
          <Tooltip title={t('canvas.storyboard.fullscreen')}>
            <Button size="small" type="text" aria-label={t('canvas.storyboard.fullscreen')} onClick={() => setEditorOpen(true)}>
              <IconSymbol name="maximize" />
            </Button>
          </Tooltip>
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                { key: 'generate-images', label: t('canvas.storyboard.generateImages'), disabled: pipelineDisabled || readyImages === shots.length, onClick: () => confirmMediaGeneration('image') },
                { key: 'generate-videos', label: t('canvas.storyboard.generateVideos'), disabled: pipelineDisabled || readyVideos === shots.length, onClick: () => confirmMediaGeneration('video') },
                { type: 'divider' },
                {
                  key: 'video-input', label: t('canvas.storyboard.videoInputMode'), disabled: running,
                  children: (['direct', 'keyframe'] as const).map((mode) => ({
                    key: mode,
                    label: t(`canvas.storyboard.videoMode.${mode}`),
                    icon: videoMode === mode ? <IconSymbol name="check" /> : undefined,
                    onClick: () => setStoryboardGenerationSettings(String(node.id), { videoInputMode: mode }),
                  })),
                },
                { type: 'divider' },
                { key: 'create-images', label: t('canvas.storyboard.createImages', { count: shots.length - imageShots.length }), disabled: pipelineDisabled || imageShots.length === shots.length, onClick: () => createStoryboardOutputNodes(String(node.id), 'image') },
                { key: 'create-videos', label: t('canvas.storyboard.createVideos', { count: shots.length - videoShots.length }), disabled: pipelineDisabled || videoShots.length === shots.length, onClick: () => createStoryboardOutputNodes(String(node.id), 'video') },
                { key: 'action-boards', label: t('canvas.storyboard.actionBoards'), disabled: pipelineDisabled || !actionBoardCount, onClick: () => confirmMediaGeneration('actionBoard') },
                { key: 'merge', label: t('canvas.storyboard.pipeline.merge'), disabled: readyVideos < 2, onClick: () => setMergeOpen(true) },
                ...(finalVideo ? [{ key: 'final', label: t('canvas.storyboard.locateFinal'), onClick: () => actions.select(finalVideo.id) }] : []),
                ...(batch ? [
                  { type: 'divider' as const },
                  { key: 'retry', label: t('canvas.storyboard.batchRetry'), disabled: busy || running || !batch.items.some((item) => item.retryable), onClick: () => confirmRetry() },
                  { key: 'stop', label: t('canvas.storyboard.batchStop'), disabled: !batchCount('waiting'), onClick: confirmBatchStop },
                  { key: 'details', label: t('canvas.storyboard.batchDetails'), onClick: () => setBatchOpen(true) },
                ] : []),
              ],
            }}
          >
            <Button size="small" type="text" aria-label={t('canvas.storyboard.more')}><IconSymbol name="more" /></Button>
          </Dropdown>
        </div>
      </div>
      <div className="storyboard-pipeline" role="list" aria-label={t('canvas.storyboard.pipeline.label')}>
        {pipeline.map((item, index) => (
          <Fragment key={item.key}>
            {index > 0 ? <span className="storyboard-pipeline-line" aria-hidden="true" /> : null}
            <span role="listitem" className={`storyboard-pipeline-step tone-${item.tone}`} title={item.hint}>
              <PipelineDot tone={item.tone} />
              {item.label}
            </span>
          </Fragment>
        ))}
      </div>

      <div className="storyboard-table" role="table" aria-label={t('canvas.storyboard.tableLabel')}>
        <div className="storyboard-table-row storyboard-table-row--head" role="row">
          <span role="columnheader">{t('canvas.storyboard.column.shot')}</span>
          <span role="columnheader">{t('canvas.storyboard.column.duration')}</span>
          <span role="columnheader">{t('canvas.storyboard.column.videoPrompt')}</span>
          <span role="columnheader">{t('canvas.storyboard.column.dialogueFull')}</span>
          <span role="columnheader">{t('canvas.storyboard.column.assets')}</span>
        </div>
        <div className="storyboard-row-area">
          <div ref={rowsRef} className="storyboard-row-scroll nowheel nodrag" onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
            {shots.length ? shots.map((shot) => {
              const shotReferences = storyboardShotAssetBindings(String(node.id), shot);
              const batchItem = batchByShot.get(shot.id);
              return (
                <div className="storyboard-table-row" role="row" key={shot.id}>
                  <span role="cell" className="storyboard-shot-number">
                    {shot.shotNumber}
                    <Dropdown trigger={['click']} menu={{ items: [{
                      key: 'delete', label: t('canvas.storyboard.remove'), danger: true, disabled: shots.length <= 1,
                      onClick: () => removeStoryboardShot(String(node.id), shot.id),
                    }] }}>
                      <Button type="text" size="small" className="nodrag" aria-label={t('canvas.storyboard.shotLabel', { index: shot.shotNumber })}>
                        <IconSymbol name="more" />
                      </Button>
                    </Dropdown>
                    {batchItem ? <span className="storyboard-batch-row-state" title={batchStatusLabel(batchItem.status)}>{batchStatusLabel(batchItem.status)}</span> : null}
                  </span>
                  <span role="cell" className="storyboard-duration-cell">
                    <InputNumber
                      className="nodrag"
                      variant="borderless"
                      controls={false}
                      min={1}
                      max={60}
                      value={shot.durationSeconds}
                      aria-label={t('canvas.storyboard.column.duration')}
                      onChange={(value) => {
                        if (value !== null) commitShot(shot.id, { durationSeconds: value });
                      }}
                    />
                    {t('canvas.storyboard.secondsUnit')}
                  </span>
                  <span role="cell">
                    <textarea className="nodrag nowheel" value={shot.videoPrompt} aria-label={t('canvas.storyboard.column.videoPrompt')} placeholder={t('canvas.storyboard.videoPromptPlaceholder')} onChange={(event) => commitShot(shot.id, { videoPrompt: event.target.value })} />
                  </span>
                  <span role="cell">
                    <textarea className="nodrag nowheel" value={shot.dialogue} aria-label={t('canvas.storyboard.column.dialogueFull')} placeholder={t('canvas.storyboard.dialoguePlaceholder')} onChange={(event) => commitShot(shot.id, { dialogue: event.target.value })} />
                  </span>
                  <span role="cell" className="storyboard-assets-cell">
                    <StoryboardAssetChips nodeId={String(node.id)} shot={shot} />
                    <Button className="storyboard-asset-add nodrag" size="small" type="dashed" aria-label={t('canvas.storyboard.selectAssets')} onClick={(event) => {
                      event.stopPropagation();
                      setAssetShotId(shot.id);
                    }}>＋{shotReferences.length ? '' : ` ${t('canvas.storyboard.selectAssets')}`}</Button>
                  </span>
                </div>
              );
            }) : (
              <button
                type="button"
                className="storyboard-empty"
                onClick={() => addStoryboardShot(String(node.id))}
              >
                <strong>＋ {t('canvas.storyboard.addFirst')}</strong>
                <span>{t('canvas.storyboard.emptyHint')}</span>
              </button>
            )}
          </div>
          {shots.map((shot, index) => {
            const rowCenter = index * 48 + 24 - scrollTop;
            const visible = rowCenter >= 4 && rowCenter <= rowsHeight - 4;
            const top = Math.max(4, Math.min(rowsHeight - 4, rowCenter));
            return (
              <Fragment key={shot.id}>
                <Handle type="target" id={storyboardRowHandle(shot.id, 'in')} position={Position.Left}
                  className="storyboard-port nodrag" isConnectable={visible} style={{ top, visibility: visible ? 'visible' : 'hidden' }} />
                <Handle type="source" id={storyboardRowHandle(shot.id, 'out')} position={Position.Right}
                  className="storyboard-port nodrag" isConnectable={visible} style={{ top, visibility: visible ? 'visible' : 'hidden' }} />
              </Fragment>
            );
          })}
        </div>
      </div>
      <div className="storyboard-add-row nodrag">
        <Button type="text" onClick={() => addStoryboardShot(String(node.id))} disabled={shots.length >= MAX_STORYBOARD_SHOTS}>
          + {t('canvas.storyboard.addShot')}
        </Button>
      </div>
      <div ref={composerRef} className="storyboard-composer nodrag nowheel">
        <Handle id={STORYBOARD_CONTEXT_HANDLE} type="target" position={Position.Left} className="storyboard-port nodrag" title={t('canvas.storyboard.contextConnection')} />
        <StoryboardPromptInput nodeId={String(node.id)} value={source} disabled={Boolean(data.locked)}
          onChange={updatePrompt} onSubmit={submit} />
        <div className="storyboard-composer-actions">
          <Select
            className="storyboard-model-select"
            classNames={{ popup: { root: 'storyboard-composer-menu' } }}
            popupMatchSelectWidth={false}
            value={currentModel || undefined}
            placeholder={t('canvas.storyboard.selectModel')}
            options={textModels.map((model) => ({ value: model, label: modelCatalog.getModelInfo(model)?.name || model }))}
            onChange={(value) => { if (value) setStoryboardGenerationSettings(String(node.id), { model: value }); }}
            showSearch
            optionFilterProp="label"
          />
          <Select
            value={countValue}
            disabled={busy}
            className="storyboard-count-select"
            classNames={{ popup: { root: 'storyboard-composer-menu' } }}
            popupMatchSelectWidth={false}
            options={[
              { value: 'auto', label: t('canvas.storyboard.autoSplit') },
              ...Array.from({ length: 10 }, (_, index) => ({ value: index + 1, label: t('canvas.storyboard.shotCount', { count: index + 1 }) })),
            ]}
            onChange={(value) => setStoryboardGenerationSettings(String(node.id), { shotCount: value === 'auto' ? 'auto' : Number(value) })}
          />
          <Select
            value={durationValue}
            disabled={busy}
            className="storyboard-duration-select"
            classNames={{ popup: { root: 'storyboard-composer-menu' } }}
            popupMatchSelectWidth={false}
            options={[
              { value: 'auto', label: t('canvas.storyboard.durationAuto') },
              ...[5, 10, 15, 30].map((value) => ({ value, label: t('canvas.storyboard.durationValue', { seconds: value }) })),
            ]}
            onChange={(value) => setStoryboardGenerationSettings(String(node.id), { shotDuration: value === 'auto' ? 'auto' : Number(value) })}
          />
          <Button
            className="storyboard-send"
            type="default"
            shape="circle"
            aria-label={t('canvas.storyboard.submit')}
            loading={busy || sending}
            disabled={!source.trim() || !currentModel || busy || sending || Boolean(data.locked)}
            onClick={submit}
          ><IconSymbol name="send" /></Button>
        </div>
      </div>
      <Modal open={batchOpen && Boolean(batch)} title={t('canvas.storyboard.batchDetails')} onCancel={() => setBatchOpen(false)} footer={null} centered>
        {batch ? (
          <div className="storyboard-batch-details">
            <p>{t(batch.kind === 'actionBoard' ? 'canvas.storyboard.actionBoard' : batch.kind === 'image' ? 'canvas.storyboard.pipeline.images' : 'canvas.storyboard.pipeline.videos')} · {batchSummary}</p>
            <ul>
              {batch.items.map((item) => (
                <li key={item.shotId}>
                  <span>{t('canvas.storyboard.shotLabel', { index: shots.find((shot) => shot.id === item.shotId)?.shotNumber ?? item.shotNumber })}</span>
                  <div>
                    <span className={`status-${statusTone(item.status)}`}>{batchStatusLabel(item.status)}</span>
                    {item.attempts > 1 ? <span> · {t('canvas.storyboard.batchAttempts', { count: item.attempts })}</span> : null}
                    {item.error ? <div className="storyboard-batch-error">{item.error}</div> : null}
                  </div>
                  {item.retryable ? <Button type="text" size="small" disabled={busy || running} onClick={() => confirmRetry(item.shotId)}>{t('canvas.storyboard.batchRetryOne')}</Button> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Modal>
      {mergeOpen ? <StoryboardMergeDialog nodeId={String(node.id)} onClose={() => setMergeOpen(false)} /> : null}
      {assetShot ? <StoryboardAssetPicker key={assetShot.id} nodeId={String(node.id)} shot={assetShot} onClose={() => setAssetShotId(null)} /> : null}
      {error ? <div className="storyboard-script-error">{error}</div> : null}
      <StoryboardScriptEditor
        open={editorOpen}
        nodeId={String(node.id)}
        onClose={() => setEditorOpen(false)}
      />
    </div>
  );
});
