import { getLocale, t } from '@/i18n';
import { CANVAS_AGENT_ID, EDITOR_AGENT_ID, TEXT_AGENT_ID } from '../../agent/agents/definitions';
import { convertFileSrc } from '@tauri-apps/api/core';
import { selectedNodeMedia, localMediaPath } from '../../utils/nodeMedia';
import { inferMediaType } from '../../utils/mediaType';
import { openMediaViewer } from '../store/overlayStore';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { subscribeDomain, getDomainRevision } from '../../store/domainReactivity';
import { getAgentProjectIdentity } from '../../services/agentProjectIdentity';
import { openHarnessPanel } from '../agent-session/harnessIntegration';
import { readHarnessCanvasReference, type ProductBinding } from '../../services/harnessProductTools';
import { store, touchProject } from '../../store/projectStore';
import { createHarnessSession, scopedHarnessSessions } from '../../services/harnessSessionStore';
import { focusCanvasNodes } from '../adapters/canvasAdapter';
import { useAppStore } from '../store/appStore';
import { HarnessSessionToolbar } from './HarnessSessionToolbar';

/** Official chat runs in its own document, including its React and state engines. */
export function HarnessChatPanel({ agentId, nodeId, onClose, onStatusChange }: {
  agentId: ProductBinding['agentId']; nodeId?: string; onClose?: () => void; onStatusChange?: (status: 'loading' | 'ready' | 'error') => void;
}) {
  useSyncExternalStore(subscribeDomain, getDomainRevision, getDomainRevision);
  const identity = getAgentProjectIdentity();
  const iframe = useRef<HTMLIFrameElement>(null);
  const container = useRef<HTMLElement>(null);
  const [selectedId, setSelectedId] = useState('');
  const [retry, setRetry] = useState(0);
  const [frameError, setFrameError] = useState('');
  const sessions = scopedHarnessSessions(store.project, agentId === CANVAS_AGENT_ID ? 'canvas' : agentId === EDITOR_AGENT_ID ? 'editor' : 'text', nodeId);
  const selected = sessions.find(item => item.id === selectedId) ?? sessions.find(item => item.id === store.project.activeHarnessSessionId) ?? sessions[0];
  const [panel, setPanel] = useState<{ key: string; url?: string; sessionId?: string; error?: string }>();
  const key = `${identity.fenceKey}:${agentId}:${nodeId ?? ''}:${selected?.id ?? ''}`;
  useEffect(() => {
    let active = true;
    onStatusChange?.('loading');
    setPanel({ key });
    setFrameError('');
    const timeout = window.setTimeout(() => {
      if (active) { setFrameError(t('agent.connectionTimeout')); onStatusChange?.('error'); }
    }, 45_000);
    void openHarnessPanel(agentId, nodeId, selected?.id).then(result => {
      if (active) {
        window.clearTimeout(timeout);
        const url = new URL(result.url);
        const fragment = new URLSearchParams(url.hash.slice(1));
        fragment.set('shotloomParentOrigin', window.location.origin);
        fragment.set('shotloomAgentId', agentId);
        fragment.set('shotloomLocale', getLocale());
        url.hash = fragment.toString();
        setPanel({ key, url: url.href, sessionId: result.sessionId });
      }
    }).catch(error => { if (active) { window.clearTimeout(timeout); setPanel({ key, error: String(error) }); onStatusChange?.('error'); } });
    return () => { active = false; window.clearTimeout(timeout); };
  }, [key, agentId, nodeId, selected?.id, retry, onStatusChange]);
  useEffect(() => {
    if (panel?.key !== key || !panel.url) return;
    const origin = new URL(panel.url).origin;
    const timeout = window.setTimeout(() => { setFrameError(t('agent.viewTimeout')); onStatusChange?.('error'); }, 30_000);
    const headerLayout = () => {
      const root = container.current;
      const title = root?.querySelector('.harness-session-trigger')?.getBoundingClientRect();
      const actions = root?.querySelector('.harness-session-actions')?.getBoundingClientRect();
      const toolbar = root?.querySelector('.harness-chat-toolbar')?.getBoundingClientRect();
      if (!root || !title || !actions || !toolbar) return;
      const bounds = root.getBoundingClientRect();
      iframe.current?.contentWindow?.postMessage({ type: 'shotloom:header-layout', sessionId: panel.sessionId,
        left: title.right - bounds.left + 10, right: bounds.right - actions.left + 8, height: toolbar.height,
      }, origin);
    };
    const receive = (event: MessageEvent) => {
      if (event.source !== iframe.current?.contentWindow || event.origin !== origin || event.data?.sessionId !== panel.sessionId) return;
      if (event.data.type === 'shotloom:chat-status' && ['ready', 'error', 'loading'].includes(event.data.phase)) {
        if (event.data.phase !== 'loading') window.clearTimeout(timeout);
        setFrameError(event.data.phase === 'error' ? String(event.data.error || t('agent.viewFailed')) : '');
        onStatusChange?.(event.data.phase);
        return;
      }
      if (event.data.type === 'shotloom:preview-node' && typeof event.data.nodeId === 'string') {
        const referenceId = event.data.nodeId;
        void readHarnessCanvasReference(panel.sessionId!, referenceId).then(() => {
          const node = store.project.nodes.find((item: { id: string }) => item.id === referenceId);
          const media = selectedNodeMedia(node, store.project);
          const kind = media && inferMediaType(media);
          const path = localMediaPath(media);
          if (media && path && (kind === 'image' || kind === 'video')) openMediaViewer({
            src: convertFileSrc(path), kind, filePath: path, title: String(media.fileName || media.name || node.title || t('canvas.media')),
          });
        }).catch(error => console.error('画布媒体预览失败', error));
        return;
      }
      if (event.data.type === 'shotloom:canvas-reference') {
        const { requestId, nodeId: referenceId, withImage } = event.data;
        if (typeof requestId !== 'string' || (referenceId !== undefined && typeof referenceId !== 'string')) return;
        void readHarnessCanvasReference(panel.sessionId!, referenceId, withImage === true).then(
          result => iframe.current?.contentWindow?.postMessage({ type: 'shotloom:canvas-reference-result', sessionId: panel.sessionId, requestId, result }, origin),
          error => iframe.current?.contentWindow?.postMessage({ type: 'shotloom:canvas-reference-result', sessionId: panel.sessionId, requestId, error: String(error) }, origin));
        return;
      }
      if (event.data.type === 'shotloom:header-ready') { headerLayout(); return; }
      if (event.data.type !== 'shotloom:tool-navigation' || !Array.isArray(event.data.ids)) return;
      const ids = event.data.ids.filter((id: unknown): id is string => typeof id === 'string');
      if (event.data.kind === 'nodes') focusCanvasNodes(ids.filter((id: string) => store.project.nodes.some((node: { id: string }) => node.id === id)));
      if (event.data.kind === 'tasks' && ids.some((id: string) => store.project.tasks?.some((task: { id: string }) => task.id === id))) useAppStore.getState().setRoute('tasks');
    };
    const mention = (event: Event) => {
      if (agentId !== CANVAS_AGENT_ID && agentId !== EDITOR_AGENT_ID) return;
      const nodeId = (event as CustomEvent<unknown>).detail;
      if (typeof nodeId !== 'string' || !store.project.nodes.some((node: { id: string }) => node.id === nodeId)) return;
      iframe.current?.contentWindow?.postMessage({ type: 'shotloom:mention-node', nodeId, sessionId: panel.sessionId }, origin);
    };
    window.addEventListener('message', receive);
    window.addEventListener('shotloom:mention-node', mention);
    const observer = new ResizeObserver(headerLayout);
    for (const target of container.current?.querySelectorAll('.harness-chat-toolbar, .harness-session-trigger, .harness-session-actions') ?? []) observer.observe(target);
    headerLayout();
    iframe.current?.contentWindow?.postMessage({ type: 'shotloom:chat-status-request', sessionId: panel.sessionId }, origin);
    return () => { window.clearTimeout(timeout); observer.disconnect(); window.removeEventListener('message', receive); window.removeEventListener('shotloom:mention-node', mention); };
  }, [panel, key, agentId, onStatusChange]);
  return <section ref={container} className="harness-chat-panel">
    <HarnessSessionToolbar sessions={sessions} selectedId={selected?.id} onSelect={setSelectedId} onClose={onClose}
      onCreate={() => { const created = createHarnessSession(store.project, { agentId, ...(agentId === TEXT_AGENT_ID ? { textNodeId: nodeId! } : agentId === EDITOR_AGENT_ID ? { editorNodeId: nodeId! } : {}) }); setSelectedId(created.id!); touchProject(); }} />
    {panel?.key === key && panel.url ? <iframe ref={iframe} title="Shotloom Agent" src={panel.url}
      className="harness-chat-frame"
      onLoad={() => iframe.current?.contentWindow?.postMessage({ type: 'shotloom:chat-status-request', sessionId: panel.sessionId }, new URL(panel.url!).origin)}
      onError={() => { setFrameError(t('agent.viewUnavailable')); onStatusChange?.('error'); }}
      allow="clipboard-read; clipboard-write" />
      : <p role={panel?.key === key && panel.error ? 'alert' : 'status'}>{panel?.key === key && panel.error ? panel.error : t('agent.connecting')}</p>}
    {(frameError || (panel?.key === key && panel.error)) && <div className="harness-connection-error" role="alert">
      {frameError && <span>{frameError}</span>}
      <button type="button" className="button ghost" onClick={() => setRetry(value => value + 1)}>{t('agent.retryConnection')}</button>
    </div>}
  </section>;
}
