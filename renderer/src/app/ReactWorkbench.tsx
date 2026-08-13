import { useEffect, useReducer, useState, useSyncExternalStore } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useWindowClose } from "../composables/useWindowClose";
import { desktopApi } from "../services/desktopApi.js";
import { copyFileIntoProjectAssets, inferFileResourceType } from "../store/assetStore.js";
import {
  hasOpenProject,
  initProjectCloneProgressListener,
  loadBoundWindowProject,
  loadRecentProjects,
  navigateToRoute,
  store,
  touchProject,
} from "../store/projectStore.js";
import { loadAppSettings, settingsStore } from "../store/settingsStore.js";
import { loadGlobalRecipes } from "../store/recipesStore.js";
import { loadGlobalSkills } from "../store/skillsStore.js";
import { resumeRemoteTasks } from "../store/taskStore.js";
import { getDomainRevision, subscribeDomain } from "../store/domainReactivity.js";
import { canvasActionShortcutLabel } from "../utils/canvasActionShortcuts.js";
import {
  inferEditorMediaType,
  probeEditorMedia,
} from "../utils/editorMediaImport.mjs";
import { AppShell } from "./AppShell";
import {
  canvasCommands,
  canvasController,
  canvasViewData,
  nodeActions,
  registerVideoEditorOpener,
} from "./adapters/canvasAdapter";
import {
  copilotController,
  copilotData,
  getCopilotRevision,
  maintainCopilotSessionMemory,
  subscribeCopilot,
} from "./adapters/copilotAdapter";
import { projectLibraryController, projectLibraryData } from "./adapters/projectLibraryAdapter";
import {
  assetsController,
  initializeResourceLibraries,
  materialsController,
  resourceLibraryData,
} from "./adapters/resourceLibraryAdapter";
import { taskController, taskViewData } from "./adapters/taskAdapter";
import { updateDialogController, updateDialogData } from "./adapters/updateAdapter";
import { MediaViewer } from "./components/MediaViewer";
import { ToastHost } from "./components/ToastHost";
import { UpdateDialog } from "./components/UpdateDialog";
import { CreationView } from "./views/CreationView";
import { AssetsView } from "./views/AssetsView";
import { MaterialsView } from "./views/MaterialsView";
import { ProjectsView } from "./views/ProjectsView";
import { SettingsFeature } from "./views/SettingsFeature";
import { TasksView } from "./views/TasksView";
import { showToast } from "./store/overlayStore";
import { recoverInterruptedAgentRuns, relieveAgentHistoryMemoryPressure } from "../agent/runtime/runStore";
import { type AppRoute, useAppStore } from "./store/appStore";
import { installMediaPreviewCacheMemoryPressureListener } from "../services/mediaPreviewCache";

/**
 * React 主工作台根；领域状态通过框架无关订阅同步到视图。
 */
export function ReactWorkbench() {
  const [, refresh] = useReducer((value) => value + 1, 0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editorNodeId, setEditorNodeId] = useState("");
  const appRoute = useAppStore((state) => state.route);
  const domainRevision = useSyncExternalStore(
    subscribeDomain,
    getDomainRevision,
    getDomainRevision,
  );

  useEffect(() => {
    let taskTimer = 0;
    let sessionMemoryTimer = 0;
    let disposeClose: undefined | (() => void);
    let disposeMemoryPressure: undefined | (() => void);
    let disposeMediaCachePressure: undefined | (() => void);
    let cancelled = false;
    void (async () => {
      await loadAppSettings();
      await Promise.all([
        loadGlobalSkills(),
        loadGlobalRecipes(),
        loadRecentProjects(),
        initializeResourceLibraries(),
      ]);
      await loadBoundWindowProject();
      if (cancelled) return;
      if (desktopApi.platform !== 'browser') {
        const recovery = await invoke<any>('recovery_status').catch(() => null);
        const previous = recovery?.previousUnclean;
        if (previous) {
          const recoveredRuns = recoverInterruptedAgentRuns(String(previous.activeRunId || ''));
          const memoryHint = Number(previous.availableMemoryKb || 0) > 0
            ? `，退出前系统可用内存约 ${Math.round(Number(previous.availableMemoryKb) / 1024)} MB`
            : '';
          showToast(`检测到上次未正常退出，已恢复项目状态${recoveredRuns ? `并终止 ${recoveredRuns} 个未完成 Agent 运行` : ''}${memoryHint}`);
        }
      }
      resumeRemoteTasks();
      taskTimer = window.setInterval(() => resumeRemoteTasks(), 5000);
      maintainCopilotSessionMemory();
      sessionMemoryTimer = window.setInterval(() => maintainCopilotSessionMemory(), 60_000);
      disposeMediaCachePressure = installMediaPreviewCacheMemoryPressureListener();
      initProjectCloneProgressListener?.();
      disposeClose = useWindowClose();
      if (desktopApi.platform !== 'browser') {
        disposeMemoryPressure = await listen<any>('system-memory-pressure', ({ payload }) => {
          const level = payload?.level === 'critical' ? 'critical' : 'low';
          const released = relieveAgentHistoryMemoryPressure(level);
          window.dispatchEvent(new CustomEvent('shotloom-memory-pressure', { detail: payload }));
          showToast(`系统内存不足，已释放非活动缓存和 ${Number(released.removedEvents || 0)} 条旧运行事件`);
        });
      }
      refresh();
    })().catch((cause) => showToast(cause instanceof Error ? cause.message : "应用初始化失败"));
    registerVideoEditorOpener(setEditorNodeId);
    return () => {
      cancelled = true;
      registerVideoEditorOpener(null);
      if (taskTimer) window.clearInterval(taskTimer);
      if (sessionMemoryTimer) window.clearInterval(sessionMemoryTimer);
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
      ["projects", "creation", "tasks", "assets", "materials"].includes(route) &&
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

  const projects = appRoute === "projects" ? projectLibraryData() : null;
  const resources = ["assets", "materials"].includes(appRoute) ? resourceLibraryData() : null;
  const canvas = appRoute === "creation" ? canvasViewData() : null;
  const update = updateDialogData();
  const editorNode: any = editorNodeId
    ? store.project.nodes.find((node: any) => node.id === editorNodeId)
    : null;
  const editorTask: any = editorNode
    ? [...(store.project.tasks || [])]
        .reverse()
        .find((task: any) => task.nodeId === editorNode.id && task.status === "completed")
    : null;
  const editorOutputs: any[] = editorNode
    ? [
        ...(Array.isArray(editorNode.generatedOutputs) ? editorNode.generatedOutputs : []),
        ...(store.project.materials || [])
          .filter((item: any) => item.nodeId === editorNode.id)
          .map((item: any) => ({
            ...item,
            id: `material:${item.id}`,
            filePath: item.filePath || item.path,
          })),
        ...(store.project.nodes || []).filter(
          (item: any) =>
            item.type === "resource" &&
            !item.archived &&
            item.generatedFrom?.nodeId === editorNode.id,
        ),
      ]
    : [];
  const isVideoOutput = (item: any) => {
    const type = String(item?.resourceType || item?.mimeType || item?.type || "").toLowerCase();
    const path = String(item?.filePath || item?.path || item?.url || "")
      .split(/[?#]/)[0]
      .toLowerCase();
    return type.includes("video") || /\.(mp4|mov|webm|m4v)$/.test(path);
  };
  const selectedEditorOutput =
    editorOutputs.find(
      (item: any) =>
        String(item.id) === String(editorNode?.selectedOutputNodeId || "") && isVideoOutput(item),
    ) || [...editorOutputs].reverse().find(isVideoOutput);
  const editorFile = String(
    editorNode?.videoEdit?.exportedFile ||
      selectedEditorOutput?.filePath ||
      selectedEditorOutput?.path ||
      editorTask?.result?.archivedFiles?.find((file: any) =>
        String(file.resourceType || file.type || "").includes("video"),
      )?.filePath ||
      editorNode?.uploadedFile?.path ||
      "",
  );
  const editor =
    editorNode
      ? {
          title: editorNode.title || "视频剪辑",
          project: editorNode.videoEditProject,
          sourceFile: editorFile,
          sourceUrl: editorFile ? convertFileSrc(editorFile) : "",
          sourceName: editorFile.split(/[\\/]/).pop() || "未命名剪辑",
          metadata: editorNode.metadata || editorTask?.result?.metadata || {},
        }
      : undefined;
  const editorController = editorNode
    ? {
        persist(project: Record<string, unknown>) {
          editorNode.videoEditProject = project;
          editorNode.videoEdit = { ...(editorNode.videoEdit || {}), dirty: true };
          touchProject({ sessionDelay: 300, coalesceSession: true });
          refresh();
        },
        async export(project: Record<string, unknown>) {
          const safeName = String(editorNode.title || "video").replace(/[\\/:*?"<>|]/g, "-");
          const result = await desktopApi.file.exportVideoProject(project, `${safeName}-剪辑.mp4`);
          if (!result) return null;
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
          touchProject();
          refresh();
          showToast(`剪辑已导出：${result.name || "MP4"}`);
          return result;
        },
        close() {
          setEditorNodeId("");
        },
        async importAssets(source = "device" as "device" | "library" | "local" | "files") {
          const libraries = source === "device" ? null : resourceLibraryData();
          const files: any[] = source === "device"
            ? await desktopApi.file.importAsset()
            : source === "library"
              ? libraries?.projectAssets || []
              : source === "local"
                ? libraries?.localAssets || []
                : libraries?.materials || [];
          const mediaFiles = files.filter((file: any) =>
            ["video", "audio", "image"].includes(inferFileResourceType(file))
          );
          const results = await Promise.allSettled(
            mediaFiles.map(async (file: any, index: number) => {
              const projectFile: any = source === "device"
                ? await copyFileIntoProjectAssets(file)
                : file;
              const sourceFile = String(projectFile.filePath || projectFile.path || "");
              if (!sourceFile) throw new Error("素材文件路径为空");
              const type = inferEditorMediaType(sourceFile);
              const sourceUrl = convertFileSrc(sourceFile);
              const facts = await probeEditorMedia({
                type,
                sourceFile,
                sourceUrl,
                readArrayBuffer: desktopApi.file.readArrayBuffer,
                probeNative: desktopApi.file.probeMedia,
              });
              return {
                id: String(projectFile.assetId || projectFile.id ||
                  `asset-import-${Date.now().toString(36)}-${index}`),
                type,
                name: projectFile.name || file.name || sourceFile.split(/[\\/]/).pop() || "素材",
                sourceFile,
                sourceUrl,
                ...facts,
              };
            }),
          );
          const imported = results.flatMap((result) =>
            result.status === "fulfilled" ? [result.value] : []
          );
          const failed = results.length - imported.length;
          if (failed) {
            showToast(
              failed === results.length
                ? "视频读取失败，请确认文件未损坏且编码受系统支持"
                : `${failed} 个素材读取失败，已导入其余素材`,
            );
          }
          return imported;
        },
      }
    : undefined;
  let activeView: React.ReactNode;
  if (appRoute === "projects") {
    activeView = <ProjectsView {...projects!} controller={projectLibraryController} />;
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
        onClear={() => {
          taskController.clear();
        }}
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
        data={{
          ...canvas!,
          shortcutLabels: {
            fitView: canvasActionShortcutLabel(settingsStore.canvasActionShortcuts.fitView),
            autoLayout: canvasActionShortcutLabel(settingsStore.canvasActionShortcuts.autoLayout),
          },
          ...(editor ? { editor } : {}),
        }}
        controller={{
          canvas: canvasController,
          nodes: nodeActions,
          copilot: {
            ...copilotController,
            subscribe: subscribeCopilot,
            getRevision: getCopilotRevision,
            read: copilotData,
          },
          async applyMaterial(item) {
            await canvasCommands.applyMaterial(item);
          },
          previewMaterial: assetsController.preview,
          showMaterialInFolder: assetsController.showFile,
          loadMaterials: resourceLibraryData,
          importMaterials: materialsController.importFiles,
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
  return (
    <>
      <AppShell
        platform={desktopApi.platform}
        view={activeView}
        onVideoEdit={() => canvasCommands.openBlankVideoEditor()}
        onNotify={() =>
          void desktopApi
            .notifyTask({
              title: "Shotloom",
              body: "通知功能可用。",
            })
            .then(() => showToast("通知已发送"))
        }
        onSettings={() => setSettingsOpen(true)}
        onUpdate={() => void updateDialogController.check()}
        onNavigationBlocked={() => showToast("请先新建或打开一个项目")}
      />
      {settingsOpen && (
        <div
          className="modal-backdrop open settings-workbench-backdrop"
          onMouseDown={(event) => event.target === event.currentTarget && setSettingsOpen(false)}
        >
          <section className="settings-workbench-modal">
            <SettingsFeature />
            <footer className="settings-workbench-footer">
              <button
                className="button primary settings-workbench-close"
                onClick={() => setSettingsOpen(false)}
              >
                完成
              </button>
            </footer>
          </section>
        </div>
      )}
      {update.open && <UpdateDialog data={update} controller={updateDialogController} />}
      <MediaViewer />
      <ToastHost />
    </>
  );
}
