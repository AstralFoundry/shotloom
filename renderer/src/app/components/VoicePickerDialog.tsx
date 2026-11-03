import { t } from '@/i18n';
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  systemVoiceLanguages,
  systemVoices,
} from "../../config/systemVoices";
import { useWorkbenchSurfaceRoot } from "../layout/workbenchSurface";
import { IconSymbol } from "./IconSymbol";
import "./VoicePickerDialog.css";

/**
 * 音色选择器。目录只声明参数是 voice，清单来自系统音色库；
 * 搜索同时允许未收录的 ID（复刻音色），避免下拉列表变成新的白名单。
 */
export function VoicePickerDialog({ open, value, onSelect, onClose }: {
  open: boolean; value: string; onSelect: (voiceId: string) => void; onClose: () => void;
}) {
  const surface = useWorkbenchSurfaceRoot();
  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setLanguage("");
    searchRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const needle = query.trim().toLowerCase();
  const matched = useMemo(() => systemVoices.filter((voice) => (
    (!language || voice.language === language)
    && (!needle || voice.label.toLowerCase().includes(needle) || voice.value.toLowerCase().includes(needle))
  )), [language, needle]);

  const customId = query.trim();
  const showCustomId = Boolean(customId)
    && !systemVoices.some((voice) => voice.value.toLowerCase() === customId.toLowerCase());

  if (!open || !surface) return null;

  return createPortal(
    <div
      className="voice-picker-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t("ui.VoicePickerDialog.arialabel.509f1be0")}
      tabIndex={-1}
      onPointerDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section className="voice-picker-modal">
        <header className="voice-picker-head">
          <strong>{t("ui.VoicePickerDialog.arialabel.509f1be0")}</strong>
          <button type="button" aria-label={t("ui.CanvasToolbarCustomizeDialog.arialabel.6c14bd7f")} onClick={onClose}><IconSymbol name="x" /></button>
        </header>
        <div className="voice-picker-toolbar">
          <label className="voice-picker-search">
            <IconSymbol name="search" />
            <input
              ref={searchRef}
              type="search"
              placeholder={t("ui.VoicePickerDialog.placeholder.e426b4b2")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="voice-picker-filters">
            <select
              className={`voice-picker-chip${language ? " active" : ""}`}
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
            >
              <option value="">{t("ui.VoicePickerDialog.text.cd99b225")}</option>
              {systemVoiceLanguages.map((item) => <option key={item.name} value={item.name}>{item.label}</option>)}
            </select>
          </div>
        </div>
        <div className="voice-picker-list">
          {matched.map((voice) => (
            <button
              key={voice.value}
              type="button"
              className={`voice-picker-row${voice.value === value ? " active" : ""}`}
              onClick={() => onSelect(voice.value)}
            >
              <strong>{voice.label}</strong>
              {voice.label !== voice.value && <em>{voice.value}</em>}
              {voice.value === value && <IconSymbol name="check" />}
            </button>
          ))}
          {showCustomId && (
            <button type="button" className="voice-picker-row voice-picker-row-custom" onClick={() => onSelect(customId)}>
              <strong>{t("ui.VoicePickerDialog.text.dc1ce5b6")}</strong>
              <em>{customId}</em>
            </button>
          )}
          {!matched.length && !showCustomId && <p className="voice-picker-empty">{t("ui.VoicePickerDialog.text.0f9ec3de")}</p>}
        </div>
      </section>
    </div>,
    surface,
  );
}
