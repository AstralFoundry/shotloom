import { t } from './i18n';
import { useEffect, useState, type ComponentType } from 'react';
import type { Context } from '@deepseek-ai/cordis';
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client';
import type { ConversationViewsProps } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { SubagentAddress } from '@deepseek-ai/dsh-subagent/client';
import type { SubagentCatalogActionProps } from '@deepseek-ai/dsh-client-ui-subagent/client';
import type { PropsRenderFactories, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots';

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap { 'shotloom.subagent-content': { kind: 'single'; scope: 'session' } }
}

function ChildView({ renderSlot }: ConversationViewsProps) {
  return renderSlot('conversation.session', { view: 'chat' });
}
const CHILD_SLOTS = { views: ChildView };

/** Reuse the official catalog and addressed conversation without its sidebar. */
export function installEmbeddedSubagents(ctx: Context) {
  const entry = ctx.slots.entriesOfSlot('conversation.session.header.actions').find(row => row.options.id === 'subagent-catalog');
  if (!entry) throw new Error(t('agent.client.subagentCatalogMissing'));
  const Official = entry.component as ComponentType<SubagentCatalogActionProps>;
  function Catalog(props: SubagentCatalogActionProps & PropsRenderSlots<'shotloom.subagent-content'>) {
    const [address, setAddress] = useState<SubagentAddress>();
    const [opened, setOpened] = useState<{ address: SubagentAddress; reference?: SessionReference; error?: string }>();
    useEffect(() => {
      if (!address) { setOpened(undefined); return; }
      let active = true;
      const reference = ctx.sessions.retain(address, { source: 'mainView' });
      void reference.ready.then(() => { if (active) setOpened({ address, reference }); }, error => {
        if (active) setOpened({ address, error: String(error) });
      });
      return () => { active = false; reference.release(); };
    }, [address]);
    return <><Official {...props} openChild={setAddress} openChildAside={setAddress} />
      {address && <section role="dialog" aria-label={t("ui.embeddedSubagents.arialabel.7142f5c3")} className="shotloom-subagent-dialog">
        <header><span>{t("ui.embeddedSubagents.text.adc782ac")}</span><button type="button" onClick={() => setAddress(undefined)} aria-label={t("ui.embeddedSubagents.arialabel.609c7045")}>×</button></header>
        {opened?.address === address && opened.reference
          ? <props.SessionProvider session={opened.reference}>{props.renderSlot('shotloom.subagent-content', {})}</props.SessionProvider>
          : <p role="status">{opened?.address === address && opened.error ? opened.error : t("ui.embeddedSubagents.text.1ef097e8")}</p>}
      </section>}
    </>;
  }
  ctx.slots.register({ name: 'shotloom.stats', id: 'subagent-catalog', inject: entry.inject, store: entry.store, locale: entry.locale,
    children: { 'shotloom.subagent-content': { kind: 'single', scope: 'session' } },
  } as never, Catalog as never);
  ctx.slots.register({ name: 'shotloom.subagent-content' }, ({ renderFactorySlot }: PropsRenderFactories) =>
    renderFactorySlot('conversation.content', { variant: 'embedded', phase: 'active', hero: false }, { slots: CHILD_SLOTS }));
}
