import { t } from './i18n';
import { useEffect, useRef, useState } from 'react';
import type { Context } from '@deepseek-ai/cordis';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { PermissionSelectProps } from '@deepseek-ai/dsh-client-ui-permission-presets/client';
import { Menu, MenuItemButton, RiskConfirmation, IconSkillOutlineRegular, IconChevronDownOutlineRegular,
  PermissionIconReadOnlyRegular, PermissionIconWorkspaceWriteRegular, PermissionIconFullAccessRegular,
} from '@deepseek-ai/dsh-client-ui-primitives';

const permissions = {
  'read-only': { name: t("ui.composerControls.name.16df9ebf"), description: t("ui.composerControls.description.ea4d0d21"), icon: <PermissionIconReadOnlyRegular /> },
  'workspace-write': { name: t("ui.composerControls.name.82de9dc2"), description: t("ui.composerControls.description.8f42b9ce"), icon: <PermissionIconWorkspaceWriteRegular /> },
  'danger-full-access': { name: t("ui.composerControls.name.da805f96"), description: t("ui.composerControls.description.9b1d40a7"), icon: <PermissionIconFullAccessRegular /> },
};

function PermissionPicker({ locked, select, usePermissionCatalog, useProjection, t: officialT }: PermissionSelectProps) {
  const selection = useProjection('permissions');
  const catalog = usePermissionCatalog(state => state.value);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  useEffect(() => {
    if (locked || !catalog || !selection) { setOpen(false); setConfirm(false); setAcknowledged(false); }
  }, [locked, catalog, selection]);
  if (!catalog || !selection) return null;
  const copy = (id: string) => permissions[id as keyof typeof permissions];
  const current = catalog.options.find(option => option.value === selection.currentValue);
  const active = copy(selection.currentValue);
  const submit = async (id: string) => {
    setBusy(true);
    try { await select(id).catch(() => false); } finally { setBusy(false); }
  };
  return <><Menu open={open} side="top" portal listClassName="shotloom-permission-menu"
    selectedId={selection.currentValue} onClose={() => setOpen(false)}
    items={catalog.options.map(option => ({ id: option.value, icon: copy(option.value)?.icon,
      label: <span className="shotloom-menu-copy"><strong>{copy(option.value)?.name || option.name}</strong>
        <span>{copy(option.value)?.description || option.description}</span></span>,
    }))}
    onSelect={id => {
      setOpen(false);
      if (id === selection.currentValue) return;
      if (id === 'danger-full-access') { setAcknowledged(false); setConfirm(true); }
      else void submit(id);
    }}
    anchor={<button type="button" className="shotloom-composer-control" disabled={locked || busy}
      title={active?.name || current?.name}
      aria-label={t("ui.composerControls.text.cd8701d5", { value0: active?.name || current?.name || selection.currentValue })} aria-haspopup="menu" aria-expanded={open}
      onClick={() => setOpen(!open)}>{active?.icon}<span>{active?.name || current?.name}</span><IconChevronDownOutlineRegular /></button>} />
    <RiskConfirmation open={confirm} title={officialT('confirm.title')} description={officialT('confirm.description')}
      acknowledgeLabel={officialT('confirm.acknowledge')} cancelLabel={officialT('confirm.cancel')} closeLabel={officialT('close')}
      confirmLabel={officialT('confirm.enable')} acknowledged={acknowledged} disabled={busy}
      onAcknowledgedChange={setAcknowledged} onCancel={() => setConfirm(false)}
      onConfirm={() => { setConfirm(false); void submit('danger-full-access'); }} />
  </>;
}

interface SkillOption { name: string; description: string }

/** Add a discoverable entry point to the native slash-skill invocation path. */
export function installComposerControls(ctx: Context) {
  const entry = ctx.slots.entriesOfSlot('conversation.input.permission')[0];
  if (!entry) throw new Error(t('agent.client.permissionControlMissing'));
  ctx.slots.register({ name: 'conversation.input.permission', priority: -100,
    inject: entry.inject, store: entry.store, locale: entry.locale } as never, PermissionPicker as never);

  function SkillPicker({ inputActions, useInput, loadSkills, focusInput }: PropsRuntime<'conversation.input.left'> & {
    loadSkills(signal: AbortSignal): Promise<readonly SkillOption[]>; focusInput(): void;
  }) {
    const locked = useInput(state => state.phase !== 'plain');
    const [open, setOpen] = useState(false);
    const [skills, setSkills] = useState<readonly SkillOption[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [query, setQuery] = useState('');
    const insertion = useRef<ReturnType<typeof inputActions.captureInsertion>>();
    useEffect(() => {
      if (!open) return;
      const abort = new AbortController();
      setLoading(true); setError(''); setSkills([]);
      void loadSkills(abort.signal).then(rows => { if (!abort.signal.aborted) setSkills(rows); })
        .catch(reason => { if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason)); })
        .finally(() => { if (!abort.signal.aborted) setLoading(false); });
      return () => abort.abort();
    }, [open, loadSkills]);
    useEffect(() => { if (locked) setOpen(false); }, [locked]);
    const matches = skills.filter(skill => `${skill.name} ${skill.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
    return <Menu open={open} side="top" portal listClassName="shotloom-skill-menu" onClose={() => setOpen(false)}
      anchor={<button type="button" className="shotloom-composer-control" disabled={locked} aria-label={t("ui.composerControls.arialabel.af6ccc9d")} title={t("ui.composerControls.arialabel.af6ccc9d")}
        aria-haspopup="menu" aria-expanded={open} onMouseDown={event => event.preventDefault()}
        onClick={() => { insertion.current = inputActions.captureInsertion(); setQuery(''); setOpen(!open); }}>
        <IconSkillOutlineRegular /><span>{t("ui.SettingsPanel.label.53da139b")}</span></button>}
      >
      <div className="shotloom-skill-search"><input aria-label={t("ui.SettingsPanel.placeholder.15dfafe9")} placeholder={t("ui.SettingsPanel.placeholder.15dfafe9")} value={query}
        onChange={event => setQuery(event.target.value)} /></div>
      {matches.map(skill => <MenuItemButton key={skill.name} icon={<IconSkillOutlineRegular />} onSelect={() => {
        const span = insertion.current;
        if (!span || !inputActions.insertText(` /${skill.name} `, span)) {
          setError(t("ui.composerControls.text.9b6d9acb")); return;
        }
        setOpen(false); focusInput();
      }}><span className="shotloom-menu-copy"><strong>{skill.name}</strong><span>{skill.description}</span></span></MenuItemButton>)}
      {loading && <p className="shotloom-menu-status">{t("ui.composerControls.text.3dfadbf0")}</p>}
      {error && <p className="shotloom-menu-status" role="alert">{error}</p>}
      {!loading && !error && !matches.length && <p className="shotloom-menu-status">{query ? t("ui.composerControls.text.8a1fac72") : t("ui.composerControls.text.b8fc5ae8")}</p>}
    </Menu>;
  }
  ctx.slots.register({ name: 'conversation.input.left', id: 'shotloom-skills', order: 10,
    inject: (sessionId: SessionId) => ({
      focusInput: () => { const scope = ctx.sessions.scope(sessionId); if (scope) ctx.conversation.input.for(scope).focus(); },
      loadSkills: async (signal: AbortSignal) => {
        const result = await ctx.remote.skills.list({ sessionId }, signal);
        if (!result.ok) throw new Error(result.error.message);
        return result.value.skills;
      },
    }),
  }, SkillPicker);
}
