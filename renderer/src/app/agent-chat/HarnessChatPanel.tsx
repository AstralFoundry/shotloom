import { getLocale, t } from '@/i18n';
import { CANVAS_AGENT_ID, DIRECTOR_AGENT_ID, EDITOR_AGENT_ID, TEXT_AGENT_ID } from '../../agent/agents/definitions';
import { convertFileSrc } from '@tauri-apps/api/core';
import { selectedNodeMedia, localMediaPath } from '../../utils/nodeMedia';
import { inferMediaType } from '../../utils/mediaType';
import { openMediaViewer } from '../store/overlayStore';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { subscribeDomain, getDomainRevision } from '../../store/domainReactivity';
import { getAgentProjectIdentity } from '../../services/agentProjectIdentity';
import { openHarnessPanel, setHarnessSessionsArchived } from '../agent-session/harnessIntegration';
import { readHarnessCanvasReference, type ProductBinding } from '../../services/harnessProductTools';
import { store, touchProject } from '../../store/projectStore';
import { createHarnessSession, deleteHarnessSession, scopedHarnessSessions } from '../../services/harnessSessionStore';
import { focusCanvasNodes } from '../adapters/canvasAdapter';
import { useAppStore } from '../store/appStore';
import { showToast } from '../../store/notificationStore';
import { mountHarnessClient } from '../agent-session/harnessClient';
import { HarnessSessionToolbar } from './HarnessSessionToolbar';

/** Official chat keeps its own React and state engines inside a ShadowRoot. */
export function HarnessChatPanel({ agentId, nodeId, onClose, onStatusChange, directorEntityRequest, onDirectorEntityInserted }: {
  agentId: ProductBinding['agentId']; nodeId?: string; onClose?: () => void; onStatusChange?: (status: 'loading' | 'ready' | 'error') => void;
  directorEntityRequest?: { id: string; nonce: number } | undefined;
  onDirectorEntityInserted?: ((nonce: number) => void) | undefined;
}) {
  useSyncExternalStore(subscribeDomain, getDomainRevision, getDomainRevision);
  const identity = getAgentProjectIdentity();
  const surface = useRef<HTMLDivElement>(null);
  const container = useRef<HTMLElement>(null);
  const [selectedId, setSelectedId] = useState('');
  const [retry, setRetry] = useState(0);
  const [frameError, setFrameError] = useState('');
  const entityRequestRef = useRef(directorEntityRequest);
  const deliveredEntityRequest = useRef(0);
  const deliveringEntityRequest = useRef(0);
  const deliverEntityRef = useRef<(() => void) | null>(null);
  const insertedRef = useRef(onDirectorEntityInserted);
  entityRequestRef.current = directorEntityRequest;
  insertedRef.current = onDirectorEntityInserted;
  useEffect(() => { deliverEntityRef.current?.(); }, [directorEntityRequest]);
  const sessions = scopedHarnessSessions(store.project, agentId === CANVAS_AGENT_ID ? 'canvas' : agentId === DIRECTOR_AGENT_ID ? 'director' : agentId === EDITOR_AGENT_ID ? 'editor' : 'text', nodeId);
  const selected = sessions.find(item => item.id === selectedId) ?? sessions.find(item => item.id === store.project.activeHarnessSessionId) ?? sessions[0];
  const [panel, setPanel] = useState<{ key: string; sessionId?: string; tools?: string[]; toolTitles?: Record<string, string>; error?: string }>();
  const key = `${identity.fenceKey}:${agentId}:${nodeId ?? ''}:${selected?.id ?? ''}`;
  useEffect(() => {
    const root = container.current;
    if (!root) return;
    const update = () => {
      const title = root.querySelector('.harness-session-trigger')?.getBoundingClientRect();
      const actions = root.querySelector('.harness-session-actions')?.getBoundingClientRect();
      const toolbar = root.querySelector('.harness-chat-toolbar')?.getBoundingClientRect();
      if (!title || !actions || !toolbar || !surface.current) return;
      const bounds = root.getBoundingClientRect();
      surface.current.style.setProperty('--shotloom-header-left', `${title.right - bounds.left + 10}px`);
      surface.current.style.setProperty('--shotloom-header-right', `${bounds.right - actions.left + 8}px`);
      surface.current.style.setProperty('--shotloom-header-height', `${toolbar.height}px`);
    };
    const observer = new ResizeObserver(update);
    for (const target of root.querySelectorAll('.harness-chat-toolbar, .harness-session-trigger, .harness-session-actions')) observer.observe(target);
    update();
    return () => observer.disconnect();
  }, []);
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
        setPanel({ key, sessionId: result.sessionId, tools: result.tools, toolTitles: result.toolTitles });
      }
    }).catch(error => { if (active) { window.clearTimeout(timeout); setPanel({ key, error: String(error) }); onStatusChange?.('error'); } });
    return () => { active = false; window.clearTimeout(timeout); };
  }, [key, agentId, nodeId, selected?.id, retry, onStatusChange]);
  useEffect(() => {
    if (panel?.key !== key || !panel.sessionId || !surface.current) return;
    let active = true;
    let mounted: { dispose(): void } | undefined;
    const sessionId = panel.sessionId;
    const mentions = new Set<(nodeId: string) => void>();
    const deliverEntity = async () => {
      const request = entityRequestRef.current;
      if (agentId !== DIRECTOR_AGENT_ID || !request || !mentions.size ||
        request.nonce === deliveredEntityRequest.current || deliveringEntityRequest.current) return;
      deliveringEntityRequest.current = request.nonce;
      try {
        const catalog = await readHarnessCanvasReference(sessionId);
        const reference = ('nodes' in catalog ? catalog.nodes : undefined)?.find(item => item.referenceScope === 'director-entity' &&
          item.id.endsWith(`:${encodeURIComponent(request.id)}`));
        if (!reference) throw new Error('选中的导演台物体已不在当前场景中');
        if (!active) return;
        deliveredEntityRequest.current = request.nonce;
        for (const listener of mentions) listener(reference.id);
        insertedRef.current?.(request.nonce);
      } catch (error) {
        if (active) showToast(String(error), 'error');
      } finally {
        deliveringEntityRequest.current = 0;
        if (active && entityRequestRef.current?.nonce !== request.nonce) void deliverEntity();
      }
    };
    deliverEntityRef.current = () => { void deliverEntity(); };
    const mention = (event: Event) => {
      const nodeId = (event as CustomEvent<unknown>).detail;
      if (typeof nodeId === 'string' && store.project.nodes.some((node: { id: string }) => node.id === nodeId)) for (const listener of mentions) listener(nodeId);
    };
    window.addEventListener('shotloom:mention-node', mention);
    void mountHarnessClient(surface.current, {
      sessionId, agentId, locale: getLocale(), tools: panel.tools ?? [], toolTitles: panel.toolTitles ?? {},
      readReference: (nodeId, withImage) => readHarnessCanvasReference(sessionId, nodeId, withImage),
      preview(nodeId) {
        void readHarnessCanvasReference(sessionId, nodeId).then(() => {
          const node = store.project.nodes.find((item: { id: string; title?: string }) => item.id === nodeId);
          const media = selectedNodeMedia(node, store.project);
          const kind = media && inferMediaType(media);
          const path = localMediaPath(media);
          if (media && path && (kind === 'image' || kind === 'video')) openMediaViewer({ src: convertFileSrc(path), kind, filePath: path, title: String(media.fileName || media.name || node?.title || t('canvas.media')) });
        }).catch(console.error);
      },
      navigate(kind, ids) {
        if (kind === 'nodes') focusCanvasNodes(ids.filter(id => store.project.nodes.some((node: { id: string }) => node.id === id)));
        if (kind === 'tasks' && ids.some(id => store.project.tasks?.some((task: { id: string }) => task.id === id))) useAppStore.getState().setRoute('tasks');
      },
      status(phase, error) { if (active) { setFrameError(error ?? ''); onStatusChange?.(phase); } },
      subscribeMention(listener) { mentions.add(listener); void deliverEntity(); return () => { mentions.delete(listener); }; },
    }).then(result => { if (active) mounted = result; else result.dispose(); }).catch(error => {
      if (active) { setFrameError(String(error)); onStatusChange?.('error'); }
    });
    return () => { active = false; deliverEntityRef.current = null; mounted?.dispose(); window.removeEventListener('shotloom:mention-node', mention); };
  }, [panel, key, agentId, onStatusChange]);
  return <section ref={container} className="harness-chat-panel">
    <HarnessSessionToolbar sessions={sessions} selectedId={selected?.id} onSelect={setSelectedId} onClose={onClose}
      onDelete={async id => {
        const target = sessions.find(session => session.id === id);
        if (!target) return;
        if (target.harnessSessionId) await setHarnessSessionsArchived(identity.projectKey, [target.harnessSessionId], true);
        if (getAgentProjectIdentity().fenceKey !== identity.fenceKey) return;
        deleteHarnessSession(store.project, id);
        const remaining = store.project.harnessSessions?.length
          ? scopedHarnessSessions(store.project, agentId === CANVAS_AGENT_ID ? 'canvas' : agentId === DIRECTOR_AGENT_ID ? 'director' : agentId === EDITOR_AGENT_ID ? 'editor' : 'text', nodeId) : [];
        const next = remaining.find(session => session.id === selected?.id) || remaining[0] || createHarnessSession(store.project, { agentId, ...(agentId === TEXT_AGENT_ID ? { textNodeId: nodeId! } : agentId === EDITOR_AGENT_ID ? { editorNodeId: nodeId! } : agentId === DIRECTOR_AGENT_ID && nodeId ? { directorNodeId: nodeId } : {}) });
        setSelectedId(next.id!);
        touchProject({ sessionDelay: 0, coalesceSession: false });
      }}
      onCreate={() => { const created = createHarnessSession(store.project, { agentId, ...(agentId === TEXT_AGENT_ID ? { textNodeId: nodeId! } : agentId === EDITOR_AGENT_ID ? { editorNodeId: nodeId! } : agentId === DIRECTOR_AGENT_ID && nodeId ? { directorNodeId: nodeId } : {}) }); setSelectedId(created.id!); touchProject(); }} />
    <div ref={surface} className="harness-chat-frame" />
    {panel?.key === key && !panel.sessionId && !panel.error && <p role="status">{t('agent.connecting')}</p>}
    {panel?.key === key && panel.error && <p role="alert">{panel.error}</p>}
    {(frameError || (panel?.key === key && panel.error)) && <div className="harness-connection-error" role="alert">
      {frameError && <span>{frameError}</span>}
      <button type="button" className="button ghost" onClick={() => setRetry(value => value + 1)}>{t('agent.retryConnection')}</button>
    </div>}
  </section>;
}
