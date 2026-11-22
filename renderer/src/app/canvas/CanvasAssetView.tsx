import { useEffect, useMemo, useState } from 'react';
import { Button, Select, Upload } from 'antd';
import { AudioLines, Crosshair, FileText, Image, Pencil, Plus, Video } from 'lucide-react';
import { getLocale, t } from '@/i18n';
import { desktopApi } from '../../services/desktopApi';
import { formatSize } from '../../utils/format';
import { mediaExtension } from '../../utils/mediaType';
import { createNodeMediaCatalog, localMediaPath } from '../../utils/nodeMedia';
import { markdownToRichHtml } from '../../utils/richTextMarkdown';
import { textNodeContent } from '../../utils/textNodeContent';
import { IconSymbol } from '../components/IconSymbol';
import { SearchInput } from '../components/SearchInput';
import { useMediaPreviewCache } from './useMediaPreviewCache';
import type { WorkflowNodeData } from './WorkflowCanvas';
import './CanvasAssetView.css';

const kinds = ['text', 'markdown', 'image', 'video', 'audio'] as const;
type Kind = typeof kinds[number];
const nodeKinds: Partial<Record<string, Kind>> = {
  textGeneration: 'text',
  imageGeneration: 'image',
  videoGeneration: 'video',
  audioGeneration: 'audio',
};

const icons = { text: FileText, markdown: FileText, image: Image, video: Video, audio: AudioLines };

interface AssetVersion {
  id: string;
  label: string;
  details: string;
  path: string;
  url: string;
  mimeType: string;
  text: string | undefined;
  size: number;
  date: string;
}
interface CanvasAsset {
  id: string;
  kind: Kind;
  title: string;
  versions: AssetVersion[];
}

function readVersion(media: Record<string, unknown>, id: string, label: string, text?: string): AssetVersion {
  const path = localMediaPath(media);
  return {
    id, label, text,
    details: String(media.fileName || media.name || media.title || ''),
    path,
    url: String(media.url || media.resourceUrl || media.remoteUrl || media.previewUrl || (!path && (media.filePath || media.path)) || ''),
    mimeType: String(media.mimeType || ''),
    size: Number(media.fileSize || media.size || 0),
    date: String(media.createdAt || media.updatedAt || media.importedAt || ''),
  };
}

function canvasAssets(nodes: WorkflowNodeData[]): CanvasAsset[] {
  // View nodes already carry the material and output references resolved by the canvas adapter.
  const catalog = createNodeMediaCatalog();
  return nodes.flatMap(node => {
    let kind = nodeKinds[node.type];
    if (!kind || node.archived) return [];
    const selected = catalog.selected(node);
    const isText = kind === 'text';
    if (isText) {
      const extension = mediaExtension(selected) || mediaExtension(node.title || '');
      if (node.textFormat === 'markdown' || extension === 'md' || extension === 'markdown' || /markdown/i.test(String(selected.mimeType || ''))) kind = 'markdown';
    }
    let text: string | undefined;
    if (isText) {
      if (typeof node.textContent === 'string' || Array.isArray(node.generatedOutputs) && node.generatedOutputs.length) text = textNodeContent(node);
      else if (selected !== node && typeof selected.content === 'string') text = selected.content;
    }
    const current = readVersion(selected, 'current', t('canvas.assetView.current'), text);
    if (!current.text?.trim() && !current.path && !current.url && node.textFormat !== 'markdown') return [];
    current.date ||= String(node.updatedAt || node.createdAt || '');
    const versions = [current];
    if (isText && Array.isArray(node.textVersions)) {
      for (const version of node.textVersions) {
        if (typeof version?.content !== 'string' || version.content === current.text) continue;
        versions.push(readVersion(
          { createdAt: version.createdAt },
          String(version.id),
          version.name || t('canvas.assetView.version', { number: versions.length + 1 }),
          version.content,
        ));
      }
    } else if (!isText) {
      for (const output of catalog.outputs(node)) {
        if (output === selected) continue;
        const version = readVersion(output, String(output.id), t('canvas.assetView.version', { number: versions.length + 1 }));
        if ((version.path || version.url) && (version.path !== current.path || version.url !== current.url)) versions.push(version);
      }
    }
    return [{ id: node.id, kind, title: node.title || current.details || t('canvas.assetView.untitled'), versions }];
  });
}

function AssetPreview({ asset, version, detail = false, compact = false }: {
  asset: CanvasAsset;
  version: AssetVersion;
  detail?: boolean;
  compact?: boolean;
}) {
  const { kind } = asset;
  const textKind = kind === 'text' || kind === 'markdown';
  const { url, retryBuffered } = useMediaPreviewCache({
    path: version.path, fallbackUrl: version.url, kind, mimeType: version.mimeType, revision: version.id,
    enabled: !textKind && (detail || kind !== 'audio'),
  });
  const Icon = icons[kind];
  if (textKind && !compact) {
    if (version.text !== undefined && (detail || version.text)) return <AssetText content={detail ? version.text : version.text.slice(0, 250)} markdown={kind === 'markdown' && detail} />;
    if (detail && version.path) return <LocalAssetText path={version.path} markdown={kind === 'markdown'} />;
  }
  if (kind === 'image' && url) return <img src={url} alt={detail ? asset.title : ''} loading={detail ? 'eager' : 'lazy'} draggable={false} />;
  if (kind === 'video' && url) return <video src={url} controls={detail} preload="metadata" playsInline muted={!detail} onError={retryBuffered} aria-label={asset.title} />;
  if (kind === 'audio' && url && detail) return <audio src={url} controls preload="metadata" onError={retryBuffered} aria-label={asset.title} />;
  return <Icon aria-hidden="true" />;
}

function AssetText({ content, markdown }: { content: string; markdown: boolean }) {
  return markdown
    ? <div className="canvas-asset-markdown" dangerouslySetInnerHTML={{ __html: markdownToRichHtml(content) }} />
    : <pre>{content}</pre>;
}

function LocalAssetText({ path, markdown }: { path: string; markdown: boolean }) {
  const [content, setContent] = useState('');
  useEffect(() => {
    let current = true;
    void desktopApi.file.readArrayBuffer(path).then((bytes: ArrayBuffer | null) => {
      if (current) setContent(bytes ? new TextDecoder().decode(bytes) : t('canvas.assetView.previewError'));
    }).catch(() => {
      if (current) setContent(t('canvas.assetView.previewError'));
    });
    return () => { current = false; };
  }, [path]);
  return <AssetText content={content} markdown={markdown} />;
}

function assetMetadata(version: AssetVersion) {
  const date = new Date(version.date);
  return [
    version.size > 0 ? formatSize(version.size) : '',
    Number.isNaN(date.valueOf()) ? '' : new Intl.DateTimeFormat(getLocale(), {
      month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(date),
  ].filter(Boolean).join(' · ');
}

export function CanvasAssetView({ nodes, onUpload, onLocate, onCreateMarkdown, onEditMarkdown }: {
  nodes: WorkflowNodeData[];
  onUpload: (files?: File[]) => Promise<void>;
  onLocate: (id: string) => void;
  onCreateMarkdown: () => void;
  onEditMarkdown: (id: string) => void;
}) {
  const assets = useMemo(() => canvasAssets(nodes), [nodes]);
  const [query, setQuery] = useState('');
  const [selectedKind, setSelectedKind] = useState<Kind>();
  const [selectedId, setSelectedId] = useState('');
  const [versionId, setVersionId] = useState('current');
  const [collapsed, setCollapsed] = useState<Kind[]>([]);
  const [uploading, setUploading] = useState(false);
  const search = query.trim().toLocaleLowerCase();
  const groups = new Map<Kind, CanvasAsset[]>();
  for (const asset of assets) {
    if (search && !asset.title.toLocaleLowerCase().includes(search)
      && !asset.versions.some(version => [version.details, version.label].some(value => value.toLocaleLowerCase().includes(search)))) continue;
    const items = groups.get(asset.kind);
    if (items) items.push(asset);
    else groups.set(asset.kind, [asset]);
  }
  const kind = selectedKind && (!search || groups.has(selectedKind))
    ? selectedKind
    : kinds.find(item => groups.has(item)) || selectedKind || 'image';
  const items = groups.get(kind) || [];
  const selected = items.find(asset => asset.id === selectedId);
  const version = selected?.versions.find(item => item.id === versionId) || selected?.versions[0];
  const KindIcon = icons[kind];

  function selectAsset(asset: CanvasAsset) {
    setSelectedKind(asset.kind);
    setSelectedId(asset.id);
    setVersionId('current');
  }

  async function upload(files?: File[]) {
    setUploading(true);
    try { await onUpload(files); }
    finally { setUploading(false); }
  }

  function uploadButton(compact: boolean) {
    const browser = desktopApi.platform === 'browser';
    const button = <Button type={compact ? 'text' : 'default'} size={compact ? 'small' : 'middle'}
      loading={uploading} icon={<IconSymbol name="upload" />} onClick={browser ? undefined : () => void upload()}>
      {t('canvas.assetView.upload')}
    </Button>;
    if (!browser) return button;
    return <Upload multiple showUploadList={false} disabled={uploading} beforeUpload={(file, files) => {
      if (file === files[0]) void upload(files);
      return Upload.LIST_IGNORE;
    }}>{button}</Upload>;
  }

  return <div className="canvas-asset-view">
    <aside className="canvas-asset-sidebar" aria-label={t('canvas.assetView.title')}>
      <header>
        <strong>{t('canvas.assetView.title')}</strong>
        <span>{assets.length}</span>
        {uploadButton(true)}
      </header>
      <div className="canvas-asset-search">
        <SearchInput value={query} onChange={value => { setQuery(value); setSelectedId(''); }} placeholder={t('canvas.assetView.search')} />
      </div>
      <ul className="canvas-asset-tree">
        {kinds.map(group => {
          const Icon = icons[group];
          const entries = groups.get(group) || [];
          const open = entries.length > 0 && (Boolean(search) || !collapsed.includes(group));
          return <li key={group}>
            <div className="canvas-asset-category" data-selected={kind === group}>
              {entries.length > 0 && <Button type="text" size="small" className="canvas-asset-disclosure"
                icon={<IconSymbol name="chevron-down" />} aria-expanded={open}
                aria-label={t(open ? 'canvas.assetView.collapse' : 'canvas.assetView.expand', { kind: t(`canvas.assetView.${group}`) })}
                disabled={Boolean(search)}
                onClick={() => setCollapsed(previous => open ? [...previous, group] : previous.filter(item => item !== group))} />}
              <Button type="text" className="canvas-asset-kind" aria-pressed={kind === group}
                onClick={() => {
                  setSelectedKind(group);
                  setSelectedId('');
                  setCollapsed(previous => previous.filter(item => item !== group));
                }}>
                <Icon aria-hidden="true" /><span>{t(`canvas.assetView.${group}`)}</span><span>{entries.length}</span>
              </Button>
            </div>
            {open && <ul>{entries.map(asset => <li key={asset.id}>
              <Button type="text" className="canvas-asset-tree-item" aria-pressed={selected?.id === asset.id}
                title={asset.title} onClick={() => selectAsset(asset)}>
                <span className="canvas-asset-tree-thumb" aria-hidden="true"><AssetPreview asset={asset} version={asset.versions[0]!} compact /></span>
                <span>{asset.title}</span>
              </Button>
            </li>)}</ul>}
          </li>;
        })}
      </ul>
    </aside>
    <section className="canvas-asset-content" aria-label={t('canvas.assetView.title')}>
      <header>
        <KindIcon aria-hidden="true" />
        <h2>{t(`canvas.assetView.${kind}`)}</h2>
        <span>{items.length}</span>
        {kind === 'markdown' && <Button type="text" size="small" icon={<Plus />} onClick={onCreateMarkdown}>
          {t('canvas.assetView.createMarkdown')}
        </Button>}
      </header>
      {selected && version ? <div className="canvas-asset-detail">
        <div className="canvas-asset-detail-header">
          <Button type="text" icon={<IconSymbol name="arrow-left" />} onClick={() => setSelectedId('')}>
            {t('canvas.assetView.back')}
          </Button>
          <h3 title={selected.title}>{selected.title}</h3>
          {selected.versions.length > 1 && <Select aria-label={t('canvas.assetView.versions')} value={version.id} onChange={setVersionId}
            options={selected.versions.map(item => ({ value: item.id, label: item.label }))} />}
          {kind === 'markdown' && version.id === 'current' && <Button icon={<Pencil />} onClick={() => onEditMarkdown(selected.id)}>
            {t('canvas.assetView.editMarkdown')}
          </Button>}
          <Button icon={<Crosshair />} onClick={() => onLocate(selected.id)}>{t('canvas.assetView.locate')}</Button>
        </div>
        <div className="canvas-asset-preview" key={`${selected.id}:${version.id}:${version.path}`}>
          <AssetPreview asset={selected} version={version} detail />
        </div>
      </div> : items.length ? <ul className="canvas-asset-grid">
        {items.map(asset => <li key={asset.id}>
          <button type="button" className="canvas-asset-card" title={asset.title} onClick={() => selectAsset(asset)}>
            <span className="canvas-asset-thumbnail"><AssetPreview asset={asset} version={asset.versions[0]!} /></span>
            <strong>{asset.title}</strong>
            <small>{assetMetadata(asset.versions[0]!)}</small>
          </button>
        </li>)}
      </ul> : <div className="canvas-asset-empty">
        <p>{t(search ? 'canvas.assetView.noMatches' : assets.length ? 'canvas.assetView.emptyKind' : 'canvas.assetView.empty')}</p>
        {!search && !assets.length && uploadButton(false)}
      </div>}
    </section>
  </div>;
}
