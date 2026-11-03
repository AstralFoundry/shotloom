import { t } from './i18n';
import { useEffect, useRef, useState, useSyncExternalStore, type ComponentType } from 'react';
import type { Context } from '@deepseek-ai/cordis';
import { MenuSurface, useAnchoredMaxHeight } from '@deepseek-ai/dsh-client-ui-primitives';
import type { MenuViewProps } from '@deepseek-ai/dsh-client-ui-input-trigger/client';

export const referenceCategories = [
  ['all', t("ui.taskAdapter.label.778fc8f9")], ['character', t("ui.CanvasNodeToolbar.character.6b26695e")], ['storyboard', t("ui.CanvasNodeToolbar.storyboard.fcad7fe3")], ['scene', t("ui.CanvasNodeToolbar.scene.625b392c")], ['prop', t("ui.CanvasNodeToolbar.prop.51fd93fb")], ['video', t("ui.canvasMediaActions.text.fa4e33b6")], ['other', t("ui.CanvasNodeToolbar.other.1a26edf9")],
] as const;
export type ReferenceCategory = typeof referenceCategories[number][0];

/** Presentation only: picks, highlight, keyboard navigation and fetches remain in the official controller. */
export function installCanvasReferenceMenu(ctx: Context, categories: {
  current(): ReferenceCategory;
  counts(): Record<string, number>;
  select(value: ReferenceCategory): void;
  thumbnailKey(nodeId: string): string;
  thumbnail(nodeId: string, signal: AbortSignal): Promise<string | undefined>;
}) {
  const entry = ctx.slots.entriesOfSlot('conversation.input.overlay').find(row => row.options.id === 'slash-menu');
  if (!entry) throw new Error(t('agent.client.referenceMenuMissing'));
  const Official = entry.component as ComponentType<MenuViewProps>;
  function Thumbnail({ nodeId }: { nodeId: string }) {
    const element = useRef<HTMLSpanElement>(null);
    const [src, setSrc] = useState<string>();
    useEffect(() => {
      const abort = new AbortController();
      const observer = new IntersectionObserver(entries => {
        if (!entries.some(entry => entry.isIntersecting)) return;
        observer.disconnect();
        void categories.thumbnail(nodeId, abort.signal).then(value => {
          if (!abort.signal.aborted) setSrc(value);
        }).catch(() => { /* A missing preview must not hide a selectable node. */ });
      });
      if (element.current) observer.observe(element.current);
      return () => { observer.disconnect(); abort.abort(); };
    }, [nodeId]);
    return <span ref={element} className="shotloom-reference-icon" aria-hidden="true">{src ? <img src={src} alt="" /> : '▧'}</span>;
  }
  function Menu(props: MenuViewProps) {
    const state = useSyncExternalStore(fn => props.menu.subscribe(fn), () => props.menu.getSnapshot());
    const root = useRef<HTMLDivElement>(null);
    const maxHeight = useAnchoredMaxHeight(root, 400, state, 84);
    const canvas = state.hit?.trigger === '@' && state.groups.some(group => group.source === t("ui.ProjectSearch.kind.95b2102f"));
    useEffect(() => {
      if (!canvas || !state.open) return;
      const dismiss = (event: PointerEvent) => {
        if (event.target instanceof Node && !root.current?.contains(event.target) && !root.current?.closest('[data-composer-card]')?.contains(event.target)) props.onDismiss();
      };
      document.addEventListener('pointerdown', dismiss, true);
      return () => document.removeEventListener('pointerdown', dismiss, true);
    }, [canvas, state.open, props.onDismiss]);
    useEffect(() => {
      if (canvas && state.highlight) document.getElementById(`dsh-slash-option-${state.highlight.source}-${state.highlight.index}`)?.scrollIntoView({ block: 'nearest' });
    }, [canvas, state.highlight]);
    if (!canvas) return <Official {...props} />;
    if (!state.open) return null;
    const counts = categories.counts();
    return <MenuSurface ref={root} className="shotloom-reference-menu" style={{ maxHeight }} data-trigger-menu="">
      <nav aria-label={t("ui.canvasReferenceMenu.arialabel.0b1ccc81")} className="shotloom-reference-tabs">
        {referenceCategories.map(([id, label]) => <button key={id} type="button" aria-pressed={categories.current() === id}
          onMouseDown={event => event.preventDefault()} onClick={() => categories.select(id)}>
          {label}<span>{counts[id] || 0}</span>
        </button>)}
      </nav>
      {state.groups.some(group => group.source === t("ui.ProjectSearch.kind.95b2102f") && group.status === 'pending') && <div className="shotloom-reference-loading" role="status">{t("ui.canvasReferenceMenu.text.64769628")}</div>}
      <div role="listbox" aria-label={t("ui.canvasReferenceMenu.arialabel.b5f59c08")} className="shotloom-reference-list">
        {state.groups.map(group => group.items.map((item, index) => {
          const active = state.highlight?.source === group.source && state.highlight.index === index;
          return <button type="button" role="option" aria-selected={active} disabled={!item.value && group.source === t("ui.ProjectSearch.kind.95b2102f")}
            id={`dsh-slash-option-${group.source}-${index}`} key={`${group.source}-${item.value || index}`}
            className="shotloom-reference-row" onMouseDown={event => event.preventDefault()}
            onMouseEnter={() => props.onHover(group.source, index)} onClick={() => props.onPick(group.source, index)}>
            {group.source === t("ui.ProjectSearch.kind.95b2102f") && item.value ? <Thumbnail key={categories.thumbnailKey(item.value)} nodeId={item.value} /> : <span className="shotloom-reference-icon" aria-hidden="true">@</span>}
            <span className="shotloom-reference-name" title={item.name}>{item.label || item.name}</span>
            <span className="shotloom-reference-kind">{item.description}</span>
          </button>;
        }))}
      </div>
    </MenuSurface>;
  }
  ctx.slots.register({ name: 'conversation.input.overlay', id: 'slash-menu', priority: -100,
    inject: entry.inject, store: entry.store, locale: entry.locale,
  } as never, Menu as never);
}
