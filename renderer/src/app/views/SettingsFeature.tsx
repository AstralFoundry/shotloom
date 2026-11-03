import { LOCALE_STORAGE_KEY, normalizeLocale } from '@/i18n';
import { flushAutoSave, hasOpenProject } from '../../store/projectStore';
import { t } from '@/i18n';
import { CANVAS_AGENT_ID } from "../../agent/agents/definitions.ts";
import { useEffect, useMemo, useReducer, useState } from "react";
import { getModelInfo } from "../../domain/catalog/ModelCatalog";
import { findProviderAdapter, getProviderAdapters } from "../../domain/provider/adapters";
import { getProviderModelRows } from "../../domain/provider/ModelAvailability";
import type { ProviderConfig } from "../../domain/provider/ProviderConfig";
import { resolveProviderIconId } from "../../domain/provider/ProviderBrandIcons.ts";
import { builtInSkillChanges } from "../../services/builtInSkills";
import { desktopApi } from "../../services/desktopApi";
import {
  clearDownloadDir,
  fileStore,
  loadDownloadDir,
  selectDownloadDir,
} from "../../store/fileStore";
import { toRaw } from "../../store/domainReactivity";
import {
  migrateProjectRoot,
  persistSession,
  store,
} from "../../store/projectStore";
import {
  getAvailableModelIdsByType,
  saveAppSettings,
  settingsStore,
} from "../../store/settingsStore";
import {
  createSkillDraft,
  deleteSkill,
  loadGlobalSkills,
  resetSkillToBuiltIn,
  skillsStore,
  toggleSkill,
  upsertSkill,
} from "../../store/skillsStore";
import {
  areCanvasActionShortcutsEqual,
  canvasActionShortcutLabel,
  createKeyboardCanvasActionShortcut,
  DEFAULT_CANVAS_ACTION_SHORTCUTS,
  normalizeCanvasActionShortcuts,
} from "../../utils/canvasActionShortcuts";
import { showToast, showErrorMessage } from "../../store/notificationStore";
import {
  type SkillDraft,
  SkillEditorDialog,
} from "./CatalogEditorDialogs";
import {
  type SettingsController,
  type SettingsData,
  SettingsPanel,
} from "./SettingsPanel";

type EditorState<T> = { value: T; isNew: boolean } | null;
/**
 * Domain stores expose nested values through lightweight proxies. Native
 * structuredClone rejects Proxy objects, so unwrap each level before copying.
 */
function clone<T>(value: T): T {
  const seen = new WeakMap<object, unknown>();
  const copy = (input: unknown): unknown => {
    if (input === null || typeof input !== "object") return input;
    const raw = toRaw(input);
    if (raw instanceof Date) return new Date(raw.getTime());
    const cached = seen.get(raw);
    if (cached) return cached;
    if (Array.isArray(raw)) {
      const result: unknown[] = [];
      seen.set(raw, result);
      raw.forEach((item) => result.push(copy(item)));
      return result;
    }
    const result: Record<string, unknown> = {};
    seen.set(raw, result);
    Object.entries(raw as Record<string, unknown>).forEach(([key, item]) => {
      if (typeof item !== "function") result[key] = copy(item);
    });
    return result;
  };
  return copy(value) as T;
}
const message = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause || t("ui.SettingsFeature.text.09e424b5"));
function transferItems(
  payload: unknown,
  pluralKey: string,
  singularKey: string,
): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record[pluralKey])) {
      return record[pluralKey] as Record<string, unknown>[];
    }
    if (record[singularKey] && typeof record[singularKey] === "object") {
      return [record[singularKey] as Record<string, unknown>];
    }
    return [record];
  }
  return [];
}
function transferCopy<T>(value: T): T {
  const copy = clone(value) as T & { updatedAt?: string };
  delete copy.updatedAt;
  return copy;
}

export function SettingsFeature() {
  const [revision, refresh] = useReducer((value) => value + 1, 0);
  const [skillEditor, setSkillEditor] = useState<EditorState<SkillDraft>>(null);

  useEffect(() => {
    void Promise.all([
      loadDownloadDir(),
      loadGlobalSkills(),
    ]).then(refresh).catch((cause) => showErrorMessage(message(cause), t("ui.SettingsFeature.text.f29f933e")));
  }, []);

  const data = useMemo<SettingsData>(() => {
    const availableModels = Object.fromEntries(
      [
        "textGeneration",
        "imageGeneration",
        "videoGeneration",
        "audioGeneration",
      ].map((
        type,
      ) => [
        type,
        getAvailableModelIdsByType(type).map((id: string) => {
          const providerId = String(getModelInfo(id)?.provider || "");
          return {
            id,
            label: getModelInfo(id)?.name || id,
            iconId: resolveProviderIconId(providerId, id, findProviderAdapter(providerId)?.iconId || ""),
          };
        }),
      ]),
    );
    const providers = getProviderAdapters().map((adapter) => {
      const config = settingsStore.providerConfigs[adapter.id];
      return {
        id: adapter.id,
        name: adapter.name,
        description: adapter.description,
        iconId: adapter.iconId,
        apiKey: config?.apiKey || "",
        baseUrl: config?.baseUrl || "",
        baseUrlRequired: adapter.baseUrlRequired === true,
        configured: Boolean(config?.apiKey?.trim()),
        models: getProviderModelRows(adapter.id),
      };
    });
    return {
      locale: settingsStore.locale,
      projectRootDir: settingsStore.projectRootDir || "",
      downloadDir: fileStore.downloadDir || "",
      pollInterval: settingsStore.modelPollIntervalMs,
      projectModels: { ...store.project.settings },
      agentModels: {
        agentPreferredTextModel: settingsStore.agentPreferredTextModel,
        agentPreferredImageModel: settingsStore.agentPreferredImageModel,
        agentPreferredVideoModel: settingsStore.agentPreferredVideoModel,
      },
      availableModels,
      agentToggles: {
        agentCanRunNodes: settingsStore.agentCanRunNodes,
        agentAutoEval: settingsStore.agentAutoEval,
        agentAutoLayout: settingsStore.agentAutoLayout,
      },
      providers,
      skills: clone(skillsStore.skills),
      shortcutLabels: {
        fitView: canvasActionShortcutLabel(
          settingsStore.canvasActionShortcuts.fitView,
        ),
        autoLayout: canvasActionShortcutLabel(
          settingsStore.canvasActionShortcuts.autoLayout,
        ),
      },
    };
  }, [revision]);

  async function run(action: () => void | Promise<void>, success?: string) {
    try {
      await action();
      refresh();
      if (success) showToast(success, 'success');
    } catch (cause) {
      showErrorMessage(message(cause), t("ui.SettingsFeature.text.f29f933e"));
    }
  }
  async function updateShortcut(
    action: "fitView" | "autoLayout",
    shortcut: Record<string, unknown>,
  ) {
    const other = action === "fitView" ? "autoLayout" : "fitView";
    const next = normalizeCanvasActionShortcuts(
      settingsStore.canvasActionShortcuts,
    );
    if (areCanvasActionShortcutsEqual(next[other], shortcut)) {
      return showToast(
        t("ui.SettingsFeature.text.02e7b947", { value0: other === "fitView" ? t("ui.BottomModeBar.label.a187522f") : t("ui.canvasAdapter.text.7ea05931") }),
      );
    }
    next[action] = shortcut;
    await saveAppSettings({ canvasActionShortcuts: next });
    refresh();
  }
  function recordShortcut(action: string) {
    if (action !== "fitView" && action !== "autoLayout") return;
    showToast(t("ui.SettingsFeature.text.5158a6ea"));
    const listener = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === "Escape") {
        return window.removeEventListener("keydown", listener, true);
      }
      const shortcut = createKeyboardCanvasActionShortcut(event);
      if (!shortcut) return;
      window.removeEventListener("keydown", listener, true);
      void updateShortcut(action, shortcut);
    };
    window.addEventListener("keydown", listener, true);
  }

  async function importCatalog(kind: "skills", files: File[]) {
    let imported = 0;
    const errors: string[] = [];
    for (const file of files) {
      try {
        const payload = JSON.parse(await file.text());
        for (const item of transferItems(payload, kind, "skill")) {
          try {
            await upsertSkill({ ...item, enabled: item.enabled !== false });
            imported += 1;
          } catch (cause) { errors.push(`${file.name}：${message(cause)}`); }
        }
      } catch (cause) { errors.push(`${file.name}：${message(cause)}`); }
    }
    refresh();
    showToast(imported
      ? t("ui.SettingsFeature.text.bac4c837", { value0: imported, value1: errors.length ? t("ui.SettingsFeature.text.c670f269", { value0: errors.length }) : "" })
      : errors[0] || t("ui.SettingsFeature.text.42663980"));
  }
  async function exportCatalog(_kind: "skills", ids: string[]) {
    const skills = skillsStore.skills.filter((item: { id: string }) => ids.includes(item.id)).map(transferCopy);
    if (await desktopApi.file.saveJson("shotloom-skills.json", {
      format: "shotloom.skill-catalog", formatVersion: 1,
      exportedAt: new Date().toISOString(), skills,
    })) showToast(t("ui.SettingsFeature.text.1469a6aa", { value0: skills.length }));
  }

  async function saveProviderConfig(id: string, patch: Partial<ProviderConfig>) {
    const current = settingsStore.providerConfigs[id];
    await saveAppSettings({
      providerConfigs: {
        ...toRaw(settingsStore.providerConfigs),
        [id]: { ...current, ...patch },
      },
    });
    refresh();
  }

  const controller: SettingsController = {
    setLocale: locale => run(async () => {
      // 先保存工程，再重载所有模块和独立 iframe，避免模块级菜单保留旧语言。
      if (hasOpenProject() && !await flushAutoSave()) return;
      const next = normalizeLocale(locale);
      await saveAppSettings({ locale: next });
      window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
      window.location.reload();
    }),
    selectProjectRoot: () =>
      run(async () => {
        const root = await desktopApi.project.selectRoot?.();
        if (root && root !== settingsStore.projectRootDir) {
          await migrateProjectRoot(root);
          await saveAppSettings({
            projectRootDir: settingsStore.projectRootDir,
          });
        }
      }),
    selectDownloadDir: () =>
      run(async () => {
        await selectDownloadDir();
      }),
    clearDownloadDir: () =>
      run(async () => {
        await clearDownloadDir();
      }),
    setPollInterval: (value) =>
      run(async () => {
        await saveAppSettings({ modelPollIntervalMs: Math.max(500, value) });
      }),
    setProjectModel: (key, value) => {
      store.project.settings[key] = value;
      persistSession();
      refresh();
    },
    setAgentModel: (key, value) =>
      run(async () => {
        await saveAppSettings({ [key]: value });
      }),
    setAgentToggle: (key, value) =>
      run(async () => {
        await saveAppSettings({ [key]: value });
      }),
    recordShortcut,
    resetShortcuts: () =>
      run(async () => {
        await saveAppSettings({
          canvasActionShortcuts: normalizeCanvasActionShortcuts(
            DEFAULT_CANVAS_ACTION_SHORTCUTS,
          ),
        });
      }, t("ui.SettingsFeature.text.4f41873b")),
    setProviderConfig: (id, patch) => run(async () => {
      await saveProviderConfig(id, patch);
    }),
    createSkill: () =>
      setSkillEditor({ value: createSkillDraft([CANVAS_AGENT_ID]) as SkillDraft, isNew: true }),
    editSkill: (id) => {
      const item = skillsStore.skills.find((skill: { id: string }) => skill.id === id);
      if (item) setSkillEditor({ value: clone(item), isNew: false });
    },
    deleteSkill: (id) => run(async () => { await deleteSkill(id); }, t("ui.SettingsFeature.text.34c29b69")),
    toggleSkill: (id) => run(async () => { await toggleSkill(id); }),
    resetSkill: (id) => run(async () => {
      await resetSkillToBuiltIn(id);
    }, t("ui.SettingsFeature.text.c5ee08da")),
    importCatalog,
    exportCatalog,
  };

  const overlays = (
    <>
      {skillEditor && (
        <SkillEditorDialog
          skill={skillEditor.value}
          isNew={skillEditor.isNew}
          modifiedFields={builtInSkillChanges(skillEditor.value)}
          onClose={() => setSkillEditor(null)}
          onSave={(value) => void run(async () => {
            if (skillEditor.isNew && skillsStore.skills.some((item: { id: string }) => item.id === value.id)) {
              throw new Error(t("ui.SettingsFeature.text.bd56b279", { value0: value.id }));
            }
            await upsertSkill(value);
            setSkillEditor(null);
          }, t("ui.SettingsFeature.text.e1f0b15b"))}
          onReset={() => void run(async () => {
            if (!window.confirm(t("ui.SettingsFeature.text.79325288", { value0: skillEditor.value.name }))) return;
            await resetSkillToBuiltIn(skillEditor.value.id);
            const value = skillsStore.skills.find((item: { id: string }) => item.id === skillEditor.value.id);
            if (value) setSkillEditor({ value: clone(value), isNew: false });
          }, t("ui.SettingsFeature.text.c5ee08da"))}
        />
      )}
    </>
  );
  return (
    <SettingsPanel data={data} controller={controller} overlays={overlays} />
  );
}
