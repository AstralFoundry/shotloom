import { getLocale } from '../../i18n/index.ts';
import { t } from '@/i18n';
import { useEffect, useRef } from 'react';
import type { HarnessSession } from '../../services/harnessSessionStore';
import { IconSymbol } from '../components/IconSymbol';

/** Product conversation navigation; official Harness owns the conversation itself. */
export function HarnessSessionToolbar({ sessions, selectedId, onSelect, onCreate, onClose }: {
  sessions: HarnessSession[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onClose: (() => void) | undefined;
}) {
  const history = useRef<HTMLDetailsElement>(null);
  const selected = sessions.find(session => session.id === selectedId);
  useEffect(() => {
    const close = () => { if (history.current) history.current.open = false; };
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !history.current?.contains(event.target)) close();
    };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('blur', close);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('blur', close);
    };
  }, []);
  return <nav className="harness-chat-toolbar" aria-label={t("ui.HarnessSessionToolbar.arialabel.9da5449a")}>
    <details ref={history} className="harness-session-history" onKeyDown={event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.currentTarget.open = false;
      event.currentTarget.querySelector('summary')?.focus();
    }}>
      <summary className="harness-session-trigger" aria-label={t("ui.HarnessSessionToolbar.arialabel.8ac2497a")} title={t("ui.HarnessSessionToolbar.arialabel.8ac2497a")}>
        <IconSymbol name="chat" className="harness-session-mark" />
        <span>{selected?.title || t("ui.HarnessSessionToolbar.text.1b7abf96")}</span>
        <IconSymbol name="chevron-down" className="harness-session-chevron" />
      </summary>
      <section className="harness-session-menu" aria-label={t("ui.HarnessSessionToolbar.arialabel.f8b27fa9")}>
        <header>{t("ui.HarnessSessionToolbar.text.fb898408")}<span>{sessions.length}</span></header>
        <div className="harness-session-list">
          {sessions.map(session => <button key={session.id} type="button" className="harness-session-item"
            aria-label={t("ui.HarnessSessionToolbar.text.7a336819", { value0: session.title || t("ui.HarnessSessionToolbar.text.1b7abf96"), value1: sessionDate(session.updatedAt || session.createdAt) })}
            title={session.title || t("ui.HarnessSessionToolbar.text.1b7abf96")}
            aria-pressed={session.id === selectedId} onClick={() => {
              if (history.current) history.current.open = false;
              if (session.id) onSelect(session.id);
            }}>
            <span className="harness-session-item-copy"><strong>{session.title || t("ui.HarnessSessionToolbar.text.1b7abf96")}</strong>
              <time>{sessionDate(session.updatedAt || session.createdAt)}</time></span>
            {session.id === selectedId && <IconSymbol name="check" />}
          </button>)}
        </div>
      </section>
    </details>
    <div className="harness-session-actions">
      <button type="button" className="harness-session-icon" aria-label={t("ui.HarnessSessionToolbar.arialabel.b3e55858")} title={t("ui.HarnessSessionToolbar.arialabel.b3e55858")} onClick={onCreate}><IconSymbol name="plus" /></button>
      {onClose && <button type="button" className="harness-session-icon" onClick={onClose} aria-label={t("ui.HarnessSessionToolbar.arialabel.d3d63447")} title={t("ui.HarnessSessionToolbar.arialabel.d3d63447")}><IconSymbol name="x" /></button>}
    </div>
  </nav>;
}

function sessionDate(value: unknown): string {
  if (typeof value !== 'string') return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleString(getLocale(), { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}
