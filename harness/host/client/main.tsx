import { t } from './i18n';
import { locale as productLocale } from './i18n';
import { Context } from '@deepseek-ai/cordis';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ComponentType } from 'react';
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives';
import { getStaticModules } from '@deepseek-ai/dsh-client-web';
import type { DshWindow } from '@deepseek-ai/dsh-client-modules/client';
import type { Context as ClientContext } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client';
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
import type {} from '@deepseek-ai/dsh-client-ui-plan/client';
import type {} from '@deepseek-ai/dsh-client-ui-user-questions/client';
import type {} from '@deepseek-ai/dsh-api-session-controller/client';
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client';
import type { InjectFace, PropsRenderFactories, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { ConversationViewsProps } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client';
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-chat/client';
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client';
import { installEmbeddedSubagents } from './embeddedSubagents';
import { installCanvasReferences } from './canvasReferences';
import { EmptyBrand } from './emptyBrand';
import { installComposerControls } from './composerControls';
import type { TokenSpan } from '@deepseek-ai/dsh-client-ui-input-trigger/client';
import './style.css';

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'shotloom.chat': { kind: 'single'; scope: 'session' };
    'shotloom.stats': { kind: 'list'; scope: 'session' };
  }
}

const SelectedView = createContext('chat');
// Authenticated embed URLs carry the product origin because the Host's
// no-referrer policy also removes document.referrer after its login redirect.
function embeddedParentOrigin() {
  if (parent === window) return undefined;
  const origin = new URLSearchParams(location.hash.slice(1)).get('shotloomParentOrigin');
  if (origin && /^(https?:\/\/|tauri:\/\/)[^/?#]+$/.test(origin)) return origin;
  return document.referrer ? new URL(document.referrer).origin : undefined;
}
let embeddedChatPhase: 'loading' | 'ready' | 'error' = 'loading';
let embeddedChatError: string | undefined;
function publishChatStatus(phase = embeddedChatPhase, error = embeddedChatError) {
  embeddedChatPhase = phase;
  embeddedChatError = error;
  document.documentElement.dataset.shotloomChat = phase;
  const origin = embeddedParentOrigin();
  if (origin) parent.postMessage({ type: 'shotloom:chat-status', phase, error,
    sessionId: new URLSearchParams(location.hash.slice(1)).get('sessionId') }, origin);
}
window.addEventListener('message', event => {
  if (event.source !== parent || event.origin !== embeddedParentOrigin() || event.data?.type !== 'shotloom:chat-status-request'
    || event.data.sessionId !== new URLSearchParams(location.hash.slice(1)).get('sessionId')) return;
  publishChatStatus();
});

function OfficialView({ renderSlot }: ConversationViewsProps) {
  const view = useContext(SelectedView);
  return renderSlot('conversation.session', { view });
}
const CONTENT_SLOTS = { views: OfficialView };
interface ChatActions { useBlank(): boolean; activateView(view: string): void; mentionNode(nodeId: string, span: TokenSpan): void }
type ChatProps = PropsRuntime<'shotloom.chat'> & InjectFace<ChatActions> & PropsRenderFactories & PropsRenderSlots<'shotloom.stats'>;
function EmbeddedChat({ activateView, renderFactorySlot, renderSlot, inputActions, mentionNode, useBlank }: ChatProps) {
  const blank = useBlank();
  // The embedded panel opens directly in the official conversation view.
  useEffect(() => { activateView('chat'); }, [activateView]);
  useEffect(() => {
    const origin = embeddedParentOrigin();
    if (!origin) return;
    const receive = (event: MessageEvent) => {
      if (event.source !== parent || event.origin !== origin || event.data?.sessionId !== new URLSearchParams(location.hash.slice(1)).get('sessionId')) return;
      if (event.data.type === 'shotloom:header-layout') {
        for (const key of ['left', 'right', 'height'] as const) {
          const value = event.data[key];
          if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return;
        }
        const style = document.documentElement.style;
        style.setProperty('--shotloom-header-left', `${event.data.left}px`);
        style.setProperty('--shotloom-header-right', `${event.data.right}px`);
        style.setProperty('--shotloom-header-height', `${event.data.height}px`);
        return;
      }
      if (event.data.type !== 'shotloom:mention-node') return;
      if (typeof event.data.nodeId !== 'string') return;
      mentionNode(event.data.nodeId, inputActions.captureInsertion());
    };
    window.addEventListener('message', receive);
    publishChatStatus('ready');
    parent.postMessage({ type: 'shotloom:header-ready', sessionId: new URLSearchParams(location.hash.slice(1)).get('sessionId') }, origin);
    return () => window.removeEventListener('message', receive);
  }, [inputActions, mentionNode]);
  return <SelectedView.Provider value="chat"><div className="shotloom-chat-body">
    <aside className="shotloom-session-stats" aria-label={t("ui.main.arialabel.d703e30e")}>{renderSlot('shotloom.stats', {})}</aside>
    <div id="shotloom-context-meter" className="shotloom-context-meter" />
    {blank && <EmptyBrand />}
    {renderFactorySlot('conversation.content', { variant: 'embedded', phase: 'active', hero: false }, { slots: CONTENT_SLOTS })}
  </div></SelectedView.Provider>;
}

function ProductToolCard({ toolName, phase, block, inspect, label }: ToolCallViewProps & { label: string }) {
  let receipt: Record<string, unknown> | undefined;
  let payload: Record<string, unknown> | undefined;
  let raw = '';
  if (phase === 'result') {
    raw = block.content.filter(row => row.type === 'text').map(row => row.text).join('\n');
    try {
      payload = JSON.parse(raw);
      receipt = payload?.result as Record<string, unknown> | undefined;
      raw = JSON.stringify(payload, null, 2);
    } catch { /* Non-JSON recorded output remains inspectable as text. */ }
  }
  const result = receipt?.result as Record<string, unknown> | undefined;
  const failed = phase === 'result' && (block.isError || payload?.success === false || receipt?.success === false || result?.success === false);
  const message = [payload?.error, receipt?.error, result?.error, result?.message, result?.summary].find(value => typeof value === 'string') as string | undefined;
  const references = receipt?.references as { nodeIds?: string[]; taskIds?: string[] } | undefined;
  const navigate = (kind: 'nodes' | 'tasks', ids: string[]) => {
    const origin = embeddedParentOrigin();
    if (!origin) return;
    parent.postMessage({ type: 'shotloom:tool-navigation', sessionId: new URLSearchParams(location.hash.slice(1)).get('sessionId'), kind, ids }, origin);
  };
  return <details className="shotloom-tool-card" data-state={failed ? 'error' : phase === 'result' ? 'done' : 'running'}>
    <summary><span className="shotloom-tool-indicator" aria-hidden="true" /><span className="shotloom-tool-name" title={toolName}>{label}</span>
      <span className="shotloom-tool-status">{phase === 'result' ? (failed ? t("ui.main.text.b61b08ae") : t("ui.taskAdapter.label.e99b48a2")) : t("ui.StatusPill.running.59424970")}</span><span className="shotloom-tool-chevron" aria-hidden="true">⌄</span></summary>
    <div className="shotloom-tool-body">
      {message && <p>{message}</p>}
      <div className="shotloom-tool-actions">
        {!!references?.nodeIds?.length && <button onClick={() => navigate('nodes', references.nodeIds!)}>{t("ui.main.text.7d7b2d9e")}</button>}
        {!!references?.taskIds?.length && <button onClick={() => navigate('tasks', references.taskIds!)}>{t("ui.main.text.ec20beb2")}</button>}
        {inspect && <button onClick={inspect}>{t("ui.main.text.86ff6f36")}</button>}
      </div>
      {phase === 'result' && <details className="shotloom-tool-data"><summary>{t("ui.main.text.667422e4")}</summary><pre tabIndex={0} aria-label={t("ui.main.text.816f1556", { value0: label })}>{raw}</pre></details>}
    </div>
  </details>;
}

/** Presentation adapter for our own reference envelope. Official user nodes,
 * transcript projections, attachments, timestamps and controls remain intact. */
function installCanvasReferenceCards(ctx: ClientContext) {
  const entry = ctx.slots.entriesOfSlot('conversation.chat.node').find(row => row.options.key === 'user');
  if (!entry) throw new Error(t('agent.client.userMessageMissing'));
  const Official = entry.component as ComponentType<ChatNodeViewProps<'user'>>;
  function ReferencedMessage(props: ChatNodeViewProps<'user'>) {
    const references: Array<{ id: string; label: string }> = [];
    const content = props.node.data.content.map(block => {
      if (block.type !== 'text') return block;
      const text = block.text.replace(/<shotloom-canvas-reference>\s*([\s\S]*?)\s*<\/shotloom-canvas-reference>/g, (original, payload: string) => {
        try {
          const value = JSON.parse(payload);
          if (typeof value.node?.id !== 'string' || typeof value.node?.label !== 'string' || !value.snapshot) return original;
          references.push({ id: value.node.id, label: value.node.label });
          return `@"${value.node.label.replaceAll('"', '’')}"`;
        } catch { return original; }
      });
      return { ...block, text };
    });
    return <Official {...props} node={{ ...props.node, data: { ...props.node.data, content } }} openFile={(path, options) => {
      const reference = references.find(item => item.label.replaceAll('"', '’') === path);
      if (!reference) { props.openFile(path, options); return; }
      const origin = embeddedParentOrigin();
      if (origin) parent.postMessage({ type: 'shotloom:tool-navigation', sessionId: new URLSearchParams(location.hash.slice(1)).get('sessionId'), kind: 'nodes', ids: [reference.id] }, origin);
    }} />;
  }
  ctx.slots.register({ name: 'conversation.chat.node', key: 'user', priority: -100, locale: entry.locale } as never, ReferencedMessage as never);
}

const markdownLabels = { code: { copyLabel: t("ui.ProjectsView.text.4edd1d00"), copiedLabel: t("ui.resourceLibraryAdapter.text.e381a576"), toolbarLabels: { codeLabel: t("ui.main.codeLabel.33246dda"), wrapLabel: t("ui.main.wrapLabel.8ad6b817"), unwrapLabel: t("ui.main.unwrapLabel.3c91fb28") } }, footnotes: t("ui.main.footnotes.49a132a7") };

/** Keep the official Plan cards, stores and review controls; replace only
 * their navigation destination with a document overlay inside this panel. */
function installEmbeddedPlans(ctx: ClientContext) {
  const id = '@deepseek-ai/dsh-client-ui-plan';
  for (const name of ['conversation.plan-review.actions', 'conversation.chat.turnTail'] as const) {
    const entry = ctx.slots.entriesOfSlot(name).find(row => row.options.id === id);
    if (!entry) throw new Error(t('agent.client.planExtensionMissing', { name }));
    const Official = entry.component as ComponentType<Record<string, unknown>>;
    function InlinePlan(props: Record<string, unknown>) {
      const [preview, setPreview] = useState<string>();
      const plans = name === 'conversation.chat.turnTail'
        ? (props.usePlans as (turn: string) => Array<{ callId: string; markdown: string }> | undefined)(String((props.turn as { turn: unknown }).turn)) : undefined;
      const navigation = name === 'conversation.plan-review.actions'
        ? { openReview: (review: { plan: string }) => setPreview(review.plan) }
        : { openPlan: (callId: string) => setPreview(plans?.find(plan => plan.callId === callId)?.markdown) };
      const translate = props.t as (key: string, ...args: unknown[]) => string;
      return <><Official {...props} {...navigation} t={(key: string, ...args: unknown[]) => key === 'preview.open' ? t("ui.main.text.03be7cda") : translate(key, ...args)} />{preview !== undefined && <section className="shotloom-plan-document" role="dialog" aria-label={t("ui.main.arialabel.723459a4")}>
        <button type="button" onClick={() => setPreview(undefined)}>{t("ui.main.text.317c83ae")}</button>
        <MarkdownText text={preview} labels={markdownLabels} />
      </section>}</>;
    }
    // The public ledger type erases plugin-local injected props. Preserve the
    // exact official store/inject/locale seats when shadowing its list cell.
    ctx.slots.register({ name, id, priority: -100, store: entry.store, inject: entry.inject, locale: entry.locale } as never, InlinePlan as never);
  }
}

/** Compose the public embedded Conversation Factory, without Harness chrome. */
function installEmbeddedChat(ctx: ClientContext, reference: SessionReference, mentionNode: ChatActions['mentionNode']) {
  const subscribeSession = reference.binding.session.subscribe.bind(reference.binding.session);
  ctx.slots.register({ name: 'main', key: 'conversation', priority: -100,
    children: { 'shotloom.chat': { kind: 'single', scope: 'session' } },
  }, ({ renderSlot, SessionProvider }: PropsRenderSlots<'shotloom.chat'>) =>
    <SessionProvider session={reference}>{renderSlot('shotloom.chat', {})}</SessionProvider>);
  ctx.slots.register({ name: 'shotloom.chat',
    children: { 'shotloom.stats': { kind: 'list', scope: 'session' } },
    inject: (id: SessionId): ChatActions => ({
      activateView: view => ctx.uiConversation.binding(id).activate(view), mentionNode,
      useBlank: () => useSyncExternalStore(subscribeSession, () => {
        const state = reference.binding.session.getSnapshot();
        return state.openState === 'open' && state.blank && !state.running && !state.promptAttempted && !state.pendingSubmissions.length;
      }),
    }),
  }, EmbeddedChat);
  // Relocate the official components and their injected hooks/locales. Their
  // counts, timing, token projection and dialogs stay entirely upstream-owned.
  for (const id of ['activity', 'usage']) {
    const entry = ctx.slots.entriesOfSlot('conversation.composer.dock').find(row => row.options.id === id);
    if (!entry) throw new Error(t('agent.client.statisticMissing', { id }));
    ctx.slots.register({ name: 'shotloom.stats', id, inject: entry.inject, store: entry.store, locale: entry.locale } as never, entry.component as never);
    ctx.slots.register({ name: 'conversation.composer.dock', id, priority: -100 }, () => null);
  }
}

// Only Shotloom's containing layout. Official plugins own every chat surface.
function chatLayout(ctx: ClientContext) {
  let navigation = new AbortController();
  const panel = { activePanelId: null };
  const panelInfo = { getSnapshot: () => panel, subscribe: () => () => {} };
  ctx.reflect.provide('layout', {
    panelInfo,
    selectPanel(id: unknown) {
      if (id !== null) throw new Error(t('agent.client.conversationOnly'));
      navigation.abort();
    },
    beginNavigation() { navigation.abort(); navigation = new AbortController(); return navigation.signal; },
    toggleSidebar() {}, openRightbar() {}, closeRightbar() {},
  });
  ctx.slots.provideRoot({ hooks: { panelInfo } });
  ctx.slots.register({ name: 'root', children: {
    main: { kind: 'keyed', scope: 'root' },
    'shell.overlay': { kind: 'list', scope: 'root' },
  } }, ({ renderSlot }: PropsRenderSlots<'main' | 'shell.overlay'>) => (
    <div className="shotloom-agent-chat">{renderSlot('main', {}, { entryKey: 'conversation' })}{renderSlot('shell.overlay', {})}</div>
  ));
  ctx.effect(() => () => navigation.abort(), 'shotloom: layout navigation');
  ctx.inject(['theme'], scope => {
    const apply = (snapshot: ThemeSnapshot) => {
      document.documentElement.style.colorScheme = snapshot.active.colorScheme;
      document.body.toggleAttribute('data-ds-dark-theme', snapshot.active.colorScheme === 'dark');
      for (const [name, value] of Object.entries(snapshot.active.tokens)) document.body.style.setProperty(name, value);
      document.body.style.setProperty('--dsh-content-font-size', `${snapshot.fontSizes.text}px`);
      document.body.style.setProperty('--dsh-code-font-size', `${snapshot.fontSizes.code}px`);
    };
    apply(scope.theme.getTheme());
    scope.on('theme/change', apply);
  });
}

const root = document.querySelector<HTMLElement>('#root')!;
document.documentElement.dataset.shotloomEmbedded = String(parent !== window);
const ctx = new Context();
let unmount: (() => void) | undefined;
try {
  const facade = (globalThis as DshWindow).__ModuleLoader__;
  if (!facade) throw new Error(t('agent.client.bootstrapMissing'));
  const modules = facade.create({ boot: (globalThis as DshWindow).__DSH_BOOT__, staticModules: getStaticModules() });
  await ctx.plugin(Loader);
  ctx.loader.internal = modules as never;
  await ctx.inject(['slots'], chatLayout);
  const manifest = { ...modules.manifest, plugins: modules.manifest.plugins.filter(row =>
    !['@deepseek-ai/dsh-client-ui-layout', '@deepseek-ai/dsh-client-ui-sidebar'].includes(row.id)) };
  await modules.entries.start(ctx.loader, manifest);
  // 官方 locale 服务继续拥有聊天组件的语言投影，产品只传入已选语言。
  const officialLocale = ctx.get('locale') as { setLocale(id: string): void } | undefined;
  officialLocale?.setLocale(productLocale === 'en-US' ? 'en' : 'zh');
  const failures = [...ctx.loader.entries()].filter(entry => entry.fiber?.state !== 2);
  if (failures.length) throw new Error(t('agent.client.pluginsInactive', { details: failures.map(entry => `${entry.options.name}: ${modules.importError(entry.options.name)?.message ?? t('agent.client.serviceMissing')}`).join('\n') }));
  const sessionId = new URLSearchParams(location.hash.slice(1)).get('sessionId');
  if (!sessionId) throw new Error(t('agent.client.sessionRequired'));
  // Wait for the official connection baseline before selecting a Session.
  await new Promise<void>((resolve, reject) => {
    const source = (ctx.get('connection') as ConnectionHandle).generation;
    const timer = setTimeout(() => { off(); reject(new Error(t('agent.client.connectionNotReady'))); }, 20_000);
    const ready = () => { if (source.getSnapshot()) { clearTimeout(timer); off(); resolve(); } };
    const off = source.subscribe(ready);
    ready();
  });
  await ctx.sessions.refresh();
  const baseline = ctx.sessions.list.getSnapshot();
  if (!baseline.byId[sessionId as SessionId]) throw new Error(t('agent.client.sessionUnavailable', { phase: baseline.phase }));
  const reference = ctx.sessions.retain(sessionId as SessionId, { source: 'mainView' });
  ctx.effect(() => () => reference.release(), 'shotloom: bound Session reference');
  await reference.ready;
  const toolNames = (globalThis as typeof globalThis & { __SHOTLOOM_TOOL_NAMES__?: string[] }).__SHOTLOOM_TOOL_NAMES__ ?? [];
  const toolTitles = (globalThis as typeof globalThis & { __SHOTLOOM_TOOL_TITLES__?: Record<string, string> }).__SHOTLOOM_TOOL_TITLES__ ?? {};
  for (const name of toolNames) ctx.slots.register({ name: 'tool.call.toolview', key: name }, props => <ProductToolCard {...props} label={toolTitles[name] || name} />);
  installEmbeddedPlans(ctx);
  installComposerControls(ctx);
  installCanvasReferenceCards(ctx);
  const parentOrigin = embeddedParentOrigin();
  const mentionNode = parentOrigin && ['canvas-primary', 'editor-primary'].includes(new URLSearchParams(location.hash.slice(1)).get('shotloomAgentId') || '') ? installCanvasReferences(ctx, sessionId as SessionId, parentOrigin) : () => {};
  installEmbeddedChat(ctx, reference, mentionNode);
  installEmbeddedSubagents(ctx);
  ctx.slots.onEntryError((key, _entry, error) => console.error('Shotloom chat slot failed', key, error));
  unmount = ctx.uiRenderer.mount(root);
  // The mounted chat layout reports ready after the retained official Session is ready.
} catch (error) {
  root.textContent = error instanceof Error ? error.message : String(error);
  publishChatStatus('error', error instanceof Error ? error.message : String(error));
  console.error(error);
}
window.addEventListener('pagehide', () => {
  // Release React subscriptions while the official Session services still exist.
  unmount?.();
  void ctx.fiber.dispose();
}, { once: true });
