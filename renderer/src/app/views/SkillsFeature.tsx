import { t } from '@/i18n';
import { useMemo, useState, useSyncExternalStore } from "react";
import { CANVAS_AGENT_ID } from "../../agent/agents/definitions.ts";
import {
  builtInSkillChanges,
  skillDisplayCategory,
  skillDisplayDescription,
} from "../../services/builtInSkills";
import { sortEnabledFirst } from "../../services/catalogOrder";
import { desktopApi } from "../../services/desktopApi";
import {
  getDomainRevision,
  subscribeDomain,
  toRaw,
} from "../../store/domainReactivity.ts";
import { showToast, showErrorMessage } from "../../store/notificationStore";
import {
  createSkillDraft,
  deleteSkill,
  resetSkillToBuiltIn,
  skillsStore,
  toggleSkill,
  upsertSkill,
  type SkillRecord,
} from "../../store/skillsStore";
import { clonePlainData } from "../../utils/plainDataClone";
import type { SkillDraft } from "./SkillEditorPanel";
import {
  type SkillsController,
  type SkillsData,
  SkillsView,
} from "./SkillsView";

interface OpenSkill {
  draft: SkillDraft;
  isNew: boolean;
  /** 打开或保存时的快照，用于判断面板里是否还有未保存的改动。 */
  baseline: string;
}

const message = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause || t("ui.SkillsFeature.text.a4807a36"));

function readSkills(): SkillRecord[] {
  return toRaw(skillsStore.skills) as SkillRecord[];
}

function toDraft(item: SkillRecord): SkillDraft {
  const draft = clonePlainData(item) as SkillDraft;
  return draft;
}

export function SkillsFeature() {
  const revision = useSyncExternalStore(subscribeDomain, getDomainRevision);
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [open, setOpen] = useState<OpenSkill | null>(null);

  const skills = readSkills();
  const items = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matched = skills.filter((item) => !needle || [
      item.id,
      item.name,
      item.description,
      skillDisplayDescription(item),
      item.category,
      skillDisplayCategory(item),
      ...((item.tags as string[] | undefined) || []),
    ].join(" ").toLowerCase().includes(needle));
    return sortEnabledFirst(matched);
  }, [revision, query]);

  const dirty = Boolean(open && JSON.stringify(open.draft) !== open.baseline);
  const discardGuard = () => !dirty || window.confirm(t("ui.SkillsFeature.text.b9acb156"));

  async function run(action: () => void | Promise<void>, success?: string) {
    try {
      await action();
      if (success) showToast(success, 'success');
    } catch (cause) {
      showErrorMessage(message(cause), t("ui.SkillsFeature.text.a4807a36"));
    }
  }

  function openSkill(id: string) {
    if (open?.draft.id === id || !discardGuard()) return;
    const item = readSkills().find((skill) => skill.id === id);
    if (!item) return;
    const draft = toDraft(item);
    setOpen({ draft, isNew: false, baseline: JSON.stringify(draft) });
  }

  function createSkill() {
    if (!discardGuard()) return;
    const draft = createSkillDraft([CANVAS_AGENT_ID]) as SkillDraft;
    setOpen({ draft, isNew: true, baseline: JSON.stringify(draft) });
  }

  /** 面板里的「恢复默认」只作用于当前打开的技能，确认放在 run 之外以免取消后仍提示成功。 */
  function resetOpenSkill() {
    const skillId = open?.draft.id;
    if (!skillId) return;
    if (!window.confirm(t("ui.SkillsFeature.text.79325288", { value0: open!.draft.name }))) return;
    void run(async () => {
      await resetSkillToBuiltIn(skillId);
      const item = readSkills().find((skill) => skill.id === skillId);
      if (!item) return;
      const draft = toDraft(item);
      setOpen({ draft, isNew: false, baseline: JSON.stringify(draft) });
    }, t("ui.SkillsFeature.text.c5ee08da"));
  }

  async function importFiles(files: File[]) {
    let imported = 0;
    const errors: string[] = [];
    for (const file of files) {
      try {
        const payload = JSON.parse(await file.text());
        for (const item of transferItems(payload)) {
          try {
            await upsertSkill({ ...item, enabled: item.enabled !== false });
            imported += 1;
          } catch (cause) { errors.push(`${file.name}：${message(cause)}`); }
        }
      } catch (cause) { errors.push(`${file.name}：${message(cause)}`); }
    }
    showToast(imported
      ? t("ui.SkillsFeature.text.bac4c837", { value0: imported, value1: errors.length ? t("ui.SkillsFeature.text.c670f269", { value0: errors.length }) : "" })
      : errors[0] || t("ui.SkillsFeature.text.42663980"));
  }

  async function exportSelected() {
    const ids = new Set(selectedIds);
    const skills = readSkills()
      .filter((item) => ids.has(item.id))
      .map((item) => {
        const copy = toDraft(item) as { updatedAt?: string };
        delete copy.updatedAt;
        return copy;
      });
    if (await desktopApi.file.saveJson("shotloom-skills.json", {
      format: "shotloom.skill-catalog", formatVersion: 1,
      exportedAt: new Date().toISOString(), skills,
    })) showToast(t("ui.SkillsFeature.text.1469a6aa", { value0: skills.length }));
  }

  const controller: SkillsController = {
    setQuery,
    setSelection: setSelectedIds,
    toggleSelection: (id) => setSelectedIds((current) => current.includes(id)
      ? current.filter((item) => item !== id)
      : [...current, id]),
    openSkill,
    createSkill,
    toggleSkill: (id) => void run(() => toggleSkill(id)),
    deleteSkill: (id) => void run(async () => {
      await deleteSkill(id);
      if (open?.draft.id === id) setOpen(null);
      setSelectedIds((current) => current.filter((item) => item !== id));
    }, t("ui.SkillsFeature.text.34c29b69")),
    resetSkill: (id) => void run(async () => {
      await resetSkillToBuiltIn(id);
    }, t("ui.SkillsFeature.text.c5ee08da")),
    importFiles: (files) => void run(() => importFiles(files)),
    exportSelected: () => void run(exportSelected),
    patch: (value) => setOpen((current) => current
      ? { ...current, draft: { ...current.draft, ...value } }
      : current),
    save: (draft) => void run(async () => {
      if (open?.isNew && readSkills().some((item) => item.id === draft.id)) {
        throw new Error(t("ui.SkillsFeature.text.bd56b279", { value0: draft.id }));
      }
      const saved = toDraft(await upsertSkill(draft));
      setOpen({ draft: saved, isNew: false, baseline: JSON.stringify(saved) });
    }, t("ui.SkillsFeature.text.e1f0b15b")),
    close: () => discardGuard() && setOpen(null),
    reset: resetOpenSkill,
  };

  const data: SkillsData = {
    items,
    query,
    selectedIds,
    editor: open && {
      draft: open.draft,
      isNew: open.isNew,
      modifiedFields: builtInSkillChanges(open.draft),
      dirty,
    },
  };
  return <SkillsView data={data} controller={controller} />;
}

/** 导入文件既接受 skill-catalog 包装，也接受单个技能对象。 */
function transferItems(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[];
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.skills)) {
      return record.skills as Record<string, unknown>[];
    }
    if (record.skill && typeof record.skill === "object") {
      return [record.skill as Record<string, unknown>];
    }
    return [record];
  }
  return [];
}
