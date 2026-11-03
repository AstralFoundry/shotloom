import { t } from '@/i18n';
import { useState } from "react";
import { IconSymbol } from "../components/IconSymbol";
import { configurableSkillAgents } from "../../agent/core/skillAssignments";

type CatalogRecord = Record<string, unknown>;
export interface SkillDraft extends CatalogRecord {
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
}
const clone = <T,>(value: T): T => structuredClone(value);
export function SkillEditorDialog({
  skill,
  isNew = false,
  modifiedFields = [],
  onClose,
  onSave,
  onReset,
}: {
  skill: SkillDraft;
  isNew?: boolean;
  modifiedFields?: string[];
  onClose: () => void;
  onSave: (skill: SkillDraft) => void;
  onReset?: () => void;
}) {
  const [draft, setDraft] = useState(() => clone(skill));
  const [error, setError] = useState("");
  const patch = (value: Partial<SkillDraft>) => {
    setDraft((current) => ({ ...current, ...value }));
    setError("");
  };
  function submit() {
    if (!/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(draft.id)) {
      return setError(t("ui.CatalogEditorDialogs.text.c2e2e407"));
    }
    if (!draft.name.trim()) return setError(t("ui.CatalogEditorDialogs.text.ca898456"));
    if (!draft.description.trim()) return setError(t("ui.CatalogEditorDialogs.text.27fa3365"));
    if (!draft.instructions.trim()) return setError(t("ui.CatalogEditorDialogs.text.47d3f313"));
    onSave(clone(draft));
  }
  return (
    <div
      className="recipe-dialog-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="recipe-dialog skill-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={isNew ? t("ui.CatalogEditorDialogs.text.412b2184") : t("ui.CatalogEditorDialogs.text.74c14ff6")}
      >
        <header>
          <div>
            <h3>{isNew ? t("ui.CatalogEditorDialogs.text.412b2184") : t("ui.CatalogEditorDialogs.text.f872afc3", { value0: draft.name })}</h3>
            {modifiedFields.length > 0 && (
              <p className="recipe-dialog-change-summary">
                {t("ui.CatalogEditorDialogs.text.c920e429")}{modifiedFields.length} {t("ui.CatalogEditorDialogs.text.bc92ff5e")}</p>
            )}
          </div>
          <label className="skill-dialog-enabled">
            <input
              checked={draft.enabled}
              type="checkbox"
              onChange={(event) => patch({ enabled: event.target.checked })}
            />
            {draft.enabled ? t("ui.CatalogEditorDialogs.text.25d28431") : t("ui.CatalogEditorDialogs.text.0fe5a98e")}
          </label>
          <button
            className="icon-action"
            type="button"
            title={t("ui.CanvasToolbarCustomizeDialog.arialabel.6c14bd7f")}
            onClick={onClose}
          >
            <IconSymbol name="x" />
          </button>
        </header>
        <div className="recipe-dialog-body">
          <p className="catalog-editor-guidance">{t("ui.CatalogEditorDialogs.text.7157b41b")}</p>
          {draft.builtIn && (
            <div className="recipe-readonly-note">
              <IconSymbol name="spark" />
              <span>
                {modifiedFields.length
                  ? t("ui.CatalogEditorDialogs.text.7bf0aabd", { value0: modifiedFields.join("、") })
                  : t("ui.CatalogEditorDialogs.text.e9640c74")}
              </span>
              {modifiedFields.length > 0 && onReset && (
                <button type="button" onClick={onReset}>{t("ui.CameraControlPanel.text.a191935b")}</button>
              )}
            </div>
          )}
          <div className="skill-dialog-grid">
            <label className="recipe-field">
              <span>ID</span>
              <input
                value={draft.id}
                disabled={!isNew}
                placeholder="video-production"
                onChange={(event) => patch({ id: event.target.value.trim() })}
              />
            </label>
            <label className="recipe-field">
              <span>{t("ui.CatalogEditorDialogs.text.1be7ae4f")}</span>
              <input
                value={draft.name}
                placeholder={t("ui.CatalogEditorDialogs.placeholder.8aef59aa")}
                onChange={(event) => patch({ name: event.target.value })}
              />
            </label>
            <label className="recipe-field">
              <span>{t("ui.CatalogEditorDialogs.text.435c5259")}</span>
              <input
                value={draft.category}
                placeholder="general / video / image"
                onChange={(event) => patch({ category: event.target.value })}
              />
            </label>
            <label className="recipe-field">
              <span>{t("ui.CatalogEditorDialogs.text.989d1aff")}</span>
              <input
                value={draft.version}
                type="number"
                min="1"
                onChange={(event) =>
                  patch({
                    version: Math.max(1, Number(event.target.value) || 1),
                  })}
              />
            </label>
          </div>
          <label className="recipe-field">
            <span>{t("ui.CatalogEditorDialogs.text.daed78ea")}</span>
            <input
              value={draft.description}
              placeholder={t("ui.CatalogEditorDialogs.placeholder.0d487900")}
              onChange={(event) => patch({ description: event.target.value })}
            />
            <small>{t("ui.CatalogEditorDialogs.text.5cd6174f")}</small>
          </label>
          <fieldset className="recipe-field skill-agent-field">
            <legend>{t("ui.CatalogEditorDialogs.text.d2d4a376")}</legend>
            <small>{t("ui.CatalogEditorDialogs.text.1c196856")}</small>
            <div className="skill-agent-options">
              {configurableSkillAgents.map((agent) => {
                const checked = (draft.agentIds || []).includes(agent.id);
                return (
                  <label key={agent.id}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => patch({
                        agentIds: checked
                          ? (draft.agentIds || []).filter((id) => id !== agent.id)
                          : [...(draft.agentIds || []), agent.id],
                      })}
                    />
                    {agent.label}
                  </label>
                );
              })}
            </div>
          </fieldset>
          <label className="recipe-field skill-instruction-field">
            <span>
              {t("ui.CatalogEditorDialogs.text.a448699a")}<em>{draft.instructions.length} {t("ui.CatalogEditorDialogs.text.582c5006")}</em>
            </span>
            <textarea
              value={draft.instructions}
              rows={12}
              spellCheck={false}
              placeholder={t("ui.CatalogEditorDialogs.placeholder.fffa176b")}
              onChange={(event) => patch({ instructions: event.target.value })}
            />
          </label>
          {error && <p className="recipe-dialog-error">{error}</p>}
        </div>
        <footer>
          <button className="button ghost" type="button" onClick={onClose}>
            {t("ui.ImageWatermarkEditor.text.4d0b4688")}</button>
          <button className="button primary" type="button" onClick={submit}>
            {t("ui.CatalogEditorDialogs.text.52427937")}</button>
        </footer>
      </section>
    </div>
  );
}
