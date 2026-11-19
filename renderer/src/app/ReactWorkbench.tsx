import { getLocale, LOCALE_STORAGE_KEY } from '@/i18n';
import { t } from '@/i18n';
import { editorLocalMedia } from "./editor/editorLocalMedia";
import type { VideoEditorIntent } from "./editor/openReel/types";
import { Modal } from "antd";
import { ConfirmHost } from "./ui/confirm/ConfirmHost";
import { useEffect, useReducer, useState, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { registerWindowCloseGuard } from "./windowCloseGuard";
import { desktopApi } from "../services/desktopApi.ts";
import {
  flushAutoSave,
  hasOpenProject,
  initProjectCloneProgressListener,
  loadBoundWindowProject,
  loadRecentProjects,
  navigateToRoute,
  store,
  touchProject,
} from "../store/projectStore.ts";
import { loadAppSettings, refreshCloudAccountSettings, settingsStore } from "../store/settingsStore.ts";
import { loadGlobalRecipes } from "../store/recipesStore.ts";
import { loadGlobalSkills } from "../store/skillsStore.ts";
import { resumeRemoteTasks } from "../store/taskStore.ts";
import {
  getDomainRevision,
  subscribeDomain,
} from "../store/domainReactivity.ts";
import { canvasActionShortcutLabel } from "../utils/canvasActionShortcuts.ts";
import { APPLICATION_ROUTES } from "../utils/projectNavigation.ts";
import { cloudEnabled } from '../utils/cloudConfig';
import { AppShell } from "./AppShell";
import {
  canvasCommands,
  canvasController,
  canvasViewData,
  focusCanvasNodes,
  nodeActions,
} from "./adapters/canvasAdapter";
import {
  createVideoExportNode,
  openWorkspaceVideoEditor,
  registerVideoEditorOpener,
  saveWorkspaceVideoEditorNode,
  WORKSPACE_VIDEO_EDITOR_ID,
  workspaceVideoEditorNode,
} from "./adapters/canvas/videoEditorActions";
import {
  projectLibraryController,
  projectLibraryData,
} from "./adapters/projectLibraryAdapter";
import {
  assetsController,
  initializeResourceLibraries,
  materialsController,
  resourceLibraryData,
} from "./adapters/resourceLibraryAdapter";
import { taskController, taskViewData } from "./adapters/taskAdapter";
import {
  updateDialogController,
  updateDialogData,
} from "./adapters/updateAdapter";
import { MediaViewer } from "./components/MediaViewer";
import { ToastHost } from "./components/ToastHost";
import { ProjectSearch } from "./components/ProjectSearch";
import { UpdateDialog } from "./components/UpdateDialog";
import { CanvasStartup } from "./canvas/CanvasStartup";
import { CreationView } from "./views/CreationView";
import { AssetsView } from "./views/AssetsView";
import { MaterialsView } from "./views/MaterialsView";
import { ProjectsView } from "./views/ProjectsView";
import { SettingsFeature } from "./views/SettingsFeature";
import { AccountView } from './views/AccountView';
import { SkillsFeature } from "./views/SkillsFeature";
import { TasksView } from "./views/TasksView";
import { showToast, showErrorMessage } from "../store/notificationStore";
import { registerVideoEditorLauncher } from '../services/videoEditorSession';
import { startHarnessIntegration } from "./agent-session/harnessIntegration";
import { useDirectorWorkspaceStore } from "./store/directorWorkspaceStore";
import { type AppRoute, useAppStore } from "./store/appStore";
import { installMediaPreviewCacheMemoryPressureListener } from "../services/mediaPreviewCache";
import { installAgentE2eHook } from "./agent-session/agentE2eHook";
import { recordDiagnosticEvent } from "../services/diagnosticsService";
import { registerDirectorDeskNavigator } from "../services/directorDeskAgentRuntime";

/**
 * React 主工作台根；领域状态通过框架无关订阅同步到视图。
 */
export function ReactWorkbench() {
  const [, refresh] = useReducer((value) => value + 1, 0);
  const [settingsOpen, setSettingsOpen] = useState(cloudEnabled && new URLSearchParams(location.search).get('panel') === 'settings');
  const [navigationStatus, setNavigationStatus] = useState<'loading' | 'ready' | 'error'>(cloudEnabled ? 'loading' : 'ready');
  const [searchOpen, setSearchOpen] = useState(false);
  const [editorNodeId, setEditorNodeId] = useState("");
  const [editorExpanded, setEditorExpanded] = useState(true);
  const [editorIntent, setEditorIntent] = useState<
    VideoEditorIntent | undefined
  >();
  const openingProjectPath = useAppStore(state => state.openingProjectPath);
  const appRoute = useAppStore((state) => state.route);
  const currentProjectId = useAppStore((state) => state.currentProject?.id);
  const currentProjectDir = useAppStore((state) => state.currentProject?.projectDir);
  const directorWorkspaceOpen = useDirectorWorkspaceStore((state) => state.open);
  const setDirectorWorkspaceOpen = useDirectorWorkspaceStore((state) => state.setOpen);
  useEffect(() => {
    if (new URLSearchParams(location.search).get('native') !== 'embedded') return;
    if (navigationStatus === 'error') window.ReactNativeWebView?.postMessage(JSON.stringify({ type: 'workspace-blocked' }));
    if (navigationStatus !== 'ready') return;
    const ready = () => {
      if (appRoute === 'creation' && !document.querySelector('.react-flow__viewport')) return;
      performance.mark('shotloom-workspace-ready');
      window.ReactNativeWebView?.postMessage(JSON.stringify({ type: 'workspace-ready' }));
      observer.disconnect();
    };
    const observer = new MutationObserver(ready);
    observer.observe(document.body, { childList: true, subtree: true });
    ready();
    return () => observer.disconnect();
  }, [navigationStatus, appRoute]);
  useEffect(() => {
    if (new URLSearchParams(location.search).get('native') !== 'embedded') return;
    const refreshSettings = () => {
      void loadAppSettings().then(async () => {
        if (settingsStore.accountSyncError) showToast(settingsStore.accountSyncError);
        if (settingsStore.locale !== getLocale()) {
          if (hasOpenProject() && !await flushAutoSave()) return;
          window.localStorage.setItem(LOCALE_STORAGE_KEY, settingsStore.locale);
          window.location.reload();
        }
      }).catch(cause => showErrorMessage(String(cause)));
    };
    window.addEventListener('shotloom-native-settings-changed', refreshSettings);
    return () => window.removeEventListener('shotloom-native-settings-changed', refreshSettings);
  }, []);
  useEffect(() => {
    if (currentProjectId) useDirectorWorkspaceStore.getState().restoreForProject(currentProjectId);
  }, [currentProjectId]);
  const domainRevision = useSyncExternalStore(
    subscribeDomain,
    getDomainRevision,
    getDomainRevision,
  );
  useEffect(() => registerDirectorDeskNavigator(view => {
    if (!useAppStore.getState().setRoute('creation')) return false;
    useDirectorWorkspaceStore.getState().setOpen(view === 'director');
    return true;
  }), []);
  useEffect(() => {
    function onSearchKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener("keydown", onSearchKey);
    return () => window.removeEventListener("keydown", onSearchKey);
  }, []);

  useEffect(() => {
    let taskTimer = 0;
    let disposeClose: undefined | (() => void);
    const disposeAgentE2eHook = installAgentE2eHook();
    let disposeMemoryPressure: undefined | (() => void);
    let disposeMediaCachePressure: undefined | (() => void);
    let cancelled = false;
    const requestedRoute = cloudEnabled ? new URLSearchParams(location.search).get('route') : null;
    void (async () => {
      recordDiagnosticEvent({
        category: 'runtime',
        name: 'app-start',
        data: { platform: desktopApi.platform, desktop: desktopApi.platform !== "browser" },
      });
      if (desktopApi.platform !== "browser") {
        void startHarnessIntegration().catch(error => showToast(String(error)));
      }
      const embeddedProject = cloudEnabled && new URLSearchParams(location.search).get('native') === 'embedded' && new URLSearchParams(location.search).has('project');
      if (embeddedProject) performance.mark('shotloom-preferences-start');
      const preferencesReady = loadAppSettings(embeddedProject ? { preferencesOnly: true } : undefined);
      if (embeddedProject) performance.mark('shotloom-project-start');
      const boundProject = embeddedProject ? loadBoundWindowProject(async () => {
        await preferencesReady;
        return !cancelled && settingsStore.locale === getLocale();
      }) : undefined;
      // Observe early read failures while settings load; the result is awaited below.
      void boundProject?.catch(() => {});
      await preferencesReady;
      if (embeddedProject) performance.mark('shotloom-preferences-ready');
      if (settingsStore.accountSyncError) showToast(settingsStore.accountSyncError);
      if (settingsStore.locale !== getLocale()) {
        window.localStorage.setItem(LOCALE_STORAGE_KEY, settingsStore.locale);
        window.location.reload();
        return;
      }
      document.documentElement.lang = settingsStore.locale;
      if (embeddedProject) {
        if (!await boundProject && !cancelled) await loadRecentProjects();
        performance.mark('shotloom-project-ready');
      } else {
        await Promise.all([loadGlobalSkills(), loadGlobalRecipes(), loadRecentProjects(), initializeResourceLibraries()]);
        await loadBoundWindowProject();
      }
      if (cancelled) return;
      if (requestedRoute) navigateToRoute(requestedRoute, { notify: false });
      setNavigationStatus('ready');
      if (embeddedProject) {
        void Promise.all([loadGlobalSkills(), loadGlobalRecipes(), refreshCloudAccountSettings()]).then(() => {
          if (!cancelled && settingsStore.accountSyncError) showToast(settingsStore.accountSyncError);
        }).catch(cause => { if (!cancelled) showErrorMessage(String(cause)); });
      }
      if (desktopApi.platform !== "browser") {
        const recovery = await invoke<any>("recovery_status").catch(() => null);
        const previous = recovery?.previousUnclean;
        if (previous) {
          const memoryHint =
            Number(previous.availableMemoryKb || 0) > 0
              ? t("ui.ReactWorkbench.text.fe5e706d", { value0: Math.round(Number(previous.availableMemoryKb) / 1024) })
              : "";
          showToast(
            t("ui.ReactWorkbench.text.5b2c49d9", { value0: memoryHint }),
          );
        }
      }
      resumeRemoteTasks();
      taskTimer = window.setInterval(() => resumeRemoteTasks(), 5000);
      disposeMediaCachePressure =
        installMediaPreviewCacheMemoryPressureListener();
      initProjectCloneProgressListener?.();
      disposeClose = registerWindowCloseGuard();
      if (desktopApi.platform !== "browser") {
        disposeMemoryPressure = await listen<any>(
          "system-memory-pressure",
          ({ payload }) => {
            window.dispatchEvent(
              new CustomEvent("shotloom-memory-pressure", { detail: payload }),
            );
            showToast(
              t("ui.ReactWorkbench.text.a8df2953"),
            );
          },
        );
      }
      refresh();
    })().catch((cause) => {
      if (cancelled) return;
      setNavigationStatus('error');
      showErrorMessage(cause instanceof Error ? cause.message : t("ui.ReactWorkbench.text.3e91af51"), t("ui.ReactWorkbench.text.ef92d657"));
    });
    const disposeEditorLauncher = registerVideoEditorLauncher(id => {
      if (id === WORKSPACE_VIDEO_EDITOR_ID) openWorkspaceVideoEditor();
      else {
        useAppStore.getState().setRoute('creation');
        focusCanvasNodes([id]);
      }
    });
    registerVideoEditorOpener((id, expanded, intent) => {
      setEditorNodeId(id);
      setEditorExpanded(expanded);
      if (intent) setEditorIntent(intent);
    });
    return () => {
      cancelled = true;
      disposeAgentE2eHook();
      registerVideoEditorOpener(null);
      disposeEditorLauncher();
      if (taskTimer) window.clearInterval(taskTimer);
      disposeClose?.();
      disposeMemoryPressure?.();
      disposeMediaCachePressure?.();
    };
  }, []);

  useEffect(() => {
    const opened = hasOpenProject();
    useAppStore.getState().setCurrentProject(
      opened
        ? {
            id: String(store.project.id),
            name: store.project.name,
            filePath: store.filePath,
            projectDir: store.projectDir,
            nodeCount: store.project.nodes.length,
            edgeCount: store.project.edges.length,
          }
        : null,
    );
    navigateToRoute(store.route, { notify: false });
    const route = store.route as AppRoute;
    if (
      APPLICATION_ROUTES.has(route) &&
      useAppStore.getState().route !== route
    ) {
      useAppStore.setState({ route });
    }
  }, [domainRevision]);

  useEffect(() => {
    if (store.route !== appRoute) {
      navigateToRoute(appRoute);
      refresh();
    }
  }, [appRoute]);

  useEffect(() => {
    if (!cloudEnabled || navigationStatus === 'loading' || (navigationStatus === 'error' && !currentProjectId)) return;
    const url = new URL(location.href);
    url.searchParams.set('route', appRoute);
    if (currentProjectId && currentProjectDir) url.searchParams.set('project', currentProjectDir);
    else url.searchParams.delete('project');
    window.history.replaceState(window.history.state, '', url);
  }, [navigationStatus, appRoute, currentProjectId, currentProjectDir]);

  const projects = appRoute === "projects" ? projectLibraryData() : null;
  const resources = ["assets", "materials"].includes(appRoute)
    ? resourceLibraryData()
    : null;
  const canvas = appRoute === "creation" ? canvasViewData() : null;
  const update = updateDialogData();
  const isWorkspaceEditor = editorNodeId === WORKSPACE_VIDEO_EDITOR_ID;
  const editorNode: any = isWorkspaceEditor ? workspaceVideoEditorNode() : null;
  // 工作台剪辑会话不落画布节点，改动必须写回项目级槽位才能保存。
  const commitEditorNode = () => {
    if (isWorkspaceEditor) saveWorkspaceVideoEditorNode(editorNode);
  };
  const editor = editorNode
    ? {
        nodeId: editorNode.id,
        sessionKey: `${store.project.id}:${store.projectDir || ""}:${editorNode.id}`,
        expanded: editorExpanded,
        ...(editorIntent ? { intent: editorIntent } : {}),
        title: editorNode.title || t("ui.ReactWorkbench.text.3d65ff77"),
        project: editorNode.videoEditProject,
      }
    : undefined;
  const editorController = editorNode
    ? {
        persist(project: Record<string, unknown>) {
          editorNode.videoEditProject = project;
          editorNode.videoEdit = {
            ...(editorNode.videoEdit || {}),
            dirty: true,
          };
          commitEditorNode();
          touchProject({ sessionDelay: 300, coalesceSession: true });
          refresh();
        },
        async export(project: Record<string, unknown>) {
          const safeName = String(editorNode.title || "video").replace(
            /[\\/:*?"<>|]/g,
            "-",
          );
          const result = await desktopApi.file.renderVideoProjectToCanvas(
            project,
            t("ui.ReactWorkbench.text.7d1d4e69", { value0: safeName }),
          );
          createVideoExportNode(editorNode, result, t("ui.ReactWorkbench.text.39947cb3", { value0: safeName }));
          const filePath = result.filePath || result.path;
          editorNode.videoEditProject = {
            ...project,
            lastExport: {
              filePath,
              duration: result.duration,
              exportedAt: new Date().toISOString(),
            },
          };
          editorNode.videoEdit = { exportedFile: filePath, dirty: false };
          commitEditorNode();
          touchProject();
          refresh();
          showToast(t("ui.ReactWorkbench.text.1f9eec56"));
          return result;
        },
        close() {
          setEditorNodeId("");
        },
        expand() {
          setEditorExpanded(true);
        },
        consumeIntent() {
          setEditorIntent(undefined);
        },
        ...editorLocalMedia,
      }
    : undefined;
  /** 任务行跳到画布节点；画布尚未挂载时 focus 请求会排队到挂载完成。 */
  function locateTaskNode(nodeId: string) {
    if (
      !(store.project.nodes as any[]).some(
        (node) => String(node.id) === String(nodeId),
      )
    ) {
      showToast(t("ui.ReactWorkbench.text.e0a5bc5b"));
      return;
    }
    navigateToRoute("creation");
    useAppStore.setState({ route: "creation" });
    focusCanvasNodes([nodeId]);
  }

  const onUpdate = () => void updateDialogController.check();
  let activeView: React.ReactNode;
  if (openingProjectPath) {
    activeView = <section className="react-workflow-canvas" aria-label={t("ui.ReactWorkbench.arialabel.6f4cc182")}><CanvasStartup canvasReady={false} /></section>;
  } else if (appRoute === "projects") {
    activeView = (
      <ProjectsView {...projects!} {...(cloudEnabled && new URLSearchParams(location.search).get('folder') ? { initialFolderPath: [new URLSearchParams(location.search).get('folder')!] } : {})} controller={projectLibraryController} />
    );
  } else if (appRoute === "skills") {
    activeView = <SkillsFeature />;
  } else if (appRoute === 'account') {
    activeView = <AccountView onSettings={() => setSettingsOpen(true)} onUpdate={desktopApi.platform === 'browser' ? undefined : onUpdate} />;
  } else if (appRoute === "tasks") {
    activeView = (
      <TasksView
        tasks={taskViewData()}
        onCancel={(id) => {
          taskController.cancel(id);
        }}
        onRetry={(id) => {
          taskController.retry(id);
        }}
        onAdoptRemote={(id, remoteTaskId) =>
          taskController.adoptRemote(id, remoteTaskId)
        }
        onClear={() => {
          taskController.clear();
        }}
        onLocate={locateTaskNode}
      />
    );
  } else if (appRoute === "assets") {
    activeView = (
      <AssetsView
        projectAssets={resources!.projectAssets}
        localAssets={resources!.localAssets}
        assetMaterialIds={resources!.assetMaterialIds}
        controller={assetsController}
      />
    );
  } else if (appRoute === "materials") {
    activeView = (
      <MaterialsView
        materials={resources!.materials}
        assetMaterialIds={resources!.assetMaterialIds}
        controller={materialsController}
      />
    );
  } else {
    activeView = (
      <CreationView
        key={`${store.project.id}:${store.filePath || ""}`}
        data={{
          ...canvas!,
          fullDirectorWorkspace: directorWorkspaceOpen,
          onLeaveFullDirectorWorkspace: () => setDirectorWorkspaceOpen(false),
          artifactNodes: [
            ...canvas!.nodes,
            ...store.project.nodes.filter(
              (node: any) => node.type === "resource",
            ),
          ],
          shortcutLabels: {
            fitView: canvasActionShortcutLabel(
              settingsStore.canvasActionShortcuts.fitView,
            ),
            autoLayout: canvasActionShortcutLabel(
              settingsStore.canvasActionShortcuts.autoLayout,
            ),
          },
          ...(editor ? { editor } : {}),
        }}
        controller={{
          canvas: canvasController,
          nodes: nodeActions,
          async applyMaterial(item, scope) {
            await canvasCommands.applyMaterial(item, scope);
          },
          previewMaterial: assetsController.preview,
          showMaterialInFolder: assetsController.showFile,
          loadMaterials: resourceLibraryData,
          importMaterials: materialsController.importFiles,
          deleteMaterial(item, scope) {
            if (scope === "library")
              return assetsController.deleteProjectAsset(item);
            if (scope === "local")
              return assetsController.deleteLocalAsset(item);
            return materialsController.delete(item);
          },
          undo: canvasCommands.undo,
          redo: canvasCommands.redo,
          fitView: canvasCommands.fitView,
          autoLayout: canvasCommands.autoLayout,
          exportSelected: () => void canvasCommands.exportSelectedAssets(),
          mergeVideos: () => void canvasCommands.mergeSelectedVideos(),
          ...(editorController ? { editor: editorController } : {}),
        }}
      />
    );
  }
  if (navigationStatus === 'loading') return <main className="cloud-session-loading" role="status" aria-live="polite">
    <img src="/shotloom-logo.png" alt="Shotloom" width="48" height="48" />
    <span className="cloud-session-progress" aria-hidden="true" />
    <p>{t('canvas.preparing')}</p>
  </main>;
  return (
    <>
      <AppShell
        platform={desktopApi.platform}
        view={activeView}
        onVideoEdit={() => canvasCommands.openBlankVideoEditor()}
        onUpdate={onUpdate}
        onNavigationBlocked={() => showToast(t("project.openFirst"))}
      />
      {searchOpen && <ProjectSearch onClose={() => setSearchOpen(false)} />}
      {settingsOpen && (
        <Modal
          open
          width="100%"
          footer={null}
          closable={false}
          aria-label={t("ui.SideBar.title.7debf9cb")}
          onCancel={() => setSettingsOpen(false)}
          className="settings-workbench-dialog"
          styles={{
            body: {
              padding: 0,
              height: "100dvh",
              display: "grid",
              gridTemplateRows: "minmax(0, 1fr) auto",
            },
          }}
        >
          <SettingsFeature />
          <footer className="settings-workbench-footer">
            <button
              className="button primary settings-workbench-close"
              onClick={() => setSettingsOpen(false)}
            >
              {t("ui.ReactWorkbench.text.33246f6a")}</button>
          </footer>
        </Modal>
      )}
      {update.open && (
        <UpdateDialog data={update} controller={updateDialogController} />
      )}
      <MediaViewer />
      <ToastHost />
      <ConfirmHost />
    </>
  );
}
