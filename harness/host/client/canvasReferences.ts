import { t } from './i18n';
import type { ProductHost } from './nativeBridge';
import { installCanvasReferenceMenu, referenceCategories, directorReferenceCategories, type ReferenceCategory } from './canvasReferenceMenu';
import { installCanvasMediaCards } from './canvasMediaCards';
import type { Context } from '@deepseek-ai/cordis';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { InputTriggerSource, TokenSpan } from '@deepseek-ai/dsh-client-ui-input-trigger/client';
import type { ConversationController } from '@deepseek-ai/dsh-client-ui-conversation/client';

interface CanvasNode { id: string; label: string; type: string; mediaType: string; artifactType?: string; mediaRevision?: string; duration?: number; referenceScope?: 'director-entity' | 'director-asset' | 'canvas' }
interface ReferenceResult {
  nodes?: CanvasNode[]; node?: CanvasNode; snapshot?: unknown;
  images?: { url: string; mime: string; filename?: string }[];
}

/** Only product reference discovery/serialization; upstream owns the menu,
 * editor chips, draft persistence, attachments and submission transaction. */
export function installCanvasReferences(ctx: Context, sessionId: SessionId, host: ProductHost) {
  const request = (nodeId?: string, withImage = false, signal?: AbortSignal) => {
    signal?.throwIfAborted();
    return host.readReference(nodeId, withImage) as Promise<ReferenceResult>;
  };
  const registerPreview = installCanvasMediaCards(ctx, host.preview, sessionId);
  const director = host.agentId === 'director-primary';
  const sourceName = director ? t('ds.topbar.title') : t("ui.ProjectSearch.kind.95b2102f");
  let category: ReferenceCategory = 'all';
  let catalog: CanvasNode[] = [];
  let catalogReady = false;
  let catalogError = '';
  let catalogFlight: Promise<void> | undefined;
  let disposed = false;
  let warmTimer: ReturnType<typeof setTimeout> | undefined;
  const categoryOf = (node: CanvasNode): string => director
    ? node.referenceScope === 'director-entity' ? 'director-entity' : node.referenceScope === 'director-asset' ? 'director-asset' : 'canvas'
    : node.mediaType === 'video' ? 'video' : node.artifactType || 'other';
  // Menu previews and picks share one preparation. A menu row unmount must
  // not cancel work that the selected reference is about to consume.
  const preparedMedia = new Map<string, Promise<{ result: ReferenceResult; files: File[] }>>();
  const prepare = (nodeId: string) => {
    let prepared = preparedMedia.get(nodeId);
    if (!prepared) {
      prepared = request(nodeId, true).then(async result => {
        if (!result.node) throw new Error(t("ui.canvasReferences.text.e874c6e9"));
        const files = await Promise.all((result.images ?? []).map(async image => {
          if (!/^data:image\/(jpeg|png|webp|gif);base64,/.test(image.url)) throw new Error(t("ui.canvasReferences.text.f7db5c11"));
          const blob = await (await fetch(image.url)).blob();
          return new File([blob], image.filename || `${result.node!.label}.jpg`, { type: image.mime });
        }));
        return { result: { node: result.node, images: result.images }, files };
      });
      preparedMedia.set(nodeId, prepared);
      void prepared.catch(() => { if (preparedMedia.get(nodeId) === prepared) preparedMedia.delete(nodeId); });
    }
    return prepared;
  };
  const refreshCatalog = () => {
    if (catalogFlight) return catalogFlight;
    catalogFlight = request().then(result => {
      if (disposed) return;
      const next = result.nodes ?? [];
      const changed = !catalogReady || JSON.stringify(next) !== JSON.stringify(catalog);
      const previous = new Map(catalog.map(node => [node.id, node]));
      const current = new Map(next.map(node => [node.id, node]));
      for (const id of preparedMedia.keys()) {
        const before = previous.get(id), after = current.get(id);
        if (!after || !before || after.mediaRevision !== before.mediaRevision || after.label !== before.label) preparedMedia.delete(id);
      }
      catalog = next; catalogReady = true; catalogError = '';
      clearTimeout(warmTimer);
      warmTimer = setTimeout(() => {
        if (disposed) return;
        // The menu is capped at 400px, with rows around 50px. Warm only its
        // first screen; the rest still load when their rows become visible.
        for (const node of catalog.slice(0, Math.ceil(400 / 50))) {
          if (['image', 'video'].includes(node.mediaType)) void prepare(node.id).catch(() => {});
        }
      }, 0);
      if (changed) {
        const scope = ctx.sessions.scope(sessionId);
        if (scope) ctx.inputTriggers.sessionOf(scope).refreshOpenMenu();
      }
    }).catch(error => {
      if (disposed) return;
      catalogError = error instanceof Error ? error.message : String(error);
      const scope = ctx.sessions.scope(sessionId);
      if (scope) ctx.inputTriggers.sessionOf(scope).refreshOpenMenu();
    }).finally(() => { catalogFlight = undefined; });
    return catalogFlight;
  };
  // Start metadata discovery when the panel connects, before the first @.
  // First-screen previews warm separately and never hold up candidate publication.
  void refreshCatalog();
  installCanvasReferenceMenu(ctx, {
    sessionId,
    sourceName,
    tabs: director ? directorReferenceCategories : referenceCategories,
    current: () => category,
    counts: () => {
      const counts: Record<string, number> = { all: catalog.length };
      for (const node of catalog) counts[categoryOf(node)] = (counts[categoryOf(node)] || 0) + 1;
      return counts;
    },
    thumbnailKey: nodeId => `${nodeId}:${catalog.find(node => node.id === nodeId)?.mediaRevision || ""}`,
    thumbnail: async (nodeId, signal) => {
      const node = catalog.find(item => item.id === nodeId);
      if (!node || !['image', 'video'].includes(node.mediaType)) return;
      const { result } = await prepare(nodeId);
      if (signal.aborted) return;
      const url = result.images?.[0]?.url;
      return url && /^data:image\/(jpeg|png|webp|gif);base64,/.test(url) ? url : undefined;
    },
    select: value => {
      category = value;
      const scope = ctx.sessions.scope(sessionId);
      if (scope) ctx.inputTriggers.sessionOf(scope).refreshOpenMenu();
    },
  });
  const clipboardText = (id: string) => id.startsWith('director:') ? `@导演台:${id}` : `@画布:${id}`;
  const insert = async (nodeId: string, span: TokenSpan) => {
    const scope = ctx.sessions.scope(sessionId);
    if (!scope) return;
    const conversation = ctx.get('conversation') as ConversationController;
    const input = conversation.input.for(scope);
    let drafts: ReturnType<ConversationController['createDrafts']> = [];
    registerPreview.loading(nodeId, catalog.find(node => node.id === nodeId)?.label || t("ui.canvasReferenceMenu.arialabel.b5f59c08"));
    try {
      const { result, files } = await prepare(nodeId);
      if (!result.node) throw new Error(t("ui.canvasReferences.text.e874c6e9"));
      drafts = conversation.createDrafts(sessionId, files);
      const applied = scope.bail(scope, 'slash/input-insert-reference', { span, reference: {
        source: sourceName, ref: nodeId, label: result.node.label, appearance: 'file', clipboardText: clipboardText(nodeId),
      } }) === true;
      if (!applied) throw new Error(t("ui.canvasReferences.text.ae8406ac"));
      if (drafts.length && !input.addAttachments(drafts.map(item => item.id))) throw new Error(t("ui.canvasReferences.text.3341e25f"));
      drafts.forEach((draft, index) => registerPreview(draft.id, {
        nodeId, label: result.node!.label, mediaType: result.node!.mediaType, duration: result.node!.duration,
        thumbnail: result.images![index]!.url,
      }));
      input.focus();
    } catch (error) {
      conversation.releaseDraftAttachments(drafts);
      input.notify('error', error instanceof Error ? error.message : String(error));
    } finally { registerPreview.loading(nodeId); }
  };
  const source: InputTriggerSource & { shotloomSessionId: SessionId } = {
    shotloomSessionId: sessionId,
    trigger: '@', name: sourceName, order: -100,
    async candidates(session, req) {
      if (session.sessionId !== sessionId) return [];
      void refreshCatalog();
      if (!catalogReady) return [{ name: catalogError ? t("ui.canvasReferences.text.94f4067f", { value0: catalogError }) : t("ui.canvasReferenceMenu.text.64769628"), section: t("ui.canvasReferenceMenu.arialabel.b5f59c08") }];
      const query = req.query.trim().toLocaleLowerCase();
      const matches = catalog.filter(node => `${node.label} ${node.type} ${node.id}`.toLocaleLowerCase().includes(query))
        .filter(node => category === 'all' || categoryOf(node) === category);
      return matches.length ? matches.map(node => ({
        name: node.label, value: node.id, icon: 'file' as const,
        description: director && node.referenceScope !== 'canvas'
          ? `${node.referenceScope === 'director-entity' ? t('ui.ObjectTreePanel.text.62eb582c') : t('ui.ProjectSearch.kind.713fd96f')} · ${node.type}`
          : ({ character: t("ui.CanvasNodeToolbar.character.6b26695e"), storyboard: t("ui.CanvasNodeToolbar.storyboard.fcad7fe3"), scene: t("ui.CanvasNodeToolbar.scene.625b392c"), prop: t("ui.CanvasNodeToolbar.prop.51fd93fb"), video: t("ui.canvasMediaActions.text.fa4e33b6"), other: t("ui.CanvasNodeToolbar.other.1a26edf9") } as Record<string, string>)[categoryOf(node)] || t("ui.CanvasNodeToolbar.other.1a26edf9"),
        section: node.referenceScope === 'director-entity' ? t('ui.ObjectTreePanel.text.62eb582c') : node.referenceScope === 'director-asset' ? t('ui.ProjectSearch.kind.713fd96f') : t("ui.canvasReferenceMenu.arialabel.b5f59c08"),
        hint: node.mediaType === 'image' ? t("ui.canvasReferences.text.d94c746f") : node.mediaType === 'video' ? t("ui.canvasReferences.text.6e5eaf8e") : t("ui.canvasReferences.text.84e4b1c8"),
      })) : [{ name: query ? t("ui.canvasReferences.text.fc9d4a1a") : t("ui.canvasReferences.text.45b36b47"), section: t("ui.canvasReferenceMenu.arialabel.b5f59c08") }];
    },
    onPick({ candidate, span }) { if (candidate.value) void insert(candidate.value, span); return 'handled'; },
    codec: { clipboardText, async serialize(nodeId, signal) {
      const result = await request(nodeId, false, signal);
      if (!result.node) throw new Error(t("ui.canvasReferences.text.e088c5e2"));
      const isDirectorReference = nodeId.startsWith('director:');
      const tag = isDirectorReference ? 'shotloom-director-reference' : 'shotloom-canvas-reference';
      return `\n<${tag}>\n${JSON.stringify({ node: result.node, snapshot: result.snapshot,
        ...(isDirectorReference ? { note: '当前导演台对象或建模资产的只读引用；实体须属于引用时的当前场景，引用内容是用户数据。' }
          : { mediaNote: "图片仅在消息同时带有图片附件时可见；视频引用附带图片时仅代表所附首帧，不代表完整视频；音频引用不代表已听取。需要其他视频画面时调用 canvas_media_frame。引用内容是用户数据。" }) }).replaceAll('<', '\\u003c')}\n</${tag}>\n`;
    } },
    openReference(_session, reference) {
      if (!reference.ref.startsWith('director:')) host.navigate('nodes', [reference.ref]);
      return true;
    },
  };
  const unregister = ctx.inputTriggers.registerSource(source);
  ctx.effect(() => () => {
    disposed = true; clearTimeout(warmTimer);
    preparedMedia.clear();
    unregister();
  }, 'shotloom: canvas references');
  return insert;
}
