import { t } from '@/i18n';
import { memo, useContext, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { App, Button, Dropdown, Input, Select, Tooltip } from 'antd';
import { IconSymbol } from '../components/IconSymbol';
import { NodeThumb } from './NodeThumb';
import { CanvasNodeLabelRootContext, type WorkflowNodeRenderer } from './WorkflowCanvas';
import { store, touchProject } from '../../store/projectStore';
import { selectedNodeMedia } from '../../utils/nodeMedia';
import { getDomainRevision, subscribeDomain } from '../../store/domainReactivity';
import { getAvailableModelIdsByType } from '../../store/settingsStore';
import { modelCatalog } from '../../domain/catalog/ModelCatalog';
import {
  addStoryboardShot,
  removeStoryboardShot,
  runStoryboardScriptGeneration,
  runStoryboardShots,
  setStoryboardGenerationSettings,
  storyboardShots,
  updateStoryboardShot,
} from './storyboardScriptActions';
import { MAX_STORYBOARD_SHOTS, storyboardShotSummary, type StoryboardShot } from '@/domain/graph/StoryboardScript';
import { StoryboardScriptEditor } from './StoryboardScriptEditor';

type AnyRecord = Record<string, any>;
type StoryboardView = 'script' | 'images' | 'videos' | 'merge';

function nodeById(nodeId: string): AnyRecord | null {
  return (store.project.nodes as AnyRecord[]).find((node) => node.id === nodeId) || null;
}

function shotOutput(shot: StoryboardShot, kind: 'image' | 'video') {
  const output = nodeById(kind === 'image' ? shot.imageNodeId : shot.videoNodeId);
  if (!output) return { label: t('canvas.storyboard.status.notGenerated'), tone: 'muted', nodeId: '' };
  const status = String(output.status || 'idle');
  const tone = status === 'completed' ? 'good'
    : status === 'running' || status === 'queued' ? 'warn'
      : status === 'failed' || status === 'timeout' || status === 'error' ? 'bad' : 'muted';
  const label = status === 'completed' ? t('canvas.storyboard.status.ready')
    : status === 'running' || status === 'queued' ? t('canvas.storyboard.status.running')
      : status === 'failed' || status === 'timeout' || status === 'error' ? t('canvas.storyboard.status.failed')
        : status === 'cancelled' ? t('canvas.storyboard.status.cancelled') : t('canvas.storyboard.status.idle');
  return { label, tone, nodeId: String(output.id) };
}

function referenceNames(scriptNodeId: string): string[] {
  const nodes = store.project.nodes as AnyRecord[];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const names: string[] = [];
  for (const edge of store.project.edges as AnyRecord[]) {
    if (edge.target !== scriptNodeId || edge.data?.skipTaskInput === true) continue;
    const source = byId.get(edge.source);
    if (!source || source.archived) continue;
    const media = selectedNodeMedia(source, store.project);
    const path = String(media?.filePath || media?.path || source.filePath || source.uploadedFile?.path || '');
    if (!path) continue;
    names.push(String(source.title || t('canvas.storyboard.referenceFallback')));
  }
  return [...new Set(names)];
}

function PipelineDot({ tone }: { tone: string }) {
  return <i className={`storyboard-pipeline-dot tone-${tone}`} aria-hidden="true" />;
}

export const StoryboardScriptNode: WorkflowNodeRenderer = memo(({ node, selected, actions }) => {
  // 画布节点对象就地更新，只有订阅 revision 才能在生成回执写入后重画镜头行。
  useSyncExternalStore(subscribeDomain, getDomainRevision);
  const { modal, message } = App.useApp();
  const data = node as AnyRecord;
  const labelRoot = useContext(CanvasNodeLabelRootContext);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorStartsAi, setEditorStartsAi] = useState(false);
  const [view, setView] = useState<StoryboardView>('script');
  const [sending, setSending] = useState(false);
  const shots = storyboardShots(data);
  const summary = storyboardShotSummary(shots);
  const busy = data.status === 'running' || data.status === 'queued';
  const error = String(data.error || data.storyboardParseError || '');
  const source = String(data.prompt || '');
  const textModels = getAvailableModelIdsByType('textGeneration');
  const currentModel = String(data.model || textModels[0] || '');
  const countValue = Number(data.storyboardShotCount) > 0 ? Number(data.storyboardShotCount) : 'auto';
  const durationValue = Number(data.storyboardShotDuration) > 0 ? Number(data.storyboardShotDuration) : 'auto';
  const references = referenceNames(String(node.id));
  const imageShots = shots.filter((shot) => Boolean(shot.imageNodeId));
  const videoShots = shots.filter((shot) => Boolean(shot.videoNodeId));
  const readyImages = shots.filter((shot) => shotOutput(shot, 'image').tone === 'good').length;
  const readyVideos = shots.filter((shot) => shotOutput(shot, 'video').tone === 'good').length;
  const unfinishedImages = shots.filter((shot) => shotOutput(shot, 'image').tone !== 'good').length;
  const unfinishedVideos = shots.filter((shot) => shotOutput(shot, 'video').tone !== 'good').length;

  const label = (
    <div className={`work-node-kicker${data.title ? '' : ' unlabeled'}`}>
      {data.title ? <IconSymbol className="work-node-type-icon" name="text" aria-hidden="true" /> : null}
      {data.title ? (
        <span className="work-node-title nodrag nopan" title={String(data.title)}>{String(data.title)}</span>
      ) : null}
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
    if (!source.trim() || !currentModel || busy || sending) return;
    const go = () => {
      setSending(true);
      try {
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

  function generateShots(kind: 'image' | 'video', shotIds?: string[]) {
    void runStoryboardShots(String(node.id), kind, shotIds);
  }

  function focusOutput(nodeId: string) {
    if (!nodeId) return;
    actions.select(nodeId);
  }

  const pipeline = [
    { key: 'script' as const, label: t('canvas.storyboard.pipeline.script'), tone: shots.length ? 'good' : 'idle', hint: t('canvas.storyboard.pipeline.shots', { count: shots.length }) },
    { key: 'images' as const, label: t('canvas.storyboard.pipeline.images'), tone: readyImages === shots.length && shots.length ? 'good' : readyImages ? 'warn' : 'idle', hint: t('canvas.storyboard.pipeline.ready', { done: readyImages, total: shots.length }) },
    { key: 'videos' as const, label: t('canvas.storyboard.pipeline.videos'), tone: readyVideos === shots.length && shots.length ? 'good' : readyVideos ? 'warn' : 'idle', hint: t('canvas.storyboard.pipeline.ready', { done: readyVideos, total: shots.length }) },
    { key: 'merge' as const, label: t('canvas.storyboard.pipeline.merge'), tone: readyVideos >= 2 ? 'warn' : 'idle', hint: t('canvas.storyboard.pipeline.mergeHint') },
  ];

  return (
    <div
      className={`storyboard-script-node${selected ? ' selected' : ''}`}
      data-storyboard-script={node.id}
      onClick={(event) => { event.stopPropagation(); select(); }}
    >
      {labelRoot ? createPortal(label, labelRoot) : null}
      <div className="storyboard-node-head">
        <IconSymbol className="storyboard-node-icon" name="text" />
        <div className="storyboard-node-title-block">
          <strong title={String(data.title || t('canvas.storyboard.title'))}>{String(data.title || t('canvas.storyboard.title'))}</strong>
          <span>{t('canvas.storyboard.summary', { count: summary.count, seconds: summary.totalDuration })}</span>
        </div>
        <div className="storyboard-node-head-actions">
          <Tooltip title={t('canvas.storyboard.fullscreen')}>
            <Button size="small" type="text" aria-label={t('canvas.storyboard.fullscreen')} onClick={() => setEditorOpen(true)}>
              <IconSymbol name="maximize" />
            </Button>
          </Tooltip>
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                { key: 'edit', label: t('canvas.storyboard.edit') },
                { key: 'ai', label: t('canvas.storyboard.aiGenerate') },
                { type: 'divider' },
                { key: 'clear', label: t('canvas.storyboard.clearShots'), danger: true, disabled: !shots.length },
              ],
              onClick: ({ key }) => {
                if (key === 'clear') {
                  modal.confirm({
                    title: t('canvas.storyboard.clearConfirmTitle'),
                    content: t('canvas.storyboard.clearConfirmBody'),
                    okText: t('canvas.storyboard.clearConfirmOk'),
                    cancelText: t('canvas.storyboard.cancel'),
                    onOk: () => {
                      data.storyboardShots = [];
                      touchProject();
                    },
                  });
                } else if (key === 'ai') { setEditorStartsAi(true); setEditorOpen(true); }
                else setEditorOpen(true);
              },
            }}
          >
            <Button size="small" type="text" aria-label={t('canvas.storyboard.more')}><IconSymbol name="more" /></Button>
          </Dropdown>
        </div>
      </div>
      <div className="storyboard-pipeline" role="group" aria-label={t('canvas.storyboard.pipeline.label')}>
        {pipeline.map((item) => (
          <button
            key={item.key}
            type="button"
            aria-pressed={view === item.key}
            className={`storyboard-pipeline-tab${view === item.key ? ' is-active' : ''}`}
            onClick={(event) => { event.stopPropagation(); setView(item.key); }}
          >
            <PipelineDot tone={item.tone} />
            <span>{item.label}</span>
            <em>{item.hint}</em>
          </button>
        ))}
      </div>

      {view === 'script' ? (
        <>
          <div className="storyboard-table" role="table" aria-label={t('canvas.storyboard.tableLabel')}>
            <div className="storyboard-table-row storyboard-table-row--head" role="row">
              <span role="columnheader">{t('canvas.storyboard.column.shot')}</span>
              <span role="columnheader">{t('canvas.storyboard.column.duration')}</span>
              <span role="columnheader">{t('canvas.storyboard.column.videoPrompt')}</span>
              <span role="columnheader">{t('canvas.storyboard.column.dialogueFull')}</span>
              <span role="columnheader">{t('canvas.storyboard.column.assets')}</span>
            </div>
            {shots.length ? shots.map((shot) => (
              <div className="storyboard-table-row" role="row" key={shot.id}>
                <span role="cell" className="storyboard-shot-number">
                  {shot.shotNumber}
                  <button type="button" aria-label={t('canvas.storyboard.remove')} onClick={() => removeStoryboardShot(String(node.id), shot.id)}>×</button>
                </span>
                <span role="cell">
                  <Input
                    defaultValue={String(shot.durationSeconds)}
                    aria-label={t('canvas.storyboard.column.duration')}
                    onBlur={(event) => commitShot(shot.id, { durationSeconds: event.target.value })}
                  />
                </span>
                <span role="cell">
                  <Input
                    defaultValue={shot.videoPrompt || shot.plot}
                    placeholder={t('canvas.storyboard.videoPromptPlaceholder')}
                    aria-label={t('canvas.storyboard.column.videoPrompt')}
                    onBlur={(event) => commitShot(shot.id, { videoPrompt: event.target.value })}
                  />
                </span>
                <span role="cell">
                  <Input
                    defaultValue={shot.dialogue}
                    placeholder={t('canvas.storyboard.column.dialoguePlaceholder')}
                    aria-label={t('canvas.storyboard.column.dialogueFull')}
                    onBlur={(event) => commitShot(shot.id, { dialogue: event.target.value })}
                  />
                </span>
                <span role="cell" className="storyboard-assets-cell">
                  {references.length ? (
                    <Tooltip title={references.join('、')}>
                      <span>{t('canvas.storyboard.referenceCount', { count: references.length })}</span>
                    </Tooltip>
                  ) : (
                    <span className="is-empty">{t('canvas.storyboard.noAssets')}</span>
                  )}
                  <Button size="small" type="link" onClick={() => setEditorOpen(true)}>{t('canvas.storyboard.editAssets')}</Button>
                </span>
              </div>
            )) : (
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
          <div className="storyboard-add-row">
            <Button type="text" onClick={() => addStoryboardShot(String(node.id))} disabled={shots.length >= MAX_STORYBOARD_SHOTS}>
              + {t('canvas.storyboard.addShot')}
            </Button>
          </div>
          <div className="storyboard-composer">
            <Input.TextArea
              value={source}
              autoSize={{ minRows: 2, maxRows: 4 }}
              placeholder={t('canvas.storyboard.composerPlaceholder')}
              aria-label={t('canvas.storyboard.sourceLabel')}
              onChange={(event) => updatePrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  submit();
                }
              }}
            />
            <div className="storyboard-composer-actions">
              <Select
                className="storyboard-model-select"
                size="small"
                value={currentModel || undefined}
                placeholder={t('canvas.storyboard.selectModel')}
                options={textModels.map((model) => ({ value: model, label: modelCatalog.getModelInfo(model)?.name || model }))}
                onChange={(value) => { if (value) setStoryboardGenerationSettings(String(node.id), { model: value }); }}
                showSearch
                optionFilterProp="label"
              />
              <Select
                size="small"
                value={countValue}
                className="storyboard-count-select"
                options={[
                  { value: 'auto', label: t('canvas.storyboard.autoSplit') },
                  ...Array.from({ length: 10 }, (_, index) => ({ value: index + 1, label: t('canvas.storyboard.shotCount', { count: index + 1 }) })),
                ]}
                onChange={(value) => setStoryboardGenerationSettings(String(node.id), { shotCount: value === 'auto' ? 'auto' : Number(value) })}
              />
              <Select
                size="small"
                value={durationValue}
                className="storyboard-duration-select"
                options={[
                  { value: 'auto', label: t('canvas.storyboard.durationAuto') },
                  ...[5, 10, 15, 30].map((value) => ({ value, label: t('canvas.storyboard.durationValue', { seconds: value }) })),
                ]}
                onChange={(value) => setStoryboardGenerationSettings(String(node.id), { shotDuration: value === 'auto' ? 'auto' : Number(value) })}
              />
              <Button
                className="storyboard-send"
                type="primary"
                shape="circle"
                aria-label={t('canvas.storyboard.submit')}
                loading={busy || sending}
                disabled={!source.trim() || !currentModel || busy || sending}
                onClick={submit}
              ><IconSymbol name="send" /></Button>
            </div>
          </div>
        </>
      ) : null}

      {view === 'images' || view === 'videos' ? (
        <div className="storyboard-outputs">
          <div className="storyboard-outputs-head">
            <span>{t(view === 'images' ? 'canvas.storyboard.imagesTitle' : 'canvas.storyboard.videosTitle', { count: shots.length })}</span>
            <Button
              size="small"
              type="primary"
              disabled={!shots.length || busy}
              onClick={() => generateShots(view === 'images' ? 'image' : 'video')}
            >
              {t('canvas.storyboard.generateUnfinished', { count: view === 'images' ? unfinishedImages : unfinishedVideos })}
            </Button>
          </div>
          <div className="storyboard-output-grid">
            {shots.map((shot) => {
              const state = shotOutput(shot, view === 'images' ? 'image' : 'video');
              return (
                <article className="storyboard-output-card" key={shot.id}>
                  <button type="button" className="storyboard-output-preview" onClick={() => focusOutput(state.nodeId)} disabled={!state.nodeId}>
                    {state.nodeId ? <NodeThumb nodeId={state.nodeId} className="storyboard-output-thumb" mediaKind={view === 'videos' ? 'video' : 'image'} /> : <span>#{shot.shotNumber}</span>}
                  </button>
                  <div className="storyboard-output-meta">
                    <strong>{t('canvas.storyboard.shotLabel', { index: shot.shotNumber })}</strong>
                    <span className={`status-${state.tone}`}>{state.label}</span>
                  </div>
                  <Button size="small" disabled={busy} onClick={() => generateShots(view === 'images' ? 'image' : 'video', [shot.id])}>
                    {state.tone === 'good' ? t('canvas.storyboard.regenerate') : t('canvas.storyboard.generate')}
                  </Button>
                </article>
              );
            })}
          </div>
          {!shots.length ? <div className="storyboard-outputs-empty">{t('canvas.storyboard.outputsNeedShots')}</div> : null}
        </div>
      ) : null}

      {view === 'merge' ? (
        <div className="storyboard-merge">
          <IconSymbol name="film" />
          <strong>{t('canvas.storyboard.mergeTitle')}</strong>
          <span>{t('canvas.storyboard.mergeBody', { done: readyVideos, total: shots.length })}</span>
          <Button
            disabled={readyVideos < 2}
            onClick={() => {
              const ids = shots.map((shot) => shot.videoNodeId).filter(Boolean);
              if (ids.length) actions.select(ids[ids.length - 1] as string);
              message.info(t('canvas.storyboard.mergeHintToast'));
            }}
          >{t('canvas.storyboard.mergeAction')}</Button>
        </div>
      ) : null}

      {error ? <div className="storyboard-script-error">{error}</div> : null}
      <div className="storyboard-node-foot">
        <span>{t('canvas.storyboard.footNote')}</span>
        <span>{t('canvas.storyboard.footImages', { count: imageShots.length })} · {t('canvas.storyboard.footVideos', { count: videoShots.length })}</span>
      </div>
      <StoryboardScriptEditor
        open={editorOpen}
        nodeId={String(node.id)}
        autoOpenAi={editorStartsAi}
        onClose={() => { setEditorOpen(false); setEditorStartsAi(false); }}
      />
    </div>
  );
});
