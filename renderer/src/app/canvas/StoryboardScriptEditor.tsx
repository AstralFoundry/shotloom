import { t } from '@/i18n';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { App, Button, Input, InputNumber, Modal, Select, Tooltip } from 'antd';
import { getDomainRevision, subscribeDomain } from '@/store/domainReactivity';
import { store, touchProject } from '@/store/projectStore';
import { modelCatalog } from '@/domain/catalog/ModelCatalog';
import { getAvailableModelIdsByType } from '@/store/settingsStore';
import { MAX_STORYBOARD_SHOTS } from '@/domain/graph/StoryboardScript';
import {
  addStoryboardShot,
  moveStoryboardShot,
  removeStoryboardShot,
  runStoryboardScriptGeneration,
  runStoryboardShots,
  setStoryboardGenerationSettings,
  storyboardShots,
  updateStoryboardShot,
} from './storyboardScriptActions';

type AnyRecord = Record<string, any>;
type ShotField = 'durationSeconds' | 'plot' | 'shotSize' | 'camera' | 'motion' | 'imagePrompt' | 'videoPrompt' | 'dialogue' | 'sound' | 'characters' | 'negativePrompt';

function nodeById(nodeId: string): AnyRecord | null {
  return (store.project.nodes as AnyRecord[]).find((node) => node.id === nodeId) || null;
}

function outputState(shot: AnyRecord, kind: 'image' | 'video') {
  const output = nodeById(String(kind === 'image' ? shot.imageNodeId : shot.videoNodeId));
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

export function StoryboardScriptEditor({ open, nodeId, onClose, autoOpenAi = false }: { open: boolean; nodeId: string; onClose: () => void; autoOpenAi?: boolean }) {
  useSyncExternalStore(subscribeDomain, getDomainRevision);
  const { message, modal } = App.useApp();
  const node = nodeById(nodeId);
  const shots = storyboardShots(node);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiModel, setAiModel] = useState('');
  const [aiCount, setAiCount] = useState(8);
  const [aiExtra, setAiExtra] = useState('');
  const [aiDuration, setAiDuration] = useState<number | 'auto'>('auto');
  const [runningAll, setRunningAll] = useState<'image' | 'video' | ''>('');
  const [autoOpened, setAutoOpened] = useState(false);
  useEffect(() => {
    if (!open) { setAutoOpened(false); return; }
    if (!autoOpenAi || autoOpened || !node) return;
    setAutoOpened(true);
    setAiModel(String(node.model || getAvailableModelIdsByType('textGeneration')[0] || ''));
    setAiCount(Number(node.storyboardShotCount) || storyboardShots(node).length || 8);
    setAiExtra(String(node.storyboardExtraRequirement || ''));
    setAiOpen(true);
  }, [open, autoOpenAi, autoOpened, node]);
  if (!node) return null;
  const busy = node.status === 'running' || node.status === 'queued';
  const textModels = getAvailableModelIdsByType('textGeneration');
  const currentModel = String(node.model || textModels[0] || '');
  const totalDuration = shots.reduce((sum, shot) => sum + (Number(shot.durationSeconds) || 0), 0);

  function commit(field: ShotField, shotId: string, value: unknown) {
    updateStoryboardShot(nodeId, shotId, { [field]: value });
  }

  function openAi() {
    setAiModel(currentModel);
    setAiCount(Number(node?.storyboardShotCount) || shots.length || 8);
    setAiDuration(Number(node?.storyboardShotDuration) > 0 ? Number(node?.storyboardShotDuration) : 'auto');
    setAiExtra(String(node?.storyboardExtraRequirement || ''));
    setAiOpen(true);
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

  async function runAll(kind: 'image' | 'video') {
    if (runningAll) return;
    setRunningAll(kind);
    try {
      await runStoryboardShots(nodeId, kind);
      message.success(kind === 'image' ? t('canvas.storyboard.allImagesQueued') : t('canvas.storyboard.allVideosQueued'));
    } finally {
      setRunningAll('');
    }
  }

  function updateSource(value: string) {
    if (!node) return;
    node.prompt = value;
    touchProject({ sessionDelay: 250, coalesceSession: true });
  }

  const visibleShots = shots;
  return (
    <Modal
      open={open}
      onCancel={onClose}
      width="100vw"
      destroyOnHidden
      className="storyboard-editor-modal"
      style={{ top: 0, maxWidth: '100vw', paddingBottom: 0 }}
      title={(
        <div className="storyboard-editor-title">
          <span>{t('canvas.storyboard.editorTitle')}</span>
          <Input
            className="storyboard-editor-name"
            defaultValue={String(node.title || '')}
            maxLength={80}
            aria-label={t('canvas.storyboard.editorName')}
            onBlur={(event) => {
              const title = event.target.value.trim();
              if (!title || title === node.title) return;
              node.title = title;
              node.titleOverride = title;
              touchProject();
            }}
          />
          <span className="storyboard-editor-stats">
            {t('canvas.storyboard.summary', { count: shots.length, seconds: Math.round(totalDuration * 10) / 10 })}
          </span>
        </div>
      )}
      footer={(
        <div className="storyboard-editor-footer">
          <div className="storyboard-editor-footer-left">
            <Button disabled={!shots.length} onClick={() => addStoryboardShot(nodeId)}>{t('canvas.storyboard.addShot')}</Button>
            <Button type="primary" loading={busy} onClick={openAi}>{t('canvas.storyboard.aiGenerate')}</Button>
          </div>
          <div className="storyboard-editor-footer-right">
            <Tooltip title={t('canvas.storyboard.runImagesHint')}>
              <Button
                loading={runningAll === 'image'}
                disabled={!shots.length || Boolean(runningAll)}
                onClick={() => void runAll('image')}
              >{t('canvas.storyboard.runImages')}</Button>
            </Tooltip>
            <Tooltip title={t('canvas.storyboard.runVideosHint')}>
              <Button
                loading={runningAll === 'video'}
                disabled={!shots.length || Boolean(runningAll)}
                onClick={() => void runAll('video')}
              >{t('canvas.storyboard.runVideos')}</Button>
            </Tooltip>
            <Button onClick={onClose}>{t('canvas.storyboard.close')}</Button>
          </div>
        </div>
      )}
    >
      <div className="storyboard-editor">
        <div className="storyboard-editor-source">
          <div className="storyboard-editor-section-head">
            <strong>{t('canvas.storyboard.sourceLabel')}</strong>
            <span>{t('canvas.storyboard.sourceHint')}</span>
          </div>
          <Input.TextArea
            defaultValue={String(node.prompt || '')}
            key={`${nodeId}:source`}
            autoSize={{ minRows: 2, maxRows: 6 }}
            placeholder={t('canvas.storyboard.sourcePlaceholder')}
            onChange={(event) => updateSource(event.target.value)}
          />
          {node.storyboardParseError ? <p className="storyboard-editor-error">{String(node.storyboardParseError)}</p> : null}
          {busy ? <p className="storyboard-editor-live">{t('canvas.storyboard.generating')}</p> : null}
        </div>
        {visibleShots.length ? (
          <div className="storyboard-editor-table" role="table" aria-label={t('canvas.storyboard.tableLabel')}>
            <div className="storyboard-editor-row storyboard-editor-row--head" role="row">
              <span role="columnheader">{t('canvas.storyboard.column.shot')}</span>
              <span role="columnheader">{t('canvas.storyboard.column.duration')}</span>
              <span role="columnheader">{t('canvas.storyboard.column.plot')}</span>
              <span role="columnheader">{t('canvas.storyboard.column.dialogue')}</span>
              <span role="columnheader">{t('canvas.storyboard.column.prompts')}</span>
              <span role="columnheader">{t('canvas.storyboard.column.outputs')}</span>
              <span role="columnheader">{t('canvas.storyboard.column.actions')}</span>
            </div>
            {visibleShots.map((shot, index) => {
              const image = outputState(shot, 'image');
              const video = outputState(shot, 'video');
              return (
                <div className="storyboard-editor-row" role="row" key={shot.id} data-shot-id={shot.id}>
                  <div role="cell" className="storyboard-editor-shot-number">{shot.shotNumber}</div>
                  <div role="cell" className="storyboard-editor-duration">
                    <Input
                      defaultValue={String(shot.durationSeconds)}
                      aria-label={t('canvas.storyboard.column.duration')}
                      onBlur={(event) => commit('durationSeconds', shot.id, event.target.value)}
                    />
                    <span>s</span>
                  </div>
                  <div role="cell" className="storyboard-editor-main">
                    <Input.TextArea
                      defaultValue={shot.plot}
                      autoSize={{ minRows: 2, maxRows: 5 }}
                      aria-label={t('canvas.storyboard.column.plot')}
                      onBlur={(event) => commit('plot', shot.id, event.target.value)}
                    />
                    <div className="storyboard-editor-inline">
                      <Input defaultValue={shot.shotSize} placeholder={t('canvas.storyboard.column.shotSize')} aria-label={t('canvas.storyboard.column.shotSize')} onBlur={(event) => commit('shotSize', shot.id, event.target.value)} />
                      <Input defaultValue={shot.camera} placeholder={t('canvas.storyboard.column.camera')} aria-label={t('canvas.storyboard.column.camera')} onBlur={(event) => commit('camera', shot.id, event.target.value)} />
                      <Input defaultValue={shot.motion} placeholder={t('canvas.storyboard.column.motion')} aria-label={t('canvas.storyboard.column.motion')} onBlur={(event) => commit('motion', shot.id, event.target.value)} />
                      <Input defaultValue={shot.characters} placeholder={t('canvas.storyboard.column.characters')} aria-label={t('canvas.storyboard.column.characters')} onBlur={(event) => commit('characters', shot.id, event.target.value)} />
                    </div>
                  </div>
                  <div role="cell" className="storyboard-editor-dialogue">
                    <Input.TextArea
                      defaultValue={shot.dialogue}
                      autoSize={{ minRows: 2, maxRows: 4 }}
                      aria-label={t('canvas.storyboard.column.dialogue')}
                      onBlur={(event) => commit('dialogue', shot.id, event.target.value)}
                    />
                    <Input defaultValue={shot.sound} placeholder={t('canvas.storyboard.column.sound')} aria-label={t('canvas.storyboard.column.sound')} onBlur={(event) => commit('sound', shot.id, event.target.value)} />
                  </div>
                  <div role="cell" className="storyboard-editor-prompts">
                    <Input.TextArea
                      defaultValue={shot.imagePrompt}
                      autoSize={{ minRows: 2, maxRows: 5 }}
                      placeholder={t('canvas.storyboard.imagePromptPlaceholder')}
                      aria-label={t('canvas.storyboard.imagePromptPlaceholder')}
                      onBlur={(event) => commit('imagePrompt', shot.id, event.target.value)}
                    />
                    <Input.TextArea
                      defaultValue={shot.videoPrompt}
                      autoSize={{ minRows: 2, maxRows: 5 }}
                      placeholder={t('canvas.storyboard.videoPromptPlaceholder')}
                      aria-label={t('canvas.storyboard.videoPromptPlaceholder')}
                      onBlur={(event) => commit('videoPrompt', shot.id, event.target.value)}
                    />
                    <Input
                      defaultValue={shot.negativePrompt}
                      placeholder={t('canvas.storyboard.negativePromptPlaceholder')}
                      aria-label={t('canvas.storyboard.negativePromptPlaceholder')}
                      onBlur={(event) => commit('negativePrompt', shot.id, event.target.value)}
                    />
                  </div>
                  <div role="cell" className="storyboard-editor-outputs">
                    <button
                      type="button"
                      className={`storyboard-output-pill tone-${image.tone}`}
                      title={t('canvas.storyboard.runThisImage')}
                      onClick={() => void runStoryboardShots(nodeId, 'image', [shot.id])}
                    >
                      {t('canvas.storyboard.image')} · {image.label}
                    </button>
                    <button
                      type="button"
                      className={`storyboard-output-pill tone-${video.tone}`}
                      title={t('canvas.storyboard.runThisVideo')}
                      onClick={() => void runStoryboardShots(nodeId, 'video', [shot.id])}
                    >
                      {t('canvas.storyboard.video')} · {video.label}
                    </button>
                  </div>
                  <div role="cell" className="storyboard-editor-actions">
                    <Button size="small" disabled={index === 0} onClick={() => moveStoryboardShot(nodeId, shot.id, -1)} aria-label={t('canvas.storyboard.moveUp')}>↑</Button>
                    <Button size="small" disabled={index === visibleShots.length - 1} onClick={() => moveStoryboardShot(nodeId, shot.id, 1)} aria-label={t('canvas.storyboard.moveDown')}>↓</Button>
                    <Button size="small" onClick={() => addStoryboardShot(nodeId, shot.id)}>{t('canvas.storyboard.addAfter')}</Button>
                    <Button size="small" danger onClick={() => removeStoryboardShot(nodeId, shot.id)}>{t('canvas.storyboard.remove')}</Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="storyboard-editor-empty">
            <strong>{t('canvas.storyboard.editorEmptyTitle')}</strong>
            <span>{t('canvas.storyboard.editorEmptyBody')}</span>
            <div className="storyboard-editor-empty-actions">
              <Button onClick={() => addStoryboardShot(nodeId)}>{t('canvas.storyboard.addShot')}</Button>
              <Button type="primary" onClick={openAi}>{t('canvas.storyboard.aiGenerate')}</Button>
            </div>
          </div>
        )}
      </div>
      <Modal
        open={aiOpen}
        onCancel={() => setAiOpen(false)}
        title={t('canvas.storyboard.aiTitle')}
        okText={busy ? t('canvas.storyboard.aiRunning') : t('canvas.storyboard.aiStart')}
        okButtonProps={{ disabled: busy || !currentModel }}
        onOk={startAi}
        destroyOnHidden
      >
        <div className="storyboard-ai-form">
          <label>
            <span>{t('canvas.storyboard.aiModel')}</span>
            <Select
              value={aiModel || currentModel}
              options={textModels.map((model) => ({ value: model, label: modelCatalog.getModelInfo(model)?.name || model }))}
              onChange={setAiModel}
              showSearch
              optionFilterProp="label"
              placeholder={t('canvas.storyboard.aiModelEmpty')}
            />
          </label>
          <label>
            <span>{t('canvas.storyboard.aiCount')}</span>
            <InputNumber min={1} max={MAX_STORYBOARD_SHOTS} value={aiCount} onChange={(value) => setAiCount(Number(value) || 1)} />
          </label>
          <label>
            <span>{t('canvas.storyboard.aiDuration')}</span>
            <Select
              value={aiDuration}
              options={[
                { value: 'auto', label: t('canvas.storyboard.durationAuto') },
                ...[5, 10, 15, 30].map((value) => ({ value, label: t('canvas.storyboard.durationValue', { seconds: value }) })),
              ]}
              onChange={(value) => setAiDuration(value === 'auto' ? 'auto' : Number(value))}
            />
          </label>
          <label>
            <span>{t('canvas.storyboard.aiExtra')}</span>
            <Input.TextArea value={aiExtra} onChange={(event) => setAiExtra(event.target.value)} autoSize={{ minRows: 2, maxRows: 4 }} placeholder={t('canvas.storyboard.aiExtraPlaceholder')} />
          </label>
          <p className="storyboard-ai-note">{t('canvas.storyboard.aiNote')}</p>
        </div>
      </Modal>
    </Modal>
  );
}
