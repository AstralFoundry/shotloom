import { t } from '@/i18n';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { App, Button, Checkbox, Dropdown, Input, InputNumber, Modal, Popover, Segmented, Select } from 'antd';
import { IconSymbol } from '../components/IconSymbol';
import { SearchInput } from '../components/SearchInput';
import { getDomainRevision, subscribeDomain } from '@/store/domainReactivity';
import { store, touchProject } from '@/store/projectStore';
import { modelCatalog } from '@/domain/catalog/ModelCatalog';
import { getAvailableModelIdsByType } from '@/store/settingsStore';
import { MAX_STORYBOARD_SHOTS, type StoryboardShot, type StoryboardOutputKind } from '@/domain/graph/StoryboardScript';
import {
  addStoryboardShot,
  cancelStoryboardRun,
  moveStoryboardShot,
  removeStoryboardShot,
  runStoryboardScriptGeneration,
  runStoryboardShots,
  setStoryboardGenerationSettings,
  isStoryboardRunActive,
  storyboardShots,
  storyboardReadyVideos,
  storyboardAssetMedia,
  storyboardBatch,
  storyboardGenerationTargets,
  retryStoryboardBatch,
  storyboardShotReferenceIds,
  setStoryboardShotAssetBindings,
  storyboardShotAssetBindings,
  updateStoryboardShot,
} from '@/services/storyboardScriptService';

import { StoryboardMergeDialog } from './StoryboardMergeDialog';
import { StoryboardShotProduction } from './StoryboardShotProduction';
import { StoryboardAssetPicker } from './StoryboardAssetPicker';
import { NodeThumb } from './NodeThumb';
import { selectNode } from '@/store/nodeStore';

type AnyRecord = Record<string, any>;
type ShotField =
  | 'durationSeconds'
  | 'plot'
  | 'shotSize'
  | 'camera'
  | 'motion'
  | 'imagePrompt'
  | 'videoPrompt'
  | 'dialogue'
  | 'sound'
  | 'characters'
  | 'negativePrompt';

function nodeById(nodeId: string): AnyRecord | null {
  return (store.project.nodes as AnyRecord[]).find((node) => node.id === nodeId) || null;
}

function outputState(shot: AnyRecord, kind: 'image' | 'video') {
  const output = nodeById(String(kind === 'image' ? shot.imageNodeId : shot.videoNodeId));
  if (!output || output.archived) return { label: t('canvas.storyboard.status.notGenerated'), tone: 'muted', nodeId: '' };
  const status = storyboardAssetMedia(output) === kind ? 'completed' : String(output.status === 'completed' ? 'idle' : output.status || 'idle');
  const tone =
    status === 'completed'
      ? 'good'
      : status === 'running' || status === 'queued'
        ? 'warn'
        : status === 'failed' || status === 'timeout' || status === 'error'
          ? 'bad'
          : 'muted';
  const label =
    status === 'completed'
      ? t('canvas.storyboard.status.ready')
      : status === 'running' || status === 'queued'
        ? t('canvas.storyboard.status.running')
        : status === 'failed' || status === 'timeout' || status === 'error'
          ? t('canvas.storyboard.status.failed')
          : status === 'cancelled'
            ? t('canvas.storyboard.status.cancelled')
            : t('canvas.storyboard.status.idle');
  return { label, tone, nodeId: String(output.id) };
}

export function ShotTextInput({
  value,
  onCommit,
  label,
  multiline = false,
  minRows = 2,
  disabled = false,
}: {
  value: string;
  onCommit: (value: string) => void;
  label: string;
  multiline?: boolean;
  minRows?: number;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);
  const props = {
    value: draft,
    disabled,
    'aria-label': label,
    placeholder: label,
    onFocus: () => {
      focused.current = true;
    },
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setDraft(event.target.value);
      onCommit(event.target.value);
    },
    onBlur: () => {
      focused.current = false;
      setDraft(value);
    },
  };
  return multiline ? <Input.TextArea {...props} autoSize={{ minRows, maxRows: 14 }} /> : <Input {...props} />;
}

export function StoryboardScriptEditor({
  open,
  nodeId,
  onClose,
  autoOpenAi = false,
}: {
  open: boolean;
  nodeId: string;
  onClose: () => void;
  autoOpenAi?: boolean;
}) {
  useSyncExternalStore(subscribeDomain, getDomainRevision);
  const { message, modal } = App.useApp();
  const node = nodeById(nodeId);
  const batchCanStop = Boolean(storyboardBatch(node)?.items.some((item) => item.status === 'waiting'));
  const shots = storyboardShots(node);
  const references = new Map(shots.map((shot) => [shot.id, storyboardShotReferenceIds(nodeId, shot)]));
  const [aiOpen, setAiOpen] = useState(false);
  const [aiModel, setAiModel] = useState('');
  const [aiCount, setAiCount] = useState<number | 'auto'>('auto');
  const [aiExtra, setAiExtra] = useState('');
  const [aiDuration, setAiDuration] = useState<number | 'auto'>('auto');
  const [runningAll, setRunningAll] = useState<StoryboardOutputKind | ''>('');
  const [query, setQuery] = useState('');
  const [autoOpened, setAutoOpened] = useState(false);
  useEffect(() => {
    if (!open) {
      setAutoOpened(false);
      return;
    }
    if (!autoOpenAi || autoOpened || !node) return;
    setAutoOpened(true);
    const available = getAvailableModelIdsByType('textGeneration');
    setAiModel(available.find((model) => model === node.model) || available[0] || '');
    setAiCount(Number(node.storyboardShotCount) > 0 ? Number(node.storyboardShotCount) : 'auto');
    setAiDuration(Number(node.storyboardShotDuration) > 0 ? Number(node.storyboardShotDuration) : 'auto');
    setAiExtra(String(node.storyboardExtraRequirement || ''));
    setAiOpen(true);
  }, [open, autoOpenAi, autoOpened, node]);
  const [activeId, setActiveId] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [onlySelected, setOnlySelected] = useState(false);
  const detailRef = useRef<HTMLElement>(null);
  const [focusField, setFocusField] = useState('');
  const [mobileDetail, setMobileDetail] = useState(false);
  const [detailTab, setDetailTab] = useState('story');
  const [fullscreen, setFullscreen] = useState(true);
  const [visibleColumns, setVisibleColumns] = useState<string[]>(['plot', 'dialogue', 'assets']);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [assetShotId, setAssetShotId] = useState('');
  const assetShot = shots.find((shot) => shot.id === assetShotId);
  useEffect(() => {
    setQuery('');
    setActiveId('');
    setSelectedIds([]);
    setOnlySelected(false);
    setDetailTab('story');
    setMobileDetail(false);
    setAssetShotId('');
    setMergeOpen(false);
    setVisibleColumns(
      Array.isArray(node?.storyboardVisibleColumns) ? node.storyboardVisibleColumns : ['plot', 'dialogue', 'assets'],
    );
  }, [nodeId]);
  useEffect(() => {
    if (open) setFullscreen(true);
    else {
      setMobileDetail(false);
      setAiOpen(false);
      setAssetShotId('');
      setMergeOpen(false);
    }
  }, [open]);
  useEffect(() => {
    if (!open || !focusField) return;
    const frame = requestAnimationFrame(() => {
      detailRef.current?.querySelector<HTMLElement>(`[data-shot-field="${focusField}"] textarea, [data-shot-field="${focusField}"] input`)?.focus();
      setFocusField('');
    });
    return () => cancelAnimationFrame(frame);
  }, [open, activeId, detailTab, focusField]);
  if (!node) return null;
  const busy = node.status === 'running' || node.status === 'queued';
  const textModels = getAvailableModelIdsByType('textGeneration');
  const currentModel = textModels.find((model) => model === node.model) || textModels[0] || '';
  const totalDuration = shots.reduce((sum, shot) => sum + (Number(shot.durationSeconds) || 0), 0);

  function commit(field: ShotField, shotId: string, value: unknown) {
    updateStoryboardShot(nodeId, shotId, { [field]: value });
  }

  function startAi() {
    const replace = () => {
      setStoryboardGenerationSettings(nodeId, {
        model: aiModel || currentModel,
        shotCount: aiCount,
        shotDuration: aiDuration,
        extraRequirement: aiExtra.trim(),
      });
      const task = runStoryboardScriptGeneration(nodeId);
      if (task) {
        message.success(t('canvas.storyboard.aiStarted'));
        setAiOpen(false);
      }
    };
    if (!shots.length) return replace();
    modal.confirm({
      title: t('canvas.storyboard.replaceConfirmTitle'),
      content: t('canvas.storyboard.replaceConfirmBody'),
      okText: t('canvas.storyboard.replaceConfirmOk'),
      cancelText: t('canvas.storyboard.cancel'),
      onOk: replace,
    });
  }

  function confirmRun(kind: StoryboardOutputKind, ids: string[], force = false) {
    modal.confirm({
      title: t(force ? 'canvas.storyboard.regenerate' : kind === 'actionBoard' ? 'canvas.storyboard.actionBoards' : kind === 'image' ? 'canvas.storyboard.generateImages' : 'canvas.storyboard.generateVideos'),
      content: t('canvas.storyboard.confirmMediaGeneration'),
      okText: t('canvas.storyboard.generate'),
      cancelText: t('canvas.storyboard.cancel'),
      onOk: () => {
        if (!ids.length) return;
        setRunningAll(kind);
        void runStoryboardShots(nodeId, kind, ids, { force })
          .catch((cause) => message.error(cause instanceof Error ? cause.message : t('canvas.storyboard.batchSubmissionFailed')))
          .finally(() => setRunningAll(''));
      },
    });
  }

  const keyword = query.trim().toLowerCase();
  const keywordShots = shots.filter(
    (shot) =>
      !keyword ||
      [
        shot.shotNumber,
        shot.plot,
        shot.dialogue,
        shot.videoPrompt,
        shot.imagePrompt,
        shot.characters,
        ...(references.get(shot.id) || []).map((id) => nodeById(id)?.title),
      ]
        .join(' ')
        .toLowerCase()
        .includes(keyword),
  );
  const visibleShots = onlySelected ? keywordShots.filter((shot) => selectedIds.includes(shot.id)) : keywordShots;
  const active = shots.find((shot) => shot.id === activeId) || shots[0];
  const activeIndex = active ? shots.findIndex((shot) => shot.id === active.id) : -1;
  const selected = shots.filter((shot) => selectedIds.includes(shot.id));
  const imageTargets = storyboardGenerationTargets(node, selected, 'image');
  const videoTargets = storyboardGenerationTargets(node, selected, 'video');
  const imageIds = imageTargets.filter(({ state }) => state === 'ready').map(({ shot }) => shot.id);
  const videoIds = videoTargets.filter(({ state }) => state === 'ready').map(({ shot }) => shot.id);
  const missingKeyframes = videoTargets.filter(({ state }) => state === 'missingKeyframe').length;
  const anyUncertain = [...imageTargets, ...videoTargets].some(({ state }) => state === 'uncertain');
  const writeDisabled = busy || Boolean(node.locked);
  const generationBusy = Boolean(runningAll) || isStoryboardRunActive(nodeId);
  const columnOptions = [
    'plot',
    'dialogue',
    'assets',
    'duration',
    'shotSize',
    'camera',
    'motion',
    'imagePrompt',
    'videoPrompt',
    'sound',
    'characters',
  ];
  const columnLabels = {
    plot: t('canvas.storyboard.column.plot'),
    dialogue: t('canvas.storyboard.column.dialogueFull'),
    assets: t('canvas.storyboard.column.assets'),
    duration: t('canvas.storyboard.column.duration'),
    durationSeconds: t('canvas.storyboard.column.duration'),
    shotSize: t('canvas.storyboard.column.shotSize'),
    camera: t('canvas.storyboard.column.camera'),
    motion: t('canvas.storyboard.column.motion'),
    imagePrompt: t('canvas.storyboard.column.imagePrompt'),
    videoPrompt: t('canvas.storyboard.column.videoPrompt'),
    sound: t('canvas.storyboard.column.sound'),
    characters: t('canvas.storyboard.column.characters'),
    negativePrompt: t('canvas.storyboard.column.negativePrompt'),
  };
  const columnLabel = (key: string) => columnLabels[key as keyof typeof columnLabels] || key;
  function field(key: ShotField, minRows = 2) {
    if (!active) return null;
    return (
      <label className="storyboard-reading-field" key={key} data-shot-field={key}>
        <span>{columnLabel(key)}</span>
        <ShotTextInput
          key={`${active.id}:${key}`}
          value={String(active[key] ?? '')}
          label={columnLabel(key)}
          multiline
          minRows={minRows}
          disabled={writeDisabled}
          onCommit={(value) => commit(key, active.id, value)}
        />
      </label>
    );
  }
  function insertShot(copy = false) {
    const added = addStoryboardShot(nodeId, active?.id);
    if (!added) return;
    if (copy && active) {
      updateStoryboardShot(nodeId, added.id, active);
      setStoryboardShotAssetBindings(nodeId, added.id, storyboardShotAssetBindings(nodeId, active));
    }
    choose(added);
    setQuery('');
    setOnlySelected(false);
  }
  function choose(shot: StoryboardShot, column = 'plot') {
    setActiveId(shot.id);
    setMobileDetail(true);
    if (column !== 'assets') setFocusField(column);
    setDetailTab(
      column === 'assets' ? 'production' : column === 'imagePrompt' || column === 'videoPrompt' ? 'prompts' : 'story',
    );
  }
  function videoMode(value: string) {
    setStoryboardGenerationSettings(nodeId, { videoInputMode: value === 'keyframe' ? 'keyframe' : 'direct' });
  }
  const mode = String(node.storyboardVideoInputMode || 'direct');
  const videoModeSelect = (
    <Select
      aria-label={t('canvas.storyboard.videoMode')}
      value={mode}
      onChange={videoMode}
      disabled={writeDisabled || generationBusy}
      options={[
        { value: 'direct', label: t('canvas.storyboard.videoDirect') },
        { value: 'keyframe', label: t('canvas.storyboard.videoKeyframe') },
      ]}
    />
  );
  return (
    <>
      <Modal
        open={open}
        onCancel={onClose}
        footer={null}
        title={null}
        closable={false}
        destroyOnHidden
        keyboard={!fullscreen}
        width={fullscreen ? '100vw' : 'min(1480px, calc(100vw - 32px))'}
        centered={!fullscreen}
        className={`storyboard-reading-modal${fullscreen ? ' is-fullscreen' : ''}`}
        styles={{
          container: { padding: 0, ...(fullscreen ? { height: '100dvh', borderRadius: 0 } : {}) },
          body: { padding: 0 },
        }}
        style={fullscreen ? { top: 0, maxWidth: '100vw', paddingBottom: 0 } : {}}
      >
        <div
          className="storyboard-reading"
          onKeyDown={(event) => {
            if (
              event.key === 'Escape' &&
              fullscreen &&
              !aiOpen &&
              !assetShot &&
              !mergeOpen &&
              event.currentTarget.contains(event.target as Node) &&
              !(event.target as HTMLElement).closest('[aria-expanded="true"]')
            ) {
              event.stopPropagation();
              setFullscreen(false);
            }
          }}
        >
          <header className="storyboard-reading-header">
            <IconSymbol name="clapperboard" />
            <div>
              <h2>{String(node.title || t('canvas.storyboard.title'))}</h2>
              <p>
                {t('canvas.storyboard.summary', { count: shots.length, seconds: Math.round(totalDuration * 10) / 10 })}
              </p>
            </div>
            <div className="storyboard-reading-window">
              <Button disabled={storyboardReadyVideos(shots).length < 2} onClick={() => setMergeOpen(true)}>
                {t('canvas.storyboard.pipeline.merge')}
              </Button>
              {batchCanStop ? (
                <Button onClick={() => modal.confirm({
                  title: t('canvas.storyboard.batchStop'),
                  content: t('canvas.storyboard.batchStopConfirm'),
                  okText: t('canvas.storyboard.batchStop'),
                  cancelText: t('canvas.storyboard.cancel'),
                  onOk: () => cancelStoryboardRun(nodeId),
                })}>{t('canvas.storyboard.batchStop')}</Button>
              ) : null}
              <Button
                type="text"
                aria-label={t(fullscreen ? 'canvas.storyboard.exitFullscreen' : 'canvas.storyboard.fullscreen')}
                onClick={() => setFullscreen(!fullscreen)}
              >
                <IconSymbol name="maximize" />
              </Button>
              <Button type="text" aria-label={t('canvas.storyboard.close')} onClick={onClose}>
                <IconSymbol name="x" />
              </Button>
            </div>
          </header>
          <div className="storyboard-reading-workspace" data-mobile-detail={mobileDetail && Boolean(active)}>
            <section className="storyboard-reading-overview" aria-label={t('canvas.storyboard.tableLabel')}>
              <div className="storyboard-reading-toolbar">
                <SearchInput value={query} onChange={setQuery} placeholder={t('canvas.storyboard.searchShots')} />
                <Popover
                  trigger="click"
                  placement="bottomLeft"
                  content={
                    <div className="storyboard-reading-column-picker">
                      <strong>{t('canvas.storyboard.visibleColumns')}</strong>
                      <Checkbox.Group
                        value={visibleColumns}
                        options={columnOptions.map((value) => ({ value, label: columnLabel(value) }))}
                        onChange={(values) => {
                          setVisibleColumns(values as string[]);
                          node.storyboardVisibleColumns = values;
                          touchProject();
                        }}
                      />
                      <Button
                        size="small"
                        onClick={() => {
                          setVisibleColumns(['plot', 'dialogue', 'assets']);
                          node.storyboardVisibleColumns = ['plot', 'dialogue', 'assets'];
                          touchProject();
                        }}
                      >
                        {t('canvas.storyboard.resetColumns')}
                      </Button>
                    </div>
                  }
                >
                  <Button type="text">{t('canvas.storyboard.visibleColumns')}</Button>
                </Popover>
                <Button disabled={writeDisabled || shots.length >= MAX_STORYBOARD_SHOTS} onClick={() => insertShot()}>
                  + {t('canvas.storyboard.addShot')}
                </Button>
              </div>
              <div className="storyboard-reading-meta">
                <span>
                  {query || onlySelected
                    ? t('canvas.storyboard.showingShots', { shown: visibleShots.length, total: shots.length })
                    : t('canvas.storyboard.shotOrder')}
                </span>
                <span>{t('canvas.storyboard.readingHint')}</span>
              </div>
              <div className="storyboard-reading-table-scroll">
                <table className="storyboard-reading-table">
                  <thead>
                    <tr>
                      <th>
                        <Checkbox
                          aria-label={t('canvas.storyboard.selectVisible')}
                          disabled={writeDisabled || !visibleShots.length}
                          checked={Boolean(
                            visibleShots.length && visibleShots.every((shot) => selectedIds.includes(shot.id)),
                          )}
                          indeterminate={
                            visibleShots.some((shot) => selectedIds.includes(shot.id)) &&
                            !visibleShots.every((shot) => selectedIds.includes(shot.id))
                          }
                          onChange={(event) =>
                            setSelectedIds(
                              event.target.checked
                                ? [...new Set([...selectedIds, ...visibleShots.map((shot) => shot.id)])]
                                : selectedIds.filter((id) => !visibleShots.some((shot) => shot.id === id)),
                            )
                          }
                        />
                      </th>
                      <th>{t('canvas.storyboard.column.shot')}</th>
                      {visibleColumns.map((column) => (
                        <th key={column}>{columnLabel(column)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleShots.map((shot) => (
                      <tr key={shot.id} className={shot.id === active?.id ? 'is-editing' : ''} data-shot-id={shot.id}>
                        <td>
                          <Checkbox
                            aria-label={t('canvas.storyboard.selectShot', { index: shot.shotNumber })}
                            disabled={writeDisabled}
                            checked={selectedIds.includes(shot.id)}
                            onChange={(event) =>
                              setSelectedIds(
                                event.target.checked
                                  ? [...selectedIds, shot.id]
                                  : selectedIds.filter((id) => id !== shot.id),
                              )
                            }
                          />
                        </td>
                        <td>
                          <button type="button" className="storyboard-reading-shot" onClick={() => choose(shot)}>
                            <strong>{String(shot.shotNumber).padStart(2, '0')}</strong>
                            <small>
                              {shot.durationSeconds}s{shot.shotSize ? ` · ${shot.shotSize}` : ''}
                            </small>
                            <small>
                              {outputState(shot, 'video').nodeId
                                ? outputState(shot, 'video').label
                                : outputState(shot, 'image').label}
                            </small>
                          </button>
                        </td>
                        {visibleColumns.map((column) => (
                          <td key={column}>
                            <button
                              type="button"
                              className="storyboard-reading-cell"
                              onClick={() => choose(shot, column)}
                            >
                              {column === 'assets' ? (
                                <>
                                  {shot.imageNodeId ? (
                                    <NodeThumb nodeId={shot.imageNodeId} className="storyboard-reading-thumb" />
                                  ) : null}
                                  {references.get(shot.id)?.length ? (
                                    references.get(shot.id)?.map((id) => (
                                      <span key={id} className="storyboard-reading-asset">
                                        {String(nodeById(id)?.title || t('canvas.storyboard.referenceFallback'))}
                                      </span>
                                    ))
                                  ) : (
                                    <span className="is-empty">{t('canvas.storyboard.noAssets')}</span>
                                  )}
                                </>
                              ) : (
                                <span
                                  className={
                                    shot[column === 'duration' ? 'durationSeconds' : (column as keyof StoryboardShot)]
                                      ? ''
                                      : 'is-empty'
                                  }
                                >
                                  {String(
                                    shot[
                                      column === 'duration' ? 'durationSeconds' : (column as keyof StoryboardShot)
                                    ] ||
                                      (column === 'plot' ? shot.videoPrompt : '') ||
                                      '—',
                                  )}
                                </span>
                              )}
                            </button>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!visibleShots.length ? (
                  <div className="storyboard-editor-empty">
                    <strong>
                      {shots.length ? t('canvas.storyboard.noMatchTitle') : t('canvas.storyboard.editorEmptyTitle')}
                    </strong>
                    <span>
                      {shots.length ? t('canvas.storyboard.noMatchBody') : t('canvas.storyboard.editorEmptyBody')}
                    </span>
                    <Button
                      onClick={() => (shots.length ? (setQuery(''), setOnlySelected(false)) : insertShot())}
                      disabled={writeDisabled}
                    >
                      {shots.length ? t('canvas.storyboard.clearSearch') : t('canvas.storyboard.addShot')}
                    </Button>
                  </div>
                ) : null}
              </div>
              {selected.length ? (
                <div className="storyboard-reading-bulk">
                  <div>
                    <strong>{t('canvas.storyboard.selectedShots', { count: selected.length })}</strong>
                    <Button
                      type="text"
                      size="small"
                      onClick={() => setOnlySelected(!onlySelected)}
                      aria-pressed={onlySelected}
                    >
                      {t('canvas.storyboard.onlySelected')}
                    </Button>
                    <Button
                      type="text"
                      size="small"
                      onClick={() => {
                        setSelectedIds([]);
                        setOnlySelected(false);
                      }}
                    >
                      {t('canvas.storyboard.clearSelection')}
                    </Button>
                  </div>
                  <div>
                    {videoModeSelect}
                    <Button
                      disabled={writeDisabled || generationBusy || !imageIds.length}
                      loading={runningAll === 'image'}
                      onClick={() => confirmRun('image', imageIds)}
                    >
                      {t(mode === 'keyframe' ? 'canvas.storyboard.generateSelectedFrames' : 'canvas.storyboard.generateSelectedImages', { count: imageIds.length })}
                    </Button>
                    <Button
                      type="primary"
                      disabled={writeDisabled || generationBusy || !videoIds.length || missingKeyframes > 0}
                      loading={runningAll === 'video'}
                      onClick={() => confirmRun('video', videoIds)}
                    >
                      {t('canvas.storyboard.generateSelectedVideos', { count: videoIds.length })}
                    </Button>
                  </div>
                  <p className="storyboard-production-hint">
                    {missingKeyframes ? t('canvas.storyboard.bulkMissingFrames', { count: missingKeyframes })
                      : anyUncertain ? t('plugins.submissionUnknown') : t('canvas.storyboard.bulkGenerationHint')}
                  </p>
                </div>
              ) : null}
            </section>
            {active ? (
              <aside ref={detailRef} className="storyboard-reading-detail" aria-label={t('canvas.storyboard.currentShot')}>
                <Button type="text" className="storyboard-mobile-back" onClick={() => setMobileDetail(false)}>
                  <IconSymbol name="arrow-left" />{t('canvas.storyboard.backToShots')}
                </Button>
                <div className="storyboard-reading-detail-head">
                  <div>
                    <span>{t('canvas.storyboard.currentShot')}</span>
                    <h3>
                      {t('canvas.storyboard.shotLabel', { index: String(active.shotNumber).padStart(2, '0') })}{' '}
                      <small>
                        {activeIndex + 1} / {shots.length}
                      </small>
                    </h3>
                  </div>
                  <nav>
                    <Button
                      type="text"
                      aria-label={t('canvas.storyboard.previousShot')}
                      disabled={activeIndex <= 0}
                      onClick={() => setActiveId(shots[activeIndex - 1]?.id || '')}
                    >
                      ‹
                    </Button>
                    <Button
                      type="text"
                      aria-label={t('canvas.storyboard.nextShot')}
                      disabled={activeIndex >= shots.length - 1}
                      onClick={() => setActiveId(shots[activeIndex + 1]?.id || '')}
                    >
                      ›
                    </Button>
                  </nav>
                </div>
                <Segmented
                  block
                  value={detailTab}
                  options={(['story', 'prompts', 'production'] as const).map((value) => ({
                    value,
                    label: t(`canvas.storyboard.detail.${value}`),
                  }))}
                  onChange={(value) => setDetailTab(String(value))}
                />
                <div className="storyboard-reading-detail-scroll">
                  {detailTab === 'story' ? (
                    <>
                      <div className="storyboard-reading-pair">
                        <label className="storyboard-reading-field" data-shot-field="duration">
                          <span>{columnLabel('duration')}</span>
                          <InputNumber
                            min={0.1}
                            max={60}
                            step={0.1}
                            value={active.durationSeconds}
                            disabled={writeDisabled}
                            onChange={(value) => {
                              if (value !== null) commit('durationSeconds', active.id, value);
                            }}
                          />
                        </label>
                        <label className="storyboard-reading-field" data-shot-field="shotSize">
                          <span>{columnLabel('shotSize')}</span>
                          <Select
                            value={active.shotSize || undefined}
                            allowClear
                            disabled={writeDisabled}
                            options={['特写', '近景', '中景', '全景', '远景'].map((value) => ({ value, label: value }))}
                            onChange={(value) => commit('shotSize', active.id, value || '')}
                          />
                        </label>
                      </div>
                      {field('plot', 4)}
                      {field('dialogue', 3)}
                      <div className="storyboard-reading-pair">
                        {field('camera')}
                        {field('motion')}
                      </div>
                      {field('sound')}
                      {field('characters')}
                    </>
                  ) : detailTab === 'prompts' ? (
                    <>
                      {field('videoPrompt', 8)}
                      {field('imagePrompt', 5)}
                      {field('negativePrompt')}
                    </>
                  ) : (
                    <>
                      <label className="storyboard-reading-field storyboard-production-video-mode">
                        <span>{t('canvas.storyboard.projectVideoMode')}</span>
                        {videoModeSelect}
                      </label>
                      <StoryboardShotProduction
                        key={active.id}
                        script={node}
                        shot={active}
                        disabled={writeDisabled || generationBusy}
                        onEditAssets={() => setAssetShotId(active.id)}
                        onFocus={(id) => { selectNode(id); onClose(); }}
                        onGenerate={(kind, force) => confirmRun(kind, [active.id], force)}
                        onRetry={(batchId) => modal.confirm({
                          title: t('canvas.storyboard.batchRetryOne'),
                          content: t('canvas.storyboard.batchRetryConfirm'),
                          okText: t('canvas.storyboard.generate'),
                          cancelText: t('canvas.storyboard.cancel'),
                          onOk: () => { void retryStoryboardBatch(nodeId, batchId, active.id); },
                        })}
                      />
                    </>
                  )}
                </div>
                <footer className="storyboard-reading-detail-foot">
                  <Button disabled={writeDisabled} onClick={() => insertShot(true)}>
                    {t('canvas.storyboard.copyShot')}
                  </Button>
                  <Dropdown
                    menu={{
                      items: [
                        { key: 'up', label: t('canvas.storyboard.moveUp'), disabled: activeIndex <= 0 },
                        {
                          key: 'down',
                          label: t('canvas.storyboard.moveDown'),
                          disabled: activeIndex >= shots.length - 1,
                        },
                      ],
                      onClick: ({ key }) => moveStoryboardShot(nodeId, active.id, key === 'up' ? -1 : 1),
                    }}
                    disabled={writeDisabled}
                  >
                    <Button type="text" aria-label={t('canvas.storyboard.more')}><IconSymbol name="more" /></Button>
                  </Dropdown>
                  <Button
                    type="text"
                    danger
                    disabled={writeDisabled}
                    aria-label={t('canvas.storyboard.remove')}
                    onClick={() =>
                      modal.confirm({
                        title: t('canvas.storyboard.remove'),
                        onOk: () => {
                          removeStoryboardShot(nodeId, active.id);
                        },
                      })
                    }
                  >
                    <IconSymbol name="trash" />
                  </Button>
                </footer>
              </aside>
            ) : null}
          </div>
          <footer className="storyboard-reading-footer">
            <span>{t('canvas.storyboard.instantSave')}</span>
            <span>{t('canvas.storyboard.escapeFullscreen')}</span>
          </footer>
        </div>
      </Modal>
      <Modal
        open={aiOpen}
        onCancel={() => setAiOpen(false)}
        title={t('canvas.storyboard.aiTitle')}
        okText={busy ? t('canvas.storyboard.aiRunning') : t('canvas.storyboard.aiStart')}
        okButtonProps={{ disabled: busy || !(aiModel || currentModel) }}
        onOk={startAi}
        destroyOnHidden
      >
        <div className="storyboard-ai-form">
          <label>
            <span>{t('canvas.storyboard.aiModel')}</span>
            <Select
              value={aiModel || currentModel}
              options={textModels.map((model) => ({
                value: model,
                label: modelCatalog.getModelInfo(model)?.name || model,
              }))}
              onChange={setAiModel}
              showSearch
              optionFilterProp="label"
              placeholder={t('canvas.storyboard.aiModelEmpty')}
            />
          </label>
          <label>
            <span>{t('canvas.storyboard.aiCount')}</span>
            <Select
              value={aiCount}
              options={[
                { value: 'auto', label: t('canvas.storyboard.autoSplit') },
                ...Array.from({ length: MAX_STORYBOARD_SHOTS }, (_, index) => ({
                  value: index + 1,
                  label: t('canvas.storyboard.shotCount', { count: index + 1 }),
                })),
              ]}
              onChange={setAiCount}
            />
          </label>
          <label>
            <span>{t('canvas.storyboard.aiDuration')}</span>
            <Select
              value={aiDuration}
              options={[
                { value: 'auto', label: t('canvas.storyboard.durationAuto') },
                ...[5, 10, 15, 30].map((value) => ({
                  value,
                  label: t('canvas.storyboard.durationValue', { seconds: value }),
                })),
              ]}
              onChange={(value) => setAiDuration(value === 'auto' ? 'auto' : Number(value))}
            />
          </label>
          <label>
            <span>{t('canvas.storyboard.aiExtra')}</span>
            <Input.TextArea
              value={aiExtra}
              onChange={(event) => setAiExtra(event.target.value)}
              autoSize={{ minRows: 2, maxRows: 4 }}
              placeholder={t('canvas.storyboard.aiExtraPlaceholder')}
            />
          </label>
          <p className="storyboard-ai-note">{t('canvas.storyboard.aiNote')}</p>
        </div>
      </Modal>
      {mergeOpen && open ? <StoryboardMergeDialog nodeId={nodeId} onClose={() => setMergeOpen(false)} onMerged={onClose} /> : null}
      {assetShot && open ? <StoryboardAssetPicker key={assetShot.id} nodeId={nodeId} shot={assetShot} onClose={() => setAssetShotId('')} /> : null}
    </>
  );
}
