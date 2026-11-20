import { t } from '@/i18n';
import { App } from 'antd';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { cloudEnabled } from '../../utils/cloudConfig';
import { patchCatalogItems, readCatalogItem, readCatalogPage } from '../../services/cloudCatalogPages';
import type { CatalogPage } from '../../../../shared/catalogPages';
import { CANVAS_AGENT_ID } from "../../agent/agents/definitions.ts";
import {
  isUserSkill,
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
  skillsStore,
  toggleSkill,
  upsertSkill,
  normalizeSkill,
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
  revision?: number | undefined;
}

const message = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause || t("ui.SkillsFeature.text.a4807a36"));

function readSkills(): SkillRecord[] {
  return (toRaw(skillsStore.skills) as SkillRecord[]).filter(isUserSkill);
}

function toDraft(item: SkillRecord): SkillDraft {
  const draft = clonePlainData(item) as SkillDraft;
  return draft;
}

export function SkillsFeature() {
  const { modal } = App.useApp();
  const revision = useSyncExternalStore(subscribeDomain, getDomainRevision);
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [open, setOpen] = useState<OpenSkill | null>(null);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<CatalogPage<SkillRecord>>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const editorEpoch = useRef(0);
  useEffect(() => () => { editorEpoch.current += 1; }, []);
  const latestRevision = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!cloudEnabled) return;
    let active = true;
    setBusy(true); setError(''); setResult(undefined);
    const timer = window.setTimeout(() => {
      void readCatalogPage<SkillRecord>('skills', new URLSearchParams({ search: query.trim(), offset: String((page - 1) * 20), limit: '20' }).toString(), refresh > 0)
        .then(value => { if (active) { setResult(value); latestRevision.current = value.revision; if (page > 1 && (page - 1) * 20 >= value.total) setPage(Math.max(1, Math.ceil(value.total / 20))); } })
        .catch(cause => { if (active) setError(message(cause)); })
        .finally(() => { if (active) setBusy(false); });
    }, query.trim() ? 200 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, page, refresh]);

  const skills = cloudEnabled ? result?.items || [] : readSkills();
  const items = useMemo(() => {
    if (cloudEnabled) return skills.filter(isUserSkill);
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
  }, [revision, query, result]);

  async function persist(upsert: SkillRecord[], remove: string[], expected = latestRevision.current) {
    if (!result) throw new Error(t('cloud.login.loading'));
    const saved = await patchCatalogItems('skills', expected, upsert, remove);
    latestRevision.current = saved.revision;
    setRefresh(value => value + 1);
    return saved;
  }

  const dirty = Boolean(open && JSON.stringify(open.draft) !== open.baseline);
  function confirmDiscard(action: () => void) {
    if (!dirty) {
      action();
      return;
    }
    modal.confirm({
      title: t("ui.SkillsFeature.text.b9acb156"),
      onOk: action,
    });
  }

  async function run(action: () => void | Promise<void>, success?: string) {
    try {
      await action();
      if (success) showToast(success, 'success');
    } catch (cause) {
      showErrorMessage(message(cause), t("ui.SkillsFeature.text.a4807a36"));
    }
  }

  function openSkill(id: string) {
    if (open?.draft.id === id) { editorEpoch.current += 1; return; }
    confirmDiscard(() => {
      const request = ++editorEpoch.current;
      const expected = latestRevision.current;
      void run(async () => {
        const item = cloudEnabled ? await readCatalogItem<SkillRecord>('skills', id) : readSkills().find(skill => skill.id === id);
        if (!item || request !== editorEpoch.current) return;
        const draft = toDraft(item);
        setOpen({ draft, isNew: false, baseline: JSON.stringify(draft), revision: expected });
      });
    });
  }

  function createSkill() {
    confirmDiscard(() => {
      editorEpoch.current += 1;
      const draft = createSkillDraft([CANVAS_AGENT_ID]) as SkillDraft;
      setOpen({ draft, isNew: true, baseline: JSON.stringify(draft), revision: latestRevision.current });
    });
  }

  async function importFiles(files: File[]) {
    let imported = 0;
    const errors: string[] = [];
    for (const file of files) {
      try {
        const payload = JSON.parse(await file.text());
        for (const item of transferItems(payload)) {
          try {
            if (cloudEnabled) await persist([normalizeSkill({ ...item, enabled: item.enabled !== false })], []);
            else await upsertSkill({ ...item, enabled: item.enabled !== false });
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
    const records = cloudEnabled ? await Promise.all([...ids].map(id => readCatalogItem<SkillRecord>('skills', id))) : readSkills().filter(item => ids.has(item.id));
    const skills = records
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
    setQuery: value => { setQuery(value); setPage(1); },
    setSelection: setSelectedIds,
    toggleSelection: (id) => setSelectedIds((current) => current.includes(id)
      ? current.filter((item) => item !== id)
      : [...current, id]),
    openSkill,
    createSkill,
    toggleSkill: (id) => void run(async () => {
      if (!cloudEnabled) return toggleSkill(id);
      const expected = latestRevision.current;
      const item = await readCatalogItem<SkillRecord>('skills', id);
      await persist([normalizeSkill({ ...item, enabled: item.enabled === false }, item)], [], expected);
    }),
    deleteSkill: (id) => void run(async () => {
      if (cloudEnabled) await persist([], [id]);
      else await deleteSkill(id);
      setOpen(current => {
        if (current?.draft.id !== id) return current;
        editorEpoch.current += 1;
        return null;
      });
      setSelectedIds((current) => current.filter((item) => item !== id));
    }, t("ui.SkillsFeature.text.34c29b69")),
    importFiles: (files) => void run(() => importFiles(files)),
    exportSelected: () => void run(exportSelected),
    patch: (value) => setOpen((current) => current
      ? { ...current, draft: { ...current.draft, ...value } }
      : current),
    save: (draft) => void run(async () => {
      const request = editorEpoch.current;
      const editing = open;
      if (cloudEnabled && open?.isNew) {
        const existing = await readCatalogItem<SkillRecord>('skills', draft.id).catch(cause => {
          if (cause.status !== 404) throw cause;
          return undefined;
        });
        if (existing) throw new Error(t("ui.SkillsFeature.text.bd56b279", { value0: draft.id }));
      }
      if (open?.isNew && readSkills().some((item) => item.id === draft.id)) {
        throw new Error(t("ui.SkillsFeature.text.bd56b279", { value0: draft.id }));
      }
      const saved = toDraft(cloudEnabled ? normalizeSkill(draft) : await upsertSkill(draft));
      const value = cloudEnabled ? await persist([saved as SkillRecord], [], open?.revision) : undefined;
      if (request !== editorEpoch.current) return;
      setOpen(current => current && current === editing
        ? { draft: saved, isNew: false, baseline: JSON.stringify(saved), revision: value?.revision }
        : current && current.draft.id === draft.id
          ? { ...current, isNew: false, baseline: JSON.stringify(saved), revision: value?.revision }
          : current);
    }, t("ui.SkillsFeature.text.e1f0b15b")),
    close: () => confirmDiscard(() => { editorEpoch.current += 1; setOpen(null); }),
  };

  const data: SkillsData = {
    items,
    query,
    selectedIds,
    editor: open && {
      draft: open.draft,
      isNew: open.isNew,
      dirty,
    },
    ...(cloudEnabled ? { page, total: result?.total || 0, busy, error, onPageChange: setPage, onRefresh: () => setRefresh(value => value + 1) } : {}),
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
