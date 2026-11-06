import { getLocale } from '../../i18n/index.ts';
import { t } from '@/i18n';
import { useState } from 'react';
import { Dropdown, type MenuProps } from 'antd';
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
  const [open, setOpen] = useState(false);
  const selected = sessions.find(session => session.id === selectedId);
  const menuItems: MenuProps["items"] = sessions.length
    ? [{
      type: "group",
      label: (
        <span className="harness-session-menu-head">
          {t("ui.HarnessSessionToolbar.text.fb898408")}
          <span>{sessions.length}</span>
        </span>
      ),
      children: sessions.map(session => ({
        key: String(session.id),
        label: (
          <span className="harness-session-menu-row">
            <span className="harness-session-item-copy">
              <strong>{session.title || t("ui.HarnessSessionToolbar.text.1b7abf96")}</strong>
              <time>{sessionDate(session.updatedAt || session.createdAt)}</time>
            </span>
            {session.id === selectedId && <IconSymbol name="check" />}
          </span>
        ),
      })),
    }]
    : [{ key: "empty", disabled: true, label: t("ui.HarnessSessionToolbar.text.1b7abf96") }];
  return <nav className="harness-chat-toolbar" aria-label={t("ui.HarnessSessionToolbar.arialabel.9da5449a")}>
    <Dropdown
      open={open}
      onOpenChange={setOpen}
      trigger={["click"]}
      placement="bottomLeft"
      classNames={{ root: "harness-session-dropdown" }}
      menu={{
        items: menuItems,
        selectedKeys: selectedId ? [selectedId] : [],
        onClick: ({ key }) => {
          setOpen(false);
          if (key !== "empty") onSelect(key);
        },
      }}
    >
      <button type="button" className="harness-session-trigger" aria-label={t("ui.HarnessSessionToolbar.arialabel.8ac2497a")} title={t("ui.HarnessSessionToolbar.arialabel.8ac2497a")} aria-haspopup="menu" aria-expanded={open}>
        <IconSymbol name="chat" className="harness-session-mark" />
        <span>{selected?.title || t("ui.HarnessSessionToolbar.text.1b7abf96")}</span>
        <IconSymbol name="chevron-down" className="harness-session-chevron" />
      </button>
    </Dropdown>
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
