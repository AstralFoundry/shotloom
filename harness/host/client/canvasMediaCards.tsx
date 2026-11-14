import { t } from './i18n';
import { useContext, useEffect, useState, type ComponentType } from 'react';
import { ProductContext } from './nativeBridge';
import type { Context } from '@deepseek-ai/cordis';
import type { ComposerAttachmentsProps } from '@deepseek-ai/dsh-client-ui-conversation/client';

export interface CanvasMediaPreview { nodeId: string; label: string; mediaType: string; duration?: number; thumbnail: string }

/** Presentation metadata only; the official Conversation owns files and ids. */
export function installCanvasMediaCards(ctx: Context, openPreview: (nodeId: string) => void, sessionId: string) {
  const previews = new Map<string, CanvasMediaPreview>();
  const loading = new Map<string, string>();
  const listeners = new Set<() => void>();
  const entry = ctx.slots.entriesOfSlot('conversation.input.attachments')[0];
  if (!entry) throw new Error(t('agent.client.attachmentRendererMissing'));
  const Official = entry.component as ComponentType<ComposerAttachmentsProps>;
  function MediaAttachments(props: ComposerAttachmentsProps) {
    const [, refresh] = useState(0);
    useEffect(() => { const update = () => refresh(value => value + 1); listeners.add(update); return () => { listeners.delete(update); }; }, []);
    if (useContext(ProductContext).sessionId !== sessionId) return <Official {...props} />;
    const selected = props.attachments.filter(item => previews.has(item.id));
    const styles = selected.filter(item => selected.filter(other => previews.get(other.id)!.label === previews.get(item.id)!.label).length === 1).map(item => {
      const meta = previews.get(item.id)!;
      const selector = `[data-composer-chip=${JSON.stringify(t("ui.ProjectSearch.kind.95b2102f"))}] [title=${JSON.stringify(meta.label)}]`;
      return `${selector}{--shotloom-reference-thumb:url(${JSON.stringify(meta.thumbnail)})}${selector}>svg{display:none}${selector}::before{content:""}`;
    }).join('\n');
    return <div data-shotloom-attachments="" data-has-attachments={props.attachments.length > 0}><style>{styles}</style>
      {!!loading.size && <div className="shotloom-reference-loading" role="status">{t("ui.canvasMediaCards.text.8dfca0ba")}{Array.from(loading.values()).join('、')}…</div>}
      {!!selected.length && <div className="shotloom-media-previews" aria-label={t("ui.canvasMediaCards.arialabel.8247849c")}>{selected.map(item => {
        const meta = previews.get(item.id)!;
        const video = meta.mediaType === 'video';
        const seconds = meta.duration === undefined ? undefined : Math.floor(meta.duration);
        const clock = seconds === undefined ? undefined : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
        return <div className="shotloom-media-preview" key={item.id}>
          <button className="shotloom-media-cover" type="button" aria-label={t("ui.promptReferenceEditor.text.dca59cc0", { value0: video ? t("ui.GenerationNodePreview.text.af7d6e03") : t("ui.canvasMediaCards.text.9b18613a"), value1: meta.label })} onClick={() => openPreview(meta.nodeId)}>
            <img src={item.kind === 'image' ? item.previewUrl : meta.thumbnail} alt={meta.label} />
            {video && <span className="shotloom-media-play" aria-hidden="true">▶</span>}
            {clock && <span className="shotloom-media-clock">{clock}</span>}
          </button>
          <button className="shotloom-media-remove" type="button" aria-label={t("ui.canvasMediaCards.text.5a55bdc3", { value0: meta.label })} onClick={() => props.onRemoveAttachment(item.id)}>×</button>
        </div>;
      })}</div>}
      <Official {...props} attachments={props.attachments.filter(item => !previews.has(item.id))} />
    </div>;
  }
  ctx.slots.register({ name: 'conversation.input.attachments', priority: (entry.options.priority ?? 0) - 1, locale: entry.locale, inject: entry.inject, store: entry.store } as never, MediaAttachments as never);
  ctx.effect(() => () => { previews.clear(); loading.clear(); listeners.clear(); }, 'shotloom: media presentation');
  return Object.assign((id: string, preview: CanvasMediaPreview) => {
    previews.set(id, preview);
    for (const listener of listeners) listener();
  }, { loading(nodeId: string, label?: string) {
    if (label) loading.set(nodeId, label); else loading.delete(nodeId);
    for (const listener of listeners) listener();
  } });
}
