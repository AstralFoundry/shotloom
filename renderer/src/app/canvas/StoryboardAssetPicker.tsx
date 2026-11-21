import { useSyncExternalStore, useState } from 'react';
import { Button, Input, Modal, Select, Tooltip } from 'antd';
import { STORYBOARD_ASSET_ROLES, type StoryboardAssetBinding, type StoryboardAssetRole, type StoryboardShot } from '@/domain/graph/StoryboardScript';
import { t } from '@/i18n';
import {
  importStoryboardProjectAsset,
  setStoryboardShotAssetBindings,
  storyboardAssetCandidates,
  storyboardAssetMedia,
  storyboardProjectAssets,
  storyboardShotAssetBindings,
} from '@/services/storyboardScriptService';
import { getDomainRevision, subscribeDomain } from '@/store/domainReactivity';
import { store } from '@/store/projectStore';
import { selectedNodeMedia } from '@/utils/nodeMedia';
import { IconSymbol } from '../components/IconSymbol';
import { NodeThumb } from './NodeThumb';
import { useMediaPreviewCache } from './useMediaPreviewCache';

type AssetNode = Record<string, any>;

function nodeById(nodeId: string): AssetNode | undefined {
  return (store.project.nodes as AssetNode[]).find((node) => node.id === nodeId);
}

function roleLabel(role: StoryboardAssetRole) {
  return t(`canvas.storyboard.assetRole.${role}`);
}

export function StoryboardAssetThumb({ nodeId, media }: { nodeId: string; media?: 'image' | 'video' | 'audio' | undefined }) {
  return media === 'audio' || !media
    ? <IconSymbol name={media === 'audio' ? 'music' : 'image'} />
    : <NodeThumb nodeId={nodeId} className="storyboard-asset-thumb" mediaKind={media} />;
}

export function StoryboardAssetPreview({ node, onClose }: { node: AssetNode; onClose: () => void }) {
  const media = selectedNodeMedia(node, store.project);
  const type = storyboardAssetMedia(node);
  const { url, retryBuffered } = useMediaPreviewCache({
    path: String(media?.filePath || media?.path || ''),
    kind: type || '',
    mimeType: String(media?.mimeType || ''),
    fallbackUrl: String(media?.url || media?.previewUrl || ''),
  });
  return (
    <Modal open centered title={String(node.title || t('canvas.storyboard.referenceFallback'))} onCancel={onClose} footer={null}>
      <div className="storyboard-asset-preview" onClick={(event) => event.stopPropagation()}>
        {url && type === 'image' ? <img src={url} alt={String(node.title || '')} /> : null}
        {url && type === 'video' ? <video src={url} controls onError={retryBuffered} /> : null}
        {url && type === 'audio' ? <audio src={url} controls onError={retryBuffered} /> : null}
      </div>
    </Modal>
  );
}

export function StoryboardAssetChips({ nodeId, shot }: { nodeId: string; shot: StoryboardShot }) {
  const bindings = storyboardShotAssetBindings(nodeId, shot);
  const [previewId, setPreviewId] = useState('');
  const previewNode = previewId ? nodeById(previewId) : undefined;
  return (
    <>
      {bindings.slice(0, 2).map((binding) => {
        const node = nodeById(binding.nodeId);
        const title = node?.title || t('canvas.storyboard.missingAsset');
        return (
          <Tooltip key={binding.nodeId} title={`${title} · ${roleLabel(binding.role)}`}>
            <button type="button" className="storyboard-asset-chip nodrag" disabled={!node || !storyboardAssetMedia(node)}
              aria-label={t('canvas.storyboard.previewAsset', { title })} onClick={(event) => {
                event.stopPropagation();
                setPreviewId(binding.nodeId);
              }}>
              <StoryboardAssetThumb nodeId={binding.nodeId} media={node && storyboardAssetMedia(node)} />
              <small>{roleLabel(binding.role).slice(0, 1)}</small>
            </button>
          </Tooltip>
        );
      })}
      {bindings.length > 2 ? <span>+{bindings.length - 2}</span> : null}
      {previewNode ? <StoryboardAssetPreview node={previewNode} onClose={() => setPreviewId('')} /> : null}
    </>
  );
}

export function StoryboardAssetPicker({ nodeId, shot, onClose }: { nodeId: string; shot: StoryboardShot; onClose: () => void }) {
  useSyncExternalStore(subscribeDomain, getDomainRevision);
  const [draft, setDraft] = useState(() => storyboardShotAssetBindings(nodeId, shot));
  const [query, setQuery] = useState('');
  const [role, setRole] = useState<StoryboardAssetRole | 'all'>('all');
  const [library, setLibrary] = useState(false);
  const [error, setError] = useState('');
  const bindings = new Map(draft.map((item) => [item.nodeId, item]));
  const roles = STORYBOARD_ASSET_ROLES.map((value) => ({ value, label: roleLabel(value) }));
  const keyword = query.trim().toLocaleLowerCase();
  const matches = (text: string, type: StoryboardAssetRole) => (role === 'all' || role === type) && text.toLocaleLowerCase().includes(keyword);
  const candidates = storyboardAssetCandidates(new Set(bindings.keys())).filter(({ node, role: defaultRole }) => (
    matches([node.title, ...(Array.isArray(node.assetTags) ? node.assetTags : [])].filter(Boolean).join(' '), bindings.get(node.id)?.role ?? defaultRole)
  ));
  const projectAssets = library ? storyboardProjectAssets().filter(({ asset, role: type }) => (
    matches([asset.name, ...(Array.isArray(asset.tags) ? asset.tags : [])].filter(Boolean).join(' '), type)
  )) : [];

  function toggle(binding: StoryboardAssetBinding) {
    setDraft((current) => current.some((item) => item.nodeId === binding.nodeId)
      ? current.filter((item) => item.nodeId !== binding.nodeId)
      : [...current, binding]);
  }

  return (
    <Modal
      open
      centered
      width={760}
      title={t('canvas.storyboard.assetPickerTitle', { index: shot.shotNumber })}
      okText={t('canvas.storyboard.assetPickerApply')}
      cancelText={t('canvas.storyboard.cancel')}
      onCancel={onClose}
      onOk={() => {
        if (!setStoryboardShotAssetBindings(nodeId, shot.id, draft)) { setError(t('canvas.storyboard.missingAsset')); return; }
        onClose();
      }}
    >
      <div className="storyboard-asset-picker nodrag nowheel" onClick={(event) => event.stopPropagation()}>
        <p>{t('canvas.storyboard.assetRoleHint')}</p>
        <div className="storyboard-asset-toolbar">
          <Input allowClear value={query} placeholder={t('canvas.storyboard.searchAssets')} onChange={(event) => setQuery(event.target.value)} />
          <Select aria-label={t('canvas.storyboard.filterAssets')} value={role} onChange={setRole}
            options={[{ value: 'all', label: t('canvas.storyboard.allAssets') }, ...roles]} />
          <Button onClick={() => { setLibrary(!library); setError(''); }}>{t(library ? 'canvas.storyboard.canvasAssets' : 'canvas.storyboard.projectAssets')}</Button>
        </div>
        <div className="storyboard-asset-grid">
          {library ? projectAssets.map(({ asset, media, role: assetRole }) => (
            <button className="storyboard-asset-card" type="button" key={asset.id} onClick={() => {
              const binding = importStoryboardProjectAsset(String(asset.id));
              if (!binding) { setError(t('canvas.storyboard.missingAsset')); return; }
              setDraft((current) => current.some((item) => item.nodeId === binding.nodeId) ? current : [...current, binding]);
              setLibrary(false);
              setError('');
            }}>
              <IconSymbol name={media === 'audio' ? 'music' : media === 'video' ? 'film' : 'image'} />
              <span>{String(asset.name || t('canvas.storyboard.referenceFallback'))}</span>
              <small>{roleLabel(assetRole)}</small>
            </button>
          )) : candidates.map(({ node, media, role: defaultRole }) => (
            <button className="storyboard-asset-card" type="button" key={node.id} aria-pressed={bindings.has(node.id)}
              onClick={() => toggle({ nodeId: String(node.id), role: defaultRole })}>
              <StoryboardAssetThumb nodeId={String(node.id)} media={media} />
              <span>{String(node.title || t('canvas.storyboard.referenceFallback'))}</span>
              <small>{roleLabel(bindings.get(node.id)?.role ?? defaultRole)}</small>
            </button>
          ))}
          {!(library ? projectAssets.length : candidates.length) ? <div className="storyboard-asset-empty">{t('canvas.storyboard.noMatchingAssets')}</div> : null}
        </div>
        {error ? <p role="alert" className="storyboard-batch-error">{error}</p> : null}
        <div className="storyboard-asset-selected">
          <header>
            <span>{t('canvas.storyboard.selectedAssets', { count: draft.length })}</span>
            <Button size="small" type="text" disabled={!draft.length} onClick={() => setDraft([])}>{t('canvas.storyboard.clearSelection')}</Button>
          </header>
          <div className="storyboard-asset-bindings">
            {draft.map((item) => {
              const title = String(nodeById(item.nodeId)?.title || t('canvas.storyboard.missingAsset'));
              return (
                <div className="storyboard-asset-binding" key={item.nodeId}>
                  <span title={title}>{title}</span>
                  <Select size="small" aria-label={t('canvas.storyboard.assetUsage', { title })} value={item.role} options={roles}
                    onChange={(value) => setDraft((current) => current.map((binding) => binding.nodeId === item.nodeId ? { ...binding, role: value } : binding))} />
                  <Button size="small" type="text" aria-label={t('canvas.storyboard.removeAsset', { title })} onClick={() => toggle(item)}><IconSymbol name="x" /></Button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Modal>
  );
}
