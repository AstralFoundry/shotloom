import { t } from '@/i18n';
import { Checkbox, Input, InputNumber, Switch } from "antd";
import { useState } from "react";
import { IconSymbol } from "../components/IconSymbol";
import { configurableSkillAgents } from "../../agent/core/skillAssignments";

export interface SkillDraft {
  id: string;
  name: string;
  category: string;
  version: number;
  description: string;
  enabled: boolean;
  builtIn?: boolean;
  metadata?: Record<string, unknown>;
  instructions: string;
  agentIds?: string[];
  [key: string]: unknown;
}

export interface SkillEditorController {
  patch: (patch: Partial<SkillDraft>) => void;
  save: (draft: SkillDraft) => void;
  close: () => void;
  reset: () => void;
}

interface SkillEditorPanelProps {
  draft: SkillDraft;
  isNew: boolean;
  modifiedFields: string[];
  dirty: boolean;
  controller: SkillEditorController;
}

export function SkillEditorPanel(
  { draft, isNew, modifiedFields, dirty, controller }: SkillEditorPanelProps,
) {
  const [error, setError] = useState("");
  function submit() {
    if (!/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(draft.id)) {
      return setError(t("ui.SkillEditorPanel.text.c2e2e407"));
    }
    if (!draft.name.trim()) return setError(t("ui.SkillEditorPanel.text.ca898456"));
    if (!draft.description.trim()) return setError(t("ui.SkillEditorPanel.text.27fa3365"));
    if (!draft.instructions.trim()) return setError(t("ui.SkillEditorPanel.text.47d3f313"));
    setError("");
    controller.save(draft);
  }
  const patch = (value: Partial<SkillDraft>) => {
    setError("");
    controller.patch(value);
  };
  return (
    <section
      className="skill-editor-panel"
      aria-label={isNew ? t("ui.SkillEditorPanel.text.412b2184") : t("ui.SkillEditorPanel.text.74c14ff6")}
    >
      <header className="skill-editor-head">
        <div className="skill-editor-heading">
          <h3>
            {isNew ? t("ui.SkillEditorPanel.text.412b2184") : t("ui.SkillEditorPanel.text.f872afc3", { value0: draft.name })}
            {dirty && <em>{t("ui.SkillEditorPanel.text.4123f1fa")}</em>}
          </h3>
          {modifiedFields.length > 0 && (
            <p className="skill-editor-change-summary">
              {t("ui.SkillEditorPanel.text.c920e429")}{modifiedFields.length} {t("ui.SkillEditorPanel.text.bc92ff5e")}</p>
          )}
        </div>
        <div className="skill-editor-actions">
          <label className="skill-editor-enabled">
            <Switch
              size="small"
              checked={draft.enabled}
              onChange={(checked) => patch({ enabled: checked })}
            />
            {draft.enabled ? t("ui.SkillEditorPanel.text.25d28431") : t("ui.SkillEditorPanel.text.0fe5a98e")}
          </label>
          <button className="button primary compact" type="button" onClick={submit}>
            {t("ui.SkillEditorPanel.text.52427937")}</button>
          <button
            className="icon-action"
            type="button"
            title={t("ui.CanvasToolbarCustomizeDialog.arialabel.6c14bd7f")}
            onClick={controller.close}
          >
            <IconSymbol name="x" />
          </button>
        </div>
      </header>
      <div className="skill-editor-body">
        <p className="skill-editor-guidance">{t("ui.SkillEditorPanel.text.7157b41b")}</p>
        {draft.builtIn && (
          <div className="skill-editor-note">
            <IconSymbol name="spark" />
            <span>
              {modifiedFields.length
                ? t("ui.SkillEditorPanel.text.7bf0aabd", { value0: modifiedFields.join("、") })
                : t("ui.SkillEditorPanel.text.e9640c74")}
            </span>
            {modifiedFields.length > 0 && (
              <button type="button" onClick={controller.reset}>{t("ui.CameraControlPanel.text.a191935b")}</button>
            )}
          </div>
        )}
        <div className="skill-editor-grid">
          <label className="skill-field">
            <span>ID</span>
            <Input
              value={draft.id}
              disabled={!isNew}
              placeholder="video-production"
              onChange={(event) => patch({ id: event.target.value.trim() })}
            />
          </label>
          <label className="skill-field">
            <span>{t("ui.CatalogEditorDialogs.text.1be7ae4f")}</span>
            <Input
              value={draft.name}
              placeholder={t("ui.SkillEditorPanel.placeholder.8aef59aa")}
              onChange={(event) => patch({ name: event.target.value })}
            />
          </label>
          <label className="skill-field">
            <span>{t("ui.SkillEditorPanel.text.435c5259")}</span>
            <Input
              value={draft.category}
              placeholder="general / video / image"
              onChange={(event) => patch({ category: event.target.value })}
            />
          </label>
          <label className="skill-field">
            <span>{t("ui.SkillEditorPanel.text.989d1aff")}</span>
            <InputNumber
              className="skill-number-input"
              value={draft.version}
              min={1}
              onChange={(value) =>
                controller.patch({
                  version: Math.max(1, Number(value) || 1),
                })}
            />
          </label>
        </div>
        <label className="skill-field">
          <span>{t("ui.SkillEditorPanel.text.daed78ea")}</span>
          <Input
            value={draft.description}
            placeholder={t("ui.SkillEditorPanel.placeholder.0d487900")}
            onChange={(event) => patch({ description: event.target.value })}
          />
          <small>{t("ui.SkillEditorPanel.text.5cd6174f")}</small>
        </label>
        <fieldset className="skill-field skill-agent-field">
          <legend>{t("ui.SkillEditorPanel.text.d2d4a376")}</legend>
          <small>{t("ui.SkillEditorPanel.text.1c196856")}</small>
          <div className="skill-agent-options">
            {configurableSkillAgents.map((agent) => {
              const checked = (draft.agentIds || []).includes(agent.id);
              return (
                <Checkbox
                  key={agent.id}
                  checked={checked}
                  onChange={() => patch({
                    agentIds: checked
                      ? (draft.agentIds || []).filter((id) => id !== agent.id)
                      : [...(draft.agentIds || []), agent.id],
                  })}
                >
                  {agent.label}
                </Checkbox>
              );
            })}
          </div>
        </fieldset>
        <label className="skill-field skill-instruction-field">
          <span>
            {t("ui.SkillEditorPanel.text.a448699a")}<em>{draft.instructions.length} {t("ui.SkillEditorPanel.text.582c5006")}</em>
          </span>
          <Input.TextArea
            value={draft.instructions}
            rows={16}
            spellCheck={false}
            placeholder={t("ui.SkillEditorPanel.placeholder.fffa176b")}
            onChange={(event) => patch({ instructions: event.target.value })}
          />
        </label>
        {error && <p className="skill-editor-error">{error}</p>}
      </div>
    </section>
  );
}
