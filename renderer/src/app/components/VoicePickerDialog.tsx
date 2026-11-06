import { t } from '@/i18n';
import { Empty, Input, List, Modal, Select, type InputRef } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  systemVoiceLanguages,
  systemVoices,
} from "../../config/systemVoices";
import { useWorkbenchSurfaceRoot } from "../layout/workbenchSurface";
import { IconSymbol } from "./IconSymbol";
import "./VoicePickerDialog.css";

const ALL_LANGUAGES = "__all__";

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
  const searchRef = useRef<InputRef>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setLanguage("");
  }, [open]);

  const needle = query.trim().toLowerCase();
  const matched = useMemo(() => systemVoices.filter((voice) => (
    (!language || voice.language === language)
    && (!needle || voice.label.toLowerCase().includes(needle) || voice.value.toLowerCase().includes(needle))
  )), [language, needle]);

  const customId = query.trim();
  const showCustomId = Boolean(customId)
    && !systemVoices.some((voice) => voice.value.toLowerCase() === customId.toLowerCase());

  if (!surface) return null;

  return (
    <Modal
      open={open}
      centered
      width={680}
      title={t("ui.VoicePickerDialog.arialabel.509f1be0")}
      footer={null}
      onCancel={onClose}
      afterOpenChange={(visible) => {
        if (visible) searchRef.current?.focus();
      }}
      getContainer={() => surface}
      className="voice-picker-dialog"
      styles={{ body: { padding: "4px 20px 20px" } }}
    >
      <div className="voice-picker-toolbar">
        <Input
          ref={searchRef}
          allowClear
          prefix={<IconSymbol name="search" />}
          placeholder={t("ui.VoicePickerDialog.placeholder.e426b4b2")}
          aria-label={t("ui.VoicePickerDialog.placeholder.e426b4b2")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="voice-picker-filters">
          <Select
            aria-label={t("ui.VoicePickerDialog.text.cd99b225")}
            value={language || ALL_LANGUAGES}
            onChange={(next) => setLanguage(next === ALL_LANGUAGES ? "" : next)}
            options={[
              { value: ALL_LANGUAGES, label: t("ui.VoicePickerDialog.text.cd99b225") },
              ...systemVoiceLanguages.map((item) => ({ value: item.name, label: item.label })),
            ]}
          />
        </div>
      </div>
      <div className="voice-picker-list">
        <List
          split={false}
          dataSource={matched}
          locale={{
            emptyText: !matched.length && !showCustomId
              ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("ui.VoicePickerDialog.text.0f9ec3de")} />
              : null,
          }}
          renderItem={(voice) => (
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
          )}
        />
        {showCustomId && (
          <button type="button" className="voice-picker-row voice-picker-row-custom" onClick={() => onSelect(customId)}>
            <strong>{t("ui.VoicePickerDialog.text.dc1ce5b6")}</strong>
            <em>{customId}</em>
          </button>
        )}
      </div>
    </Modal>
  );
}
