import { t } from './i18n';
import { locale as productLocale } from './i18n';
import { Context } from '@deepseek-ai/cordis';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ComponentType } from 'react';
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives';
import { getStaticModules } from '@deepseek-ai/dsh-client-web';
import type { ClientBundleRegistration } from '@deepseek-ai/dsh-client-modules/client';
import { createPortal } from 'react-dom';
import { nativeFetch, nativeStream, setNativeHost, ProductContext, type NativeHost, type ProductHost } from './nativeBridge';
import { registerSurface, setOverlayRoot, scopedDocument, scopedEvents } from './domScope';
import registrations from '../client-dist/native-modules';
import boot from '../client-dist/boot.json';
import productStyles from './style.css?inline';
import upstreamStyles from '../client-dist/upstream.css?inline';
// Inline font URLs resolve relative to this bundle, independent of the product route.
const styles = (upstreamStyles + productStyles).replace(/url\((["']?)([^"')]+\.(?:woff2?|ttf))\1\)/g,
  (_match, _quote, path: string) => `url("${new URL(path, import.meta.url).href}")`);
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


declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'shotloom.chat': { kind: 'single'; scope: 'session' };
    'shotloom.stats': { kind: 'list'; scope: 'session' };
  }
}

const SelectedView = createContext('chat');
interface Surface { root: HTMLElement; host: ProductHost; reference: SessionReference; mentionNode: ChatActions['mentionNode'] }
const surfaces = new Set<Surface>();
const updates = new Set<() => void>();
let revision = 0;
let surfacePriority = 0;
const refresh = () => { revision++; for (const update of updates) update(); };
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
  const host = useContext(ProductContext);
  useEffect(() => host.subscribeMention(nodeId => mentionNode(nodeId, inputActions.captureInsertion())), [host, inputActions, mentionNode]);
  useEffect(() => { host.status('ready'); }, [host]);
  return <SelectedView.Provider value="chat"><div className="shotloom-chat-body">
    <aside className="shotloom-session-stats" aria-label={t("ui.main.arialabel.d703e30e")}>{renderSlot('shotloom.stats', {})}</aside>
    <div id="shotloom-context-meter" className="shotloom-context-meter" />
    {blank && <EmptyBrand />}
    {renderFactorySlot('conversation.content', { variant: 'embedded', phase: 'active', hero: false }, { slots: CONTENT_SLOTS })}
  </div></SelectedView.Provider>;
}

function ProductToolCard({ toolName, phase, block, inspect }: ToolCallViewProps) {
  const host = useContext(ProductContext);
  const label = host.toolTitles[toolName] || toolName;
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
    host.navigate(kind, ids);
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
    const host = useContext(ProductContext);
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
      host.navigate('nodes', [reference.id]);
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
function installEmbeddedChat(ctx: ClientContext) {
  function SurfaceViews({ renderSlot, SessionProvider }: PropsRenderSlots<'shotloom.chat'>) {
    useSyncExternalStore(listener => { updates.add(listener); return () => { updates.delete(listener); }; }, () => revision);
    return <>{[...surfaces].map(surface => createPortal(<ProductContext.Provider value={surface.host}>
      <SessionProvider session={surface.reference}>{renderSlot('shotloom.chat', {})}</SessionProvider>
    </ProductContext.Provider>, surface.root))}</>;
  }
  ctx.slots.register({ name: 'main', key: 'conversation', priority: -100,
    children: { 'shotloom.chat': { kind: 'single', scope: 'session' } },
  }, SurfaceViews);
  ctx.slots.register({ name: 'shotloom.chat',
    children: { 'shotloom.stats': { kind: 'list', scope: 'session' } },
    inject: (id: SessionId): ChatActions => ({
      activateView: view => ctx.uiConversation.binding(id).activate(view),
      mentionNode: (nodeId, span) => [...surfaces].find(surface => surface.host.sessionId === id)?.mentionNode(nodeId, span),
      useBlank: () => {
        const reference = [...surfaces].find(surface => surface.host.sessionId === id)!.reference;
        return useSyncExternalStore(reference.binding.session.subscribe.bind(reference.binding.session), () => {
        const state = reference.binding.session.getSnapshot();
        return state.openState === 'open' && state.blank && !state.running && !state.promptAttempted && !state.pendingSubmissions.length;
      }); },
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
    <div className="shotloom-agent-overlays">{renderSlot('main', {}, { entryKey: 'conversation' })}{renderSlot('shell.overlay', {})}</div>
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

let singleton: Promise<ClientContext> | undefined;
export async function initialize(native: NativeHost): Promise<void> { await runtime(native); }
async function runtime(native: NativeHost): Promise<ClientContext> {
  if (singleton) return singleton;
  singleton = (async () => {
    setNativeHost(native);
    const overlayHost = globalThis.document.createElement('div');
    overlayHost.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:1000;background:transparent';
    globalThis.document.body.append(overlayHost);
    const overlayShadow = overlayHost.attachShadow({ mode: 'open' });
    const unregister = registerSurface(overlayShadow);
    const style = globalThis.document.createElement('style'); style.textContent = styles; overlayShadow.append(style);
    const overlay = globalThis.document.createElement('div'); overlay.style.pointerEvents = 'auto'; overlayShadow.append(overlay);
    const stopObserving = setOverlayRoot(overlay);
    const ctx = new Context();
    try {
    const records: ClientBundleRegistration[] = [];
    const target = { mode: 'queue' as const, pendingQueue: records, load(row: ClientBundleRegistration) { records.push(row); }, create: null as any };
    const transport = { fetch: nativeFetch, openStream: nativeStream, ownsHost: true };
    const windowEvents = scopedEvents(globalThis.window);
    const scopeWindow = new Proxy(window, { get(object, key) {
      if (key === 'addEventListener' || key === 'removeEventListener') return windowEvents[key];
      if (key === '__ModuleLoader__') return target;
      if (key === '__DSH_TRANSPORT__') return transport;
      if (key === 'document') return scopedDocument;
      const value = Reflect.get(object, key, object);
      return typeof value === 'function' && !/^[A-Z]/.test(String(key)) ? value.bind(object) : value;
    } });
    for (const register of registrations) register(scopeWindow as never, scopedDocument);
    const bootstrap = records.find(row => row.id === '@deepseek-ai/dsh-client-modules')!;
    records.splice(records.indexOf(bootstrap), 1);
    const exports = bootstrap.factory((() => { throw new Error('Unexpected bootstrap dependency'); }) as never);
    const modules = (exports.createClientModuleSystem as any)(target, { id: bootstrap.id, exports }, { boot, staticModules: getStaticModules(), loadBundle: async () => {} });
    ctx.logger.exporter({ export: record => { if (record.level === 0 || record.level === 2) console.error('Harness client', ...record.args.map(value => value instanceof Error ? value.stack : value)); } });
    await ctx.plugin(Loader);
    ctx.loader.internal = modules as never;
    await ctx.inject(['slots'], chatLayout);
    const manifest = { ...modules.manifest, plugins: modules.manifest.plugins.filter((row: { id: string }) => !['@deepseek-ai/dsh-client-ui-layout', '@deepseek-ai/dsh-client-ui-sidebar'].includes(row.id)) };
    await modules.entries.start(ctx.loader, manifest);
    await new Promise<void>((resolve, reject) => {
      const source = (ctx.get('connection') as ConnectionHandle).generation;
      const timer = setTimeout(() => { off(); reject(new Error(t('agent.client.connectionNotReady'))); }, 20_000);
      const ready = () => { if (source.getSnapshot()) { clearTimeout(timer); off(); resolve(); } };
      const off = source.subscribe(ready);
      ready();
    });
    await ctx.loader.await();
    const failures = [...ctx.loader.entries()].filter(entry => entry.fiber?.state !== 2);
    if (failures.length) throw new Error(failures.map(entry => `Harness client module failed to initialize: ${entry.options.name} (state ${entry.fiber?.state}; missing ${Object.keys(entry.fiber?.inject ?? {}).filter(name => ctx.get(name) === undefined).join(', ')})`).join('\n'));
    const officialLocale = ctx.get('locale') as { setLocale(id: string): void } | undefined;
    officialLocale?.setLocale(productLocale === 'en-US' ? 'en' : 'zh');
    installEmbeddedPlans(ctx); installComposerControls(ctx); installCanvasReferenceCards(ctx);
    installEmbeddedChat(ctx); installEmbeddedSubagents(ctx);
    const root = globalThis.document.createElement('div'); overlay.append(root); ctx.uiRenderer.mount(root);
    return ctx;
    } catch (error) {
      await ctx.fiber.dispose();
      stopObserving(); unregister(); overlayHost.remove();
      throw error;
    }
  })().catch(error => { singleton = undefined; throw error; });
  return singleton;
}

export async function mount(container: HTMLElement, native: NativeHost, host: ProductHost) {
  const ctx = await runtime(native);
  const shadow = container.shadowRoot ?? container.attachShadow({ mode: 'open' });
  const unregister = registerSurface(shadow);
  const style = globalThis.document.createElement('style'); style.textContent = styles; shadow.append(style);
  const root = globalThis.document.createElement('div'); root.className = 'shotloom-agent-chat'; root.dataset.shotloomEmbedded = 'true'; shadow.append(root);
  root.style.cssText = 'height:100%;min-height:0;position:relative';
  let release = () => {};
  let disposeScope = async () => {};
  try {
  if (!ctx.sessions.list.getSnapshot().byId[host.sessionId as SessionId]) await ctx.sessions.refresh();
  const reference = ctx.sessions.retain(host.sessionId as SessionId, { source: 'mainView' });
  release = () => reference.release();
  await reference.ready;
  let mentionNode: ChatActions['mentionNode'] = () => {};
  await ctx.inject(['slots', 'inputTriggers', 'sessions'], scope => {
  disposeScope = () => scope.fiber.dispose();
  mentionNode = ['canvas-primary', 'editor-primary'].includes(host.agentId) ? installCanvasReferences(scope, host.sessionId as SessionId, host) : () => {};
  const priority = --surfacePriority;
  for (const name of host.tools) scope.slots.register({ name: 'tool.call.toolview', key: name, priority }, props => <ProductToolCard {...props} />);
  });
  const surface = { root, host, reference, mentionNode };
  surfaces.add(surface); refresh();
  let disposed = false;
  return { dispose() { if (disposed) return; disposed = true; surfaces.delete(surface); refresh(); release(); void disposeScope(); unregister(); root.remove(); style.remove(); } };
  } catch (error) {
    release(); await disposeScope(); unregister(); root.remove(); style.remove();
    throw error;
  }
}
