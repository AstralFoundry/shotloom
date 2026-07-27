import { useEffect, useReducer, useState, useSyncExternalStore } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useWindowClose } from "../composables/useWindowClose";
import { desktopApi } from "../services/desktopApi.js";
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
import {
  getDomainRevision,
  subscribeDomain,
} from "../store/domainReactivity.js";
import { registerUpdateBridge } from "../store/updateStore.js";
import { canvasActionShortcutLabel } from "../utils/canvasActionShortcuts.js";
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
  subscribeCopilot,
} from "./adapters/copilotAdapter";
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
import { UpdateDialog } from "./components/UpdateDialog";
import { CreationView } from "./views/CreationView";
import { AssetsView } from "./views/AssetsView";
import { MaterialsView } from "./views/MaterialsView";
import { ProjectsView } from "./views/ProjectsView";
import { SettingsFeature } from "./views/SettingsFeature";
import { TasksView } from "./views/TasksView";
import { showToast } from "./store/overlayStore";
import { type AppRoute, useAppStore } from "./store/appStore";

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
    let disposeClose: undefined | (() => void);
    let disposeUpdate: undefined | (() => void);
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
      resumeRemoteTasks();
      taskTimer = window.setInterval(() => resumeRemoteTasks(), 5000);
      initProjectCloneProgressListener?.();
      disposeClose = useWindowClose();
      disposeUpdate = registerUpdateBridge();
      refresh();
    })().catch((cause) =>
      showToast(cause instanceof Error ? cause.message : "应用初始化失败")
    );
    const unsubscribeCopilot = subscribeCopilot(refresh);
    registerVideoEditorOpener(setEditorNodeId);
    return () => {
      cancelled = true;
      registerVideoEditorOpener(null);
      unsubscribeCopilot();
      if (taskTimer) window.clearInterval(taskTimer);
      disposeClose?.();
      disposeUpdate?.();
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
      ["projects", "creation", "tasks", "assets", "materials"].includes(
        route,
      ) &&
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

  const projects = projectLibraryData();
  const resources = resourceLibraryData();
  const canvas = canvasViewData();
  const copilot = copilotData();
  const update = updateDialogData();
  const editorNode: any = editorNodeId
    ? store.project.nodes.find((node: any) => node.id === editorNodeId)
    : null;
  const editorTask: any = editorNode
    ? [...(store.project.tasks || [])].reverse().find((task: any) =>
      task.nodeId === editorNode.id && task.status === "completed"
    )
    : null;
  const editorOutputs: any[] = editorNode
    ? [
      ...(Array.isArray(editorNode.generatedOutputs)
        ? editorNode.generatedOutputs
        : []),
      ...(store.project.materials || []).filter((item: any) =>
        item.nodeId === editorNode.id
      ).map((item: any) => ({
        ...item,
        id: `material:${item.id}`,
        filePath: item.filePath || item.path,
      })),
      ...(store.project.nodes || []).filter((item: any) =>
        item.type === "resource" && !item.archived &&
        item.generatedFrom?.nodeId === editorNode.id
      ),
    ]
    : [];
  const isVideoOutput = (item: any) => {
    const type = String(item?.resourceType || item?.mimeType || item?.type || "")
      .toLowerCase();
    const path = String(item?.filePath || item?.path || item?.url || "")
      .split(/[?#]/)[0].toLowerCase();
    return type.includes("video") || /\.(mp4|mov|webm|m4v)$/.test(path);
  };
  const selectedEditorOutput = editorOutputs.find((item: any) =>
    String(item.id) === String(editorNode?.selectedOutputNodeId || "") &&
    isVideoOutput(item)
  ) || [...editorOutputs].reverse().find(isVideoOutput);
  const editorFile = String(
    editorNode?.videoEdit?.exportedFile ||
      selectedEditorOutput?.filePath || selectedEditorOutput?.path ||
      editorTask?.result?.archivedFiles?.find((file: any) =>
        String(file.resourceType || file.type || "").includes("video")
      )?.filePath || editorNode?.uploadedFile?.path || "",
  );
  const editor = editorNode && editorFile
    ? {
      title: editorNode.title || "视频剪辑",
      project: editorNode.videoEditProject,
      sourceFile: editorFile,
      sourceUrl: convertFileSrc(editorFile),
      sourceName: editorFile.split(/[\\/]/).pop() || "video.mp4",
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
        const safeName = String(editorNode.title || "video").replace(
          /[\\/:*?"<>|]/g,
          "-",
        );
        const result = await desktopApi.file.exportVideoProject(
          project,
          `${safeName}-剪辑.mp4`,
        );
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
      async importAssets() {
        const files = await desktopApi.file.importAsset();
        return Promise.all(files.map(async (file: any, index: number) => {
          const sourceFile = String(file.filePath || file.path || "");
          const extension =
            String(sourceFile).split(".").pop()?.toLowerCase() || "";
          const type =
            ["png", "jpg", "jpeg", "webp", "gif", "bmp"].includes(extension)
              ? "image" as const
              : ["mp3", "wav", "m4a", "aac", "flac", "ogg"].includes(extension)
              ? "audio" as const
              : "video" as const;
          const sourceUrl = convertFileSrc(sourceFile);
          const media = document.createElement(
            type === "image" ? "img" : type === "audio" ? "audio" : "video",
          );
          const facts: any = await new Promise((resolve) => {
            const done = () =>
              resolve({
                duration: Number((media as HTMLMediaElement).duration) || 0,
                width: Number(
                  (media as HTMLVideoElement).videoWidth ||
                    (media as HTMLImageElement).naturalWidth,
                ) || 0,
                height: Number(
                  (media as HTMLVideoElement).videoHeight ||
                    (media as HTMLImageElement).naturalHeight,
                ) || 0,
              });
            media.addEventListener(
              type === "image" ? "load" : "loadedmetadata",
              done,
              { once: true },
            );
            media.addEventListener("error", () =>
              resolve({ duration: 0, width: 0, height: 0 }), { once: true });
            (media as HTMLMediaElement).src = sourceUrl;
          });
          return {
            id: `asset-import-${Date.now().toString(36)}-${index}`,
            type,
            name: file.name || sourceFile.split(/[\\/]/).pop() || "素材",
            sourceFile,
            sourceUrl,
            ...facts,
          };
        }));
      },
    }
    : undefined;
  const views: Record<AppRoute, React.ReactNode> = {
    projects: (
      <ProjectsView {...projects} controller={projectLibraryController} />
    ),
    tasks: (
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
    ),
    assets: (
      <AssetsView
        projectAssets={resources.projectAssets}
        localAssets={resources.localAssets}
        assetMaterialIds={resources.assetMaterialIds}
        controller={assetsController}
      />
    ),
    materials: (
      <MaterialsView
        materials={resources.materials}
        assetMaterialIds={resources.assetMaterialIds}
        controller={materialsController}
      />
    ),
    creation: (
      <CreationView
        data={{
          ...canvas,
          materials: {
            library: resources.projectAssets,
            local: resources.localAssets,
            files: resources.materials,
          },
          copilot,
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
          copilot: copilotController,
          applyMaterial: (item) => canvasCommands.applyMaterial(item),
          previewMaterial: assetsController.preview,
          undo: canvasCommands.undo,
          redo: canvasCommands.redo,
          fitView: canvasCommands.fitView,
          autoLayout: canvasCommands.autoLayout,
          exportSelected: () => void canvasCommands.exportSelectedAssets(),
          mergeVideos: () => void canvasCommands.mergeSelectedVideos(),
          ...(editorController ? { editor: editorController } : {}),
        }}
      />
    ),
  };
  return (
    <>
      <AppShell
        platform={desktopApi.platform}
        views={views}
        onAddNode={(type) =>
          canvasController.createNodeAt(type, { x: 120, y: 90 })}
        onNotify={() =>
          void desktopApi.notifyTask({
            title: "Shotloom",
            body: "通知功能可用。",
          }).then(() => showToast("通知已发送"))}
        onSettings={() => setSettingsOpen(true)}
        onUpdate={() => void updateDialogController.check()}
        onNavigationBlocked={() => showToast("请先新建或打开一个项目")}
      />
      {settingsOpen && (
        <div
          className="modal-backdrop open settings-workbench-backdrop"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setSettingsOpen(false)}
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
      {update.open && (
        <UpdateDialog data={update} controller={updateDialogController} />
      )}
      <MediaViewer />
      <ToastHost />
    </>
  );
}
