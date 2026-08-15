import { useEffect, useMemo, useReducer, useState } from "react";
import {
  getBuiltInAdapterTemplates,
  getModelInfo,
} from "../../domain/catalog/ModelCatalog";
import {
  parseProtocolAdapterPackage,
  type ProviderProtocolAdapter,
} from "../../domain/provider/ProviderAdapterContract";
import { buildCustomCatalogModels } from "../../domain/provider/CustomModelCatalog";
import {
  getConfiguredProviders,
  getProviderDefinitions,
  getProviderDefinition,
  type ProviderConfig,
} from "../../domain/provider/ProviderRegistry";
import { resolveProviderIconId } from "../../domain/provider/ProviderBrandIcons.js";
import { builtInRecipeChanges } from "../../services/builtInRecipes";
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
  createRecipeDraft,
  deleteRecipe,
  loadGlobalRecipes,
  recipesStore,
  resetRecipeToBuiltIn,
  toggleRecipe,
  upsertRecipe,
} from "../../store/recipesStore";
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
import { showToast } from "../store/overlayStore";
import { modelTypeLabel } from "../../utils/modelPresentation.js";
import {
  type RecipeDraft,
  RecipeEditorDialog,
  type SkillDraft,
  SkillEditorDialog,
} from "./CatalogEditorDialogs";
import {
  ProviderConnectionDialog,
  type ProviderConnectionResult,
} from "./ProviderConnectionDialog";
import { ModelProtocolGuideDialog } from "./ModelProtocolGuideDialog";
import { ProtocolAdapterDialog } from "./ProtocolAdapterDialog";
import {
  type SettingsController,
  type SettingsData,
  SettingsPanel,
} from "./SettingsPanel";

type EditorState<T> = { value: T; isNew: boolean } | null;
type ProtocolEditorState = {
  value: ProviderProtocolAdapter | null;
  originalId: string;
} | null;
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
  cause instanceof Error ? cause.message : String(cause || "操作失败");
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
  const [providerEditor, setProviderEditor] = useState<string | null>(null);
  const [providerSaving, setProviderSaving] = useState(false);
  const [providerError, setProviderError] = useState("");
  const [protocolEditor, setProtocolEditor] =
    useState<ProtocolEditorState>(null);
  const [protocolGuideOpen, setProtocolGuideOpen] = useState(false);
  const [skillEditor, setSkillEditor] = useState<EditorState<SkillDraft>>(null);
  const [recipeEditor, setRecipeEditor] =
    useState<EditorState<RecipeDraft>>(null);

  useEffect(() => {
    void Promise.all([
      loadDownloadDir(),
      loadGlobalSkills(),
      loadGlobalRecipes(),
    ])
      .then(refresh)
      .catch((cause) => showToast(message(cause)));
  }, []);

  const data = useMemo<SettingsData>(() => {
    const availableModels = Object.fromEntries(
      [
        "textGeneration",
        "imageGeneration",
        "videoGeneration",
        "audioGeneration",
      ].map((type) => [
        type,
        getAvailableModelIdsByType(type).map((id: string) => {
          const providerId = String(getModelInfo(id)?.provider || "");
          const configuredIcon =
            settingsStore.providerConfigs?.[providerId]?.iconId ||
            getProviderDefinition(providerId)?.iconId ||
            "";
          return {
            id,
            label: getModelInfo(id)?.name || id,
            iconId: resolveProviderIconId(providerId, id, configuredIcon),
          };
        }),
      ]),
    );
    const providers = getConfiguredProviders(settingsStore.providerConfigs).map(
      ({ id, definition, config }) => ({
        id,
        iconId: config.iconId || definition.iconId,
        displayName: config.displayName || definition.name,
        summaryUrl: (config.baseUrl || definition.defaultBaseUrl || "")
          .replace(/^https?:\/\//, "")
          .replace(/\/+$/, ""),
        modelCount: getAvailableModelIdsByType("textGeneration")
          .concat(
            getAvailableModelIdsByType("imageGeneration"),
            getAvailableModelIdsByType("videoGeneration"),
            getAvailableModelIdsByType("audioGeneration"),
          )
          .filter((modelId: string) => getModelInfo(modelId)?.provider === id)
          .length,
      }),
    );
    const builtInProtocols = getBuiltInAdapterTemplates().map(
      ({ providerId, adapter }) => ({
        id: adapter.id,
        name: adapter.name,
        typeLabel: modelTypeLabel(adapter.type),
        modeCount: adapter.modes.length,
        builtIn: true,
        providerLabel: getProviderDefinition(providerId)?.name || providerId,
      }),
    );
    const customProtocols = settingsStore.protocolAdapters.map(
      (adapter: ProviderProtocolAdapter) => ({
        id: adapter.id,
        name: adapter.name,
        typeLabel: modelTypeLabel(adapter.type),
        modeCount: adapter.modes.length,
        builtIn: false,
        providerLabel: "自定义协议",
      }),
    );
    return {
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
      protocols: [...customProtocols, ...builtInProtocols],
      skills: clone(skillsStore.skills),
      recipes: clone(recipesStore.recipes),
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
      if (success) showToast(success);
    } catch (cause) {
      showToast(message(cause));
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
        `这个键位已用于“${other === "fitView" ? "适应视窗" : "自动整理"}”`,
      );
    }
    next[action] = shortcut;
    await saveAppSettings({ canvasActionShortcuts: next });
    refresh();
  }
  function recordShortcut(action: string) {
    if (action !== "fitView" && action !== "autoLayout") return;
    showToast("请按下新的快捷键，Esc 取消");
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

  async function importCatalog(kind: "skills" | "recipes", files: File[]) {
    let imported = 0;
    let dependencies = 0;
    const errors: string[] = [];
    for (const file of files) {
      try {
        const payload = JSON.parse(await file.text());
        if (kind === "skills") {
          for (const recipe of transferItems(
            (payload as Record<string, unknown>)?.recipes || [],
            "recipes",
            "recipe",
          )) {
            try {
              await upsertRecipe({
                ...recipe,
                enabled: recipe.enabled !== false,
              });
              dependencies += 1;
            } catch (cause) {
              errors.push(`${file.name} / 策略：${message(cause)}`);
            }
          }
        }
        for (const item of transferItems(
          payload,
          kind,
          kind === "skills" ? "skill" : "recipe",
        )) {
          try {
            if (kind === "skills") {
              await upsertSkill({ ...item, enabled: item.enabled !== false });
            } else {
              await upsertRecipe({
                ...item,
                enabled: item.enabled !== false,
              });
            }
            imported += 1;
          } catch (cause) {
            errors.push(`${file.name}：${message(cause)}`);
          }
        }
      } catch (cause) {
        errors.push(`${file.name}：${message(cause)}`);
      }
    }
    refresh();
    showToast(
      imported
        ? `已导入 ${imported} 个${kind === "skills" ? "技能" : "策略"}${
            dependencies ? `，同时导入 ${dependencies} 个关联策略` : ""
          }${errors.length ? `；${errors.length} 项未导入` : ""}`
        : errors[0] || "没有可导入的内容",
    );
  }
  async function exportCatalog(kind: "skills" | "recipes", ids: string[]) {
    if (kind === "skills") {
      const skills = skillsStore.skills
        .filter((item: { id: string }) => ids.includes(item.id))
        .map(transferCopy);
      const recipeIds = new Set(
        skills.flatMap(
          (item: { recipeIds?: string[] }) => item.recipeIds || [],
        ),
      );
      const recipes = recipesStore.recipes
        .filter((item: { id: string }) => recipeIds.has(item.id))
        .map(transferCopy);
      if (
        await desktopApi.file.saveJson("shotloom-skills.json", {
          format: "shotloom.skill-catalog",
          formatVersion: 1,
          exportedAt: new Date().toISOString(),
          skills,
          recipes,
        })
      ) {
        showToast(
          `已导出 ${skills.length} 个技能，并携带 ${recipes.length} 个关联策略`,
        );
      }
    } else {
      const recipes = recipesStore.recipes
        .filter((item: { id: string }) => ids.includes(item.id))
        .map(transferCopy);
      if (
        await desktopApi.file.saveJson("shotloom-recipes.json", {
          format: "shotloom.recipe-catalog",
          formatVersion: 1,
          exportedAt: new Date().toISOString(),
          recipes,
        })
      )
        showToast(`已导出 ${recipes.length} 个策略`);
    }
  }

  async function saveProvider(result: ProviderConnectionResult) {
    const previous = { ...settingsStore.providerConfigs };
    setProviderSaving(true);
    setProviderError("");
    try {
      await saveAppSettings({
        providerConfigs: { ...previous, [result.providerId]: result.config },
      });
      setProviderEditor(null);
      refresh();
      showToast("API 厂商配置已保存");
    } catch (cause) {
      settingsStore.providerConfigs = previous;
      setProviderError(message(cause));
    } finally {
      setProviderSaving(false);
    }
  }

  async function saveProtocol(adapter: ProviderProtocolAdapter) {
    const originalId = protocolEditor?.originalId || "";
    const builtInIds = new Set(
      getBuiltInAdapterTemplates().map((item) => item.adapter.id),
    );
    if (builtInIds.has(adapter.id)) {
      throw new Error(
        `协议 ID “${adapter.id}” 属于内置协议，请使用新的自定义 ID`,
      );
    }
    const current = clone(
      settingsStore.protocolAdapters,
    ) as ProviderProtocolAdapter[];
    const next = originalId
      ? current.map((item) => (item.id === originalId ? adapter : item))
      : [...current, adapter];
    const providerConfigs = clone(settingsStore.providerConfigs) as Record<
      string,
      ProviderConfig
    >;
    if (originalId && originalId !== adapter.id) {
      Object.values(providerConfigs).forEach((config: ProviderConfig) => {
        config.modelBindings = (config.modelBindings || []).map((binding) =>
          binding.adapterId === originalId
            ? { ...binding, adapterId: adapter.id }
            : binding,
        );
      });
    }
    buildCustomCatalogModels(providerConfigs, next);
    await saveAppSettings({ protocolAdapters: next, providerConfigs });
    setProtocolEditor(null);
    refresh();
    showToast("协议已保存");
  }

  async function importProtocols(files: File[]) {
    const builtInIds = new Set(
      getBuiltInAdapterTemplates().map((item) => item.adapter.id),
    );
    const current = clone(
      settingsStore.protocolAdapters,
    ) as ProviderProtocolAdapter[];
    const knownIds = new Set(current.map((adapter) => adapter.id));
    const imported: ProviderProtocolAdapter[] = [];
    for (const file of files) {
      const adapters = parseProtocolAdapterPackage(
        JSON.parse(await file.text()),
      );
      for (const adapter of adapters) {
        if (builtInIds.has(adapter.id) || knownIds.has(adapter.id)) {
          throw new Error(`${file.name}：协议 ID “${adapter.id}” 已存在`);
        }
        knownIds.add(adapter.id);
        imported.push(adapter);
      }
    }
    await saveAppSettings({ protocolAdapters: [...current, ...imported] });
    refresh();
    showToast(`已导入 ${imported.length} 个协议`);
  }

  const controller: SettingsController = {
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
      }, "画布快捷键已恢复默认"),
    addProvider: () => {
      setProviderError("");
      setProviderEditor("");
    },
    editProvider: (id) => {
      setProviderError("");
      setProviderEditor(id);
    },
    deleteProvider: (id) =>
      run(async () => {
        if (!window.confirm("确定删除这个 API 厂商连接吗？")) return;
        const next = { ...settingsStore.providerConfigs };
        delete next[id];
        await saveAppSettings({ providerConfigs: next });
      }, "API 厂商已删除"),
    createProtocol: () => {
      setProtocolEditor({ value: null, originalId: "" });
    },
    editProtocol: (id) => {
      const adapter = settingsStore.protocolAdapters.find(
        (item: ProviderProtocolAdapter) => item.id === id,
      );
      if (adapter) {
        setProtocolEditor({ value: clone(adapter), originalId: adapter.id });
      }
    },
    copyProtocol: (id) => {
      const source = getBuiltInAdapterTemplates().find(
        (item) => item.adapter.id === id,
      )?.adapter;
      if (!source) return;
      const occupied = new Set([
        ...getBuiltInAdapterTemplates().map((item) => item.adapter.id),
        ...settingsStore.protocolAdapters.map(
          (item: ProviderProtocolAdapter) => item.id,
        ),
      ]);
      const baseId = `${id}-custom`;
      let copyId = baseId;
      let suffix = 2;
      while (occupied.has(copyId)) copyId = `${baseId}-${suffix++}`;
      setProtocolEditor({
        value: {
          ...clone(source),
          id: copyId,
          name: `${source.name}（自定义）`,
        },
        originalId: "",
      });
    },
    deleteProtocol: (id) =>
      run(async () => {
        const providerConfigs = settingsStore.providerConfigs as Record<
          string,
          ProviderConfig
        >;
        const users = Object.entries(providerConfigs).flatMap(
          ([providerId, config]) =>
            (config.modelBindings || [])
              .filter((binding) => binding.adapterId === id)
              .map((binding) => `${providerId}/${binding.id}`),
        );
        if (users.length) {
          throw new Error(`协议仍被模型使用：${users.join("、")}`);
        }
        if (!window.confirm("确定删除这个全局协议吗？")) return;
        await saveAppSettings({
          protocolAdapters: settingsStore.protocolAdapters.filter(
            (adapter: ProviderProtocolAdapter) => adapter.id !== id,
          ),
        });
      }, "协议已删除"),
    importProtocols: (files) => run(() => importProtocols(files)),
    openProtocolGuide: () => setProtocolGuideOpen(true),
    createSkill: () =>
      setSkillEditor({ value: createSkillDraft() as SkillDraft, isNew: true }),
    editSkill: (id) => {
      const item = skillsStore.skills.find(
        (skill: { id: string }) => skill.id === id,
      );
      if (item) setSkillEditor({ value: clone(item), isNew: false });
    },
    deleteSkill: (id) =>
      run(async () => {
        await deleteSkill(id);
      }, "技能已删除"),
    toggleSkill: (id) =>
      run(async () => {
        await toggleSkill(id);
      }),
    createRecipe: () =>
      setRecipeEditor({
        value: createRecipeDraft() as RecipeDraft,
        isNew: true,
      }),
    editRecipe: (id) => {
      const item = recipesStore.recipes.find(
        (recipe: { id: string }) => recipe.id === id,
      );
      if (item) setRecipeEditor({ value: clone(item), isNew: false });
    },
    deleteRecipe: (id) =>
      run(async () => {
        await deleteRecipe(id);
      }, "策略已删除"),
    toggleRecipe: (id) =>
      run(async () => {
        await toggleRecipe(id);
      }),
    importCatalog,
    exportCatalog,
  };

  const providerConfig = providerEditor
    ? (settingsStore.providerConfigs[providerEditor] as ProviderConfig)
    : null;
  const overlays = (
    <>
      {providerEditor !== null && (
        <ProviderConnectionDialog
          editingId={providerEditor}
          initialConfig={providerConfig}
          connectedIds={getConfiguredProviders(
            settingsStore.providerConfigs,
          ).map(({ id }) => id)}
          protocolAdapters={clone(settingsStore.protocolAdapters)}
          submitting={providerSaving}
          submitError={providerError}
          onClose={() => !providerSaving && setProviderEditor(null)}
          onSave={saveProvider}
        />
      )}
      {protocolEditor && (
        <ProtocolAdapterDialog
          adapter={protocolEditor.value}
          existingIds={[
            ...getBuiltInAdapterTemplates().map((item) => item.adapter.id),
            ...settingsStore.protocolAdapters.map(
              (item: ProviderProtocolAdapter) => item.id,
            ),
          ]}
          onClose={() => setProtocolEditor(null)}
          onSave={saveProtocol}
        />
      )}
      {protocolGuideOpen && (
        <ModelProtocolGuideDialog onClose={() => setProtocolGuideOpen(false)} />
      )}
      {skillEditor && (
        <SkillEditorDialog
          skill={skillEditor.value}
          isNew={skillEditor.isNew}
          recipes={clone(recipesStore.recipes)}
          modifiedFields={builtInSkillChanges(skillEditor.value)}
          onClose={() => setSkillEditor(null)}
          onSave={(value) =>
            void run(async () => {
              if (
                skillEditor.isNew &&
                skillsStore.skills.some(
                  (item: { id: string }) => item.id === value.id,
                )
              )
                throw new Error(`技能 ID 已存在：${value.id}`);
              await upsertSkill(value);
              setSkillEditor(null);
            }, "技能已保存")
          }
          onReset={() =>
            void run(async () => {
              if (
                !window.confirm(
                  `恢复“${skillEditor.value.name}”的内置默认内容？`,
                )
              )
                return;
              await resetSkillToBuiltIn(skillEditor.value.id);
              const value = skillsStore.skills.find(
                (item: { id: string }) => item.id === skillEditor.value.id,
              );
              if (value) setSkillEditor({ value: clone(value), isNew: false });
            }, "技能已恢复默认")
          }
        />
      )}
      {recipeEditor && (
        <RecipeEditorDialog
          recipe={recipeEditor.value}
          isNew={recipeEditor.isNew}
          modifiedFields={builtInRecipeChanges(recipeEditor.value)}
          onClose={() => setRecipeEditor(null)}
          onSave={(value) =>
            void run(async () => {
              if (
                recipeEditor.isNew &&
                recipesStore.recipes.some(
                  (item: { id: string }) => item.id === value.id,
                )
              )
                throw new Error(`策略 ID 已存在：${value.id}`);
              await upsertRecipe(value);
              setRecipeEditor(null);
            }, "策略已保存")
          }
          onReset={() =>
            void run(async () => {
              if (
                !window.confirm(
                  `恢复“${recipeEditor.value.name}”的内置默认内容？`,
                )
              )
                return;
              await resetRecipeToBuiltIn(recipeEditor.value.id);
              const value = recipesStore.recipes.find(
                (item: { id: string }) => item.id === recipeEditor.value.id,
              );
              if (value) setRecipeEditor({ value: clone(value), isNew: false });
            }, "策略已恢复默认")
          }
        />
      )}
    </>
  );
  return (
    <SettingsPanel data={data} controller={controller} overlays={overlays} />
  );
}
