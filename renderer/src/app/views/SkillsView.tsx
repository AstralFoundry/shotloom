import { t } from '@/i18n';
import { Checkbox, Drawer, Empty, Switch, Upload } from "antd";
import { useEffect, useState } from "react";
import { IconSymbol } from "../components/IconSymbol";
import { ProjectScopeHeader } from "../components/ProjectScopeHeader";
import { skillAgentLabels } from "../../agent/core/skillAssignments";
import { skillDisplayCategory, skillDisplayDescription } from "../../services/builtInSkills";
import {
  type SkillDraft,
  type SkillEditorController,
  SkillEditorPanel,
} from "./SkillEditorPanel";
import { SearchInput } from "../components/SearchInput";

export interface SkillListItem {
  id: string;
  name: string;
  description?: string;
  enabled?: boolean;
  builtIn?: boolean;
  version?: number;
  category?: string;
  agentIds?: string[];
}

export interface SkillsEditorState {
  draft: SkillDraft;
  isNew: boolean;
  modifiedFields: string[];
  dirty: boolean;
}

export interface SkillsData {
  items: SkillListItem[];
  query: string;
  selectedIds: string[];
  editor: SkillsEditorState | null;
}

export interface SkillsController extends SkillEditorController {
  setQuery: (value: string) => void;
  setSelection: (ids: string[]) => void;
  toggleSelection: (id: string) => void;
  openSkill: (id: string) => void;
  createSkill: () => void;
  toggleSkill: (id: string) => void;
  deleteSkill: (id: string) => void;
  resetSkill: (id: string) => void;
  importFiles: (files: File[]) => void;
  exportSelected: () => void;
}

interface SkillsViewProps {
  data: SkillsData;
  controller: SkillsController;
}

export function SkillsView({ data, controller }: SkillsViewProps) {
  const selectedIds = new Set(data.selectedIds);
  const allSelected = data.items.length > 0
    && data.items.every((item) => selectedIds.has(item.id));
  const enabledCount = data.items.filter((item) => item.enabled !== false).length;
  // 关闭动画期间 antd 仍持有 DOM，但 data.editor 已经变空；用最后一份草稿撑住内容，
  // 等 afterOpenChange(false) 再清掉，避免关闭瞬间闪一帧空白。
  const [cachedEditor, setCachedEditor] = useState<SkillsEditorState | null>(null);
  useEffect(() => {
    if (data.editor) setCachedEditor(data.editor);
  }, [data.editor]);
  const editor = data.editor ?? cachedEditor;
  return (
    <>
      <ProjectScopeHeader
        title={t("ui.SkillsView.title.53da139b")}
        description={t("ui.SkillsView.description.0d36078e")}
        showDescription
        flat
      >
        <label className="search">
          <SearchInput
            value={data.query}
            onChange={controller.setQuery}
            placeholder={t("ui.SkillsView.placeholder.15dfafe9")}
          />
        </label>
        <div className="skills-tools">
          <Upload
            accept=".json,application/json"
            multiple
            showUploadList={false}
            beforeUpload={(file, fileList) => {
              // antd 对每个文件各调一次，只在第一批里导入一次整组文件。
              if (file === fileList[0]) controller.importFiles([...fileList]);
              return false;
            }}
          >
            <button className="button ghost compact">
              <IconSymbol name="upload" />{t("ui.CreationView.text.60e2bcad")}</button>
          </Upload>
          <button
            className="button ghost compact"
            disabled={!data.selectedIds.length}
            onClick={controller.exportSelected}
          >
            <IconSymbol name="download" />{t("ui.SkillsView.text.b1a497ad")}{data.selectedIds.length})
          </button>
          <button
            className="button primary compact"
            onClick={controller.createSkill}
          >
            {t("ui.SkillsView.text.8918a182")}</button>
        </div>
      </ProjectScopeHeader>
      <div className="skills-workspace">
        <section className="skills-list-pane" aria-label={t("ui.SkillsView.arialabel.c0e4b0f5")}>
          <div className="skills-list-summary">
            <Checkbox
              className="skills-select-all"
              checked={allSelected}
              onChange={() => controller.setSelection(
                allSelected ? [] : data.items.map((item) => item.id),
              )}
            >
              {t("ui.SkillsView.text.3e44b2a9")}
            </Checkbox>
            <span>
              {t(data.items.length === 1 ? 'skill.summary.one' : 'skill.summary.other', {
                count: data.items.length, enabled: enabledCount,
              })}</span>
          </div>
          {data.items.map((item) => (
            <div
              key={item.id}
              className={`skills-row${item.enabled === false ? " disabled" : ""}${
                data.editor?.draft.id === item.id ? " active" : ""
              }`}
            >
              <Checkbox
                className="skills-row-select"
                checked={selectedIds.has(item.id)}
                aria-label={t("ui.SkillsView.text.6cf2f565", { value0: item.name })}
                onChange={() => controller.toggleSelection(item.id)}
              />
              <button
                type="button"
                className="skills-row-main"
                onClick={() => controller.openSkill(item.id)}
              >
                <span className="skills-row-name">
                  <strong>{item.name}</strong>
                  {item.builtIn && <span>{t("ui.SkillsView.text.09ceea76")}</span>}
                  <span>v{item.version || 1}</span>
                  {item.category && <span>{skillDisplayCategory(item)}</span>}
                </span>
                <span className="skills-row-agents" aria-label={t("ui.SkillsView.arialabel.f3249e29")}>
                  {skillAgentLabels(item.id, item.agentIds).map((agent) => (
                    <span key={agent}>{agent}</span>
                  ))}
                  {!skillAgentLabels(item.id, item.agentIds).length && <span>{t("ui.SkillsView.text.1700cbab")}</span>}
                </span>
                <span className="skills-row-description">{skillDisplayDescription(item) || t("ui.SkillsView.text.6dd28f40")}</span>
                <span className="skills-row-id">{item.id}</span>
              </button>
              <Switch
                className="skills-enable-toggle"
                size="small"
                checked={item.enabled !== false}
                aria-label={t("ui.promptReferenceEditor.text.dca59cc0", { value0: item.enabled === false ? t("ui.SkillsView.text.d4e9ca3d") : t("ui.SkillsView.text.d989e551"), value1: item.name })}
                onChange={() => controller.toggleSkill(item.id)}
              />
              <button
                className={`icon-action${item.builtIn ? "" : " danger"}`}
                title={item.builtIn ? t("ui.CameraControlPanel.text.a191935b") : t("ui.MaterialGrid.title.3755f56f")}
                onClick={() => (item.builtIn
                  ? controller.resetSkill(item.id)
                  : controller.deleteSkill(item.id))}
              >
                <IconSymbol name={item.builtIn ? "refresh" : "trash"} />
              </button>
            </div>
          ))}
          {!data.items.length && (
            <Empty
              className="skills-empty"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t("ui.SkillsView.text.51c77281")}
            />
          )}
        </section>
        <Drawer
          open={Boolean(data.editor)}
          placement="right"
          size={720}
          closable={false}
          onClose={() => controller.close()}
          rootClassName="skills-drawer"
          styles={{
            body: { padding: 0, display: "flex", flexDirection: "column" },
            mask: { background: "var(--scrim-modal)", backdropFilter: "blur(3px)" },
          }}
          afterOpenChange={(open) => {
            if (!open) setCachedEditor(null);
          }}
        >
          {editor && (
            <SkillEditorPanel
              draft={editor.draft}
              isNew={editor.isNew}
              modifiedFields={editor.modifiedFields}
              dirty={editor.dirty}
              controller={controller}
            />
          )}
        </Drawer>
      </div>
    </>
  );
}
