import { t } from '@/i18n';
import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconSymbol } from "../components/IconSymbol";
import { ProjectScopeHeader } from "../components/ProjectScopeHeader";
import { skillAgentLabels } from "../../agent/core/skillAssignments";
import { skillDisplayCategory, skillDisplayDescription } from "../../services/builtInSkills";
import {
  type SkillDraft,
  type SkillEditorController,
  SkillEditorPanel,
} from "./SkillEditorPanel";

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

// 关闭时保留抽屉的时长；必须盖过 skills.css 里 .skills-drawer.closing 的动画时长。
const DRAWER_EXIT_MS = 340;

export function SkillsView({ data, controller }: SkillsViewProps) {
  const importInput = useRef<HTMLInputElement>(null);
  const selectedIds = new Set(data.selectedIds);
  const allSelected = data.items.length > 0
    && data.items.every((item) => selectedIds.has(item.id));
  const enabledCount = data.items.filter((item) => item.enabled !== false).length;
  function onImport(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files || [])];
    event.target.value = "";
    if (files.length) controller.importFiles(files);
  }
  // controller 必须进依赖：close 读的是当次渲染算出的未保存状态，缓存住旧的那份会让 Esc 静默丢掉草稿。
  useEffect(() => {
    if (!data.editor) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      controller.close();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [data.editor, controller]);

  // CSS 只在挂载时播入场帧，直接卸载就是"啪"地消失；关闭时先留 DRAWER_EXIT_MS 播完退出动画再拔掉。
  // 这个窗口必须比 skills.css 里 .skills-drawer.closing 的时长长，否则动画会被拦腰截断。
  // 退出中渲染哪份草稿：用 ref 留住最后一次内容，并在同一次渲染里算出退出状态。
  // 用 state 记退出会先卸载一帧再挂回来，那帧就是界面上的闪烁。
  const lastEditor = useRef<SkillsEditorState | null>(null);
  const [, resetExit] = useState(0);
  if (data.editor) lastEditor.current = data.editor;
  const drawer = data.editor ?? lastEditor.current;
  const drawerExiting = Boolean(drawer) && !data.editor;
  useEffect(() => {
    if (!drawerExiting) return;
    const finish = () => {
      lastEditor.current = null;
      resetExit((value) => value + 1);
    };
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      finish();
      return;
    }
    const timer = window.setTimeout(finish, DRAWER_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [drawerExiting]);
  return (
    <>
      <ProjectScopeHeader
        title={t("ui.SkillsView.title.53da139b")}
        description={t("ui.SkillsView.description.0d36078e")}
        showDescription
        flat
      >
        <label className="search">
          <IconSymbol name="search" />
          <input
            value={data.query}
            type="search"
            onChange={(event) => controller.setQuery(event.target.value)}
            placeholder={t("ui.SkillsView.placeholder.15dfafe9")}
          />
        </label>
        <div className="skills-tools">
          <button
            className="button ghost compact"
            onClick={() => importInput.current?.click()}
          >
            <IconSymbol name="upload" />{t("ui.CreationView.text.60e2bcad")}</button>
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
          <input
            ref={importInput}
            className="skills-hidden-input"
            type="file"
            accept=".json,application/json"
            multiple
            onChange={onImport}
          />
        </div>
      </ProjectScopeHeader>
      <div className="skills-workspace">
        <section className="skills-list-pane" aria-label={t("ui.SkillsView.arialabel.c0e4b0f5")}>
          <div className="skills-list-summary">
            <label className="skills-select-all">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() => controller.setSelection(
                  allSelected ? [] : data.items.map((item) => item.id),
                )}
              />
              <span>{t("ui.SkillsView.text.3e44b2a9")}</span>
            </label>
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
              <input
                className="skills-row-select"
                type="checkbox"
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
              <input
                className="skills-enable-toggle"
                type="checkbox"
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
          {!data.items.length && <div className="skills-empty">{t("ui.SkillsView.text.51c77281")}</div>}
        </section>
        {drawer && createPortal(
          <div
            className={`skills-drawer-backdrop${drawerExiting ? " closing" : ""}`}
            onMouseDown={(event) => event.target === event.currentTarget && controller.close()}
          >
            <aside className={`skills-drawer${drawerExiting ? " closing" : ""}`}>
              <SkillEditorPanel
                draft={drawer.draft}
                isNew={drawer.isNew}
                modifiedFields={drawer.modifiedFields}
                dirty={drawer.dirty}
                controller={controller}
              />
            </aside>
          </div>,
          document.body,
        )}
      </div>
    </>
  );
}
