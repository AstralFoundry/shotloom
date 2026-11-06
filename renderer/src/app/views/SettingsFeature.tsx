import { LOCALE_STORAGE_KEY, normalizeLocale } from '@/i18n';
import { flushAutoSave, hasOpenProject } from '../../store/projectStore';
import { t } from '@/i18n';
import { useEffect, useMemo, useReducer } from "react";
import { getModelInfo } from "../../domain/catalog/ModelCatalog";
import { findProviderAdapter, getProviderAdapters } from "../../domain/provider/adapters";
import { getProviderModelRows } from "../../domain/provider/ModelAvailability";
import type { ProviderConfig } from "../../domain/provider/ProviderConfig";
import { resolveProviderIconId } from "../../domain/provider/ProviderBrandIcons.ts";
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
  store,
  touchProject,
} from "../../store/projectStore";
import {
  getAvailableModelIdsByType,
  saveAppSettings,
  settingsStore,
} from "../../store/settingsStore";
import {
  areCanvasActionShortcutsEqual,
  canvasActionShortcutLabel,
  createKeyboardCanvasActionShortcut,
  DEFAULT_CANVAS_ACTION_SHORTCUTS,
  normalizeCanvasActionShortcuts,
} from "../../utils/canvasActionShortcuts";
import { showToast, showErrorMessage } from "../../store/notificationStore";
import { confirmAction } from "../ui/confirm/confirmService";
import {
  exportDiagnosticsBundle,
  previewDiagnostics,
} from "../../services/diagnosticsService";
import {
  type SettingsController,
  type SettingsData,
  SettingsPanel,
} from "./SettingsPanel";

const message = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause || t("ui.SettingsFeature.text.09e424b5"));

export function SettingsFeature() {
  const [revision, refresh] = useReducer((value) => value + 1, 0);

  useEffect(() => {
    void loadDownloadDir().then(refresh).catch((cause) => showErrorMessage(message(cause), t("ui.SettingsFeature.text.f29f933e")));
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
      // 默认模型属于工程设置：必须走 touchProject 才会排队自动保存，
      // 只写 persistSession 会在重开项目后丢回旧值（并回落到硬编码默认模型）。
      touchProject();
      refresh();
    },
    exportDiagnostics: () =>
      run(async () => {
        const preview = previewDiagnostics();
        const kilobytes = Math.max(1, Math.ceil(preview.bytes / 1024));
        const confirmed = await confirmAction({
          title: [
            t('settings.diagnostics.confirm', { count: preview.eventCount, kb: kilobytes }),
            preview.truncated ? t('settings.diagnostics.truncated') : '',
          ].filter(Boolean).join('\n'),
          okText: t('settings.diagnostics.action'),
          cancelText: t('settings.diagnostics.cancel'),
        });
        if (!confirmed) return;
        const result = await exportDiagnosticsBundle();
        if (result.ok) {
          showToast(t('settings.diagnostics.done', { name: result.fileName || '' }), 'success');
        } else {
          showErrorMessage(t('settings.diagnostics.failed'), t('settings.diagnostics.failedTitle'));
        }
      }),
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
  };
  return <SettingsPanel data={data} controller={controller} />;
}
