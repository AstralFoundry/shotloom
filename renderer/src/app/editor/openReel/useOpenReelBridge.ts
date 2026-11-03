import { t } from '@/i18n';
import { ClipSourceConnections } from "./clipSourceConnections";
import { offlineEditorMedia, restoredEditorAsset, withRestoredEditorAsset, type OfflineEditorMedia } from "./offlineMedia";
import { importMediaBatch } from "./mediaBatchImport";
import { clipExportDeliveries, pendingClipExportDeliveries, stageClipExportDelivery, retryClipExportDelivery, replayClipExportDelivery, abandonClipExportDelivery, type ClipExportDelivery, type ClipExportResult } from "./exportDelivery";
import { subscribeDomain } from "../../../store/domainReactivity";
import { CLIP_NODE_LAYOUT } from "../../../utils/clipNodeLayout";
import { uid } from "../../../utils/format";
import { useCallback, useEffect, useRef, useState } from "react";
import { showToast } from "../../../store/notificationStore";
import { store, touchProject, flushProjectCheckpoint } from "../../../store/projectStore";
import {
  editorCanvasCandidate,
  findEditorMediaCandidate,
  resolveEditorMediaAsset,
} from "../../../services/editorMediaCatalog";
import { desktopApi } from "../../../services/desktopApi";
import { registerProjectOperationGuard } from "../../../services/projectOperationGuards";
import { normalizeVideoEditorProject, planEditorMediaPlacement } from "../../../utils/videoEditorProject";
import { workspaceVideoEditorNode, saveWorkspaceVideoEditorNode } from "../../adapters/canvas/videoEditorActions";
import { getAgentProjectKey } from "../../../services/agentProjectIdentity";
import { registerActiveVideoEditor } from "../../../agent/tools/videoEditorTools";
import type { VideoEditorAsset, VideoEditorProject } from "../videoEditorTypes";
import {
  type ClipStudioRuntimeController,
  type OpenReelActionCatalog,
  type OpenReelBridgeState,
  type OpenReelImportedAsset,
} from "../../../../../vendor/openreel/apps/web/src/embedded/runtime-types";
import {
  buildAssetPayload,
  buildLoadPayload,
  summaryFromNative,
  withSummaryAssets,
} from "./projectBridge";
import {
  createSnapshotWriter,
  registerClipSnapshotReader,
  readNativeSnapshot,
  snapshotRelativePath,
  type SnapshotSaveStatus,
} from "../../../services/clipSnapshotStore";
import { clipExportPresets } from "../editorMediaPresentation";
import type { VideoEditorController } from "./types";

type PendingExport = {
  requestKey?: string;
  promise?: Promise<ClipExportResult>;
  owner: typeof store.project;
  directory: string;
  format: "video" | "srt";
  duration: number;
  revision: string;
  settings: { width: number; height: number; fps: number };
  cancelled: boolean;
  target: "canvas" | "local";
  resolve: (result: ClipExportResult) => void;
  reject: (error: Error) => void;
};

export function useOpenReelBridge({
  nodeId,
  title = t("ui.ReactWorkbench.text.3d65ff77"),
  project,
  assets = [],
  controller,
  active = true,
  expanded = true,
  canvasNode = false,
}: {
  nodeId: string;
  title?: string;
  project?: Record<string, unknown> | undefined;
  assets?: VideoEditorAsset[] | undefined;
  controller: VideoEditorController;
  active?: boolean;
  expanded?: boolean;
  canvasNode?: boolean;
}) {
  const runtimeRef = useRef<ClipStudioRuntimeController | null>(null);
  const initialProject = useRef<VideoEditorProject | null>(null);
  if (!initialProject.current) {
    initialProject.current = normalizeVideoEditorProject(project) as VideoEditorProject;
  }
  const summaryRef = useRef<VideoEditorProject>(initialProject.current);
  const extraAssetsRef = useRef<VideoEditorAsset[]>(assets);
  extraAssetsRef.current = assets;
  const stateRef = useRef<OpenReelBridgeState | null>(null);
  const readyRef = useRef(false);
  const loadedRef = useRef(false);
  const loadStartedRef = useRef(false);
  const closedRef = useRef(false);
  const persistTimerRef = useRef<number | null>(null);
  const pendingExportRef = useRef<(PendingExport & { deliveryId: string }) | null>(null);
  useEffect(() => registerProjectOperationGuard(() => {
    const pending = pendingExportRef.current;
    return pending ? {
      project: pending.owner, nodeId, reason: t("ui.useOpenReelBridge.reason.ea463089"),
    } : null;
  }), [nodeId]);
  const sourceSyncRef = useRef<ClipSourceConnections | null>(null);
  const writerRef = useRef<ReturnType<typeof createSnapshotWriter> | null>(null);
  // 入边同步只处理自己导入过的媒体：用户在选择器里手动加的素材不因断线而消失。

  const [status, setStatus] = useState(t("ui.useOpenReelBridge.text.a8f512c8"));
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportAnchor, setExportAnchor] = useState<{ x: number; y: number; top?: number } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [history, setHistory] = useState({ canUndo: false, canRedo: false });
  const [catalog, setCatalog] = useState<OpenReelActionCatalog | null>(null);
  const catalogRef = useRef<OpenReelActionCatalog | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SnapshotSaveStatus>("dirty");
  const [saveError, setSaveError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [retrying, setRetrying] = useState(false);
  const [offlineMedia, setOfflineMedia] = useState<OfflineEditorMedia[]>([]);
  const [relinkError, setRelinkError] = useState("");
  const [relinking, setRelinking] = useState(false);
  const relinkingRef = useRef(false);
  const [exportRecoveries, setExportRecoveries] = useState<ClipExportDelivery[]>(() => pendingClipExportDeliveries(nodeId));
  const [deliveryBusy, setDeliveryBusy] = useState(false);
  const deliveryBusyRef = useRef(false);
  const refreshExportRecoveries = useCallback(() => {
    try { setExportRecoveries(pendingClipExportDeliveries(nodeId)); }
    catch { setExportRecoveries([]); }
  }, [nodeId]);
  const endExportRecovery = useCallback((id: string) => {
    if (deliveryBusyRef.current) return;
    const delivery = abandonClipExportDelivery(nodeId, id);
    refreshExportRecoveries();
    setError("");
    setStatus(t("ui.useOpenReelBridge.text.1d07a100"));
    showToast(t("ui.useOpenReelBridge.text.f9d4027e", { value0: delivery.filePath }));
  }, [nodeId, refreshExportRecoveries]);
  const retryExportDelivery = useCallback(async (id: string) => {
    if (deliveryBusyRef.current) return;
    deliveryBusyRef.current = true;
    setDeliveryBusy(true);
    try {
      await retryClipExportDelivery(nodeId, id);
      setError("");
      setStatus(t("ui.useOpenReelBridge.text.bd2c1294"));
      showToast(t("ui.useOpenReelBridge.text.bd2c1294"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally {
      deliveryBusyRef.current = false;
      setDeliveryBusy(false);
      refreshExportRecoveries();
    }
  }, [nodeId, refreshExportRecoveries]);

  const projectDir = String(store.projectDir || "");

  useEffect(() => {
    if (!projectDir) return;
    let alive = true;
    const writer = createSnapshotWriter(projectDir, nodeId, 800, (cause) => {
      if (!alive) return;
      setSaveError(cause.message);
      setStatus(t("ui.useOpenReelBridge.text.d0c0bc3a"));
    }, (next) => {
      if (!alive) return;
      setSaveStatus(next);
      if (next === "saved") setSaveError("");
    });
    writerRef.current = writer;
    return () => {
      alive = false;
      // RuntimeHost performs a final fresh capture after this hook unmounts.
      // Keep its writer reachable until that flush has completed.
      void writer.dispose().catch(() => {});
    };
  }, [nodeId, projectDir]);

  const persistNow = useCallback(
    (summary: VideoEditorProject = summaryRef.current) => {
      if (persistTimerRef.current) {
        window.clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
      try {
        controller.persist({
          ...summary,
          openReelSnapshot: snapshotRelativePath(nodeId),
        });
      } catch (cause) {
        showToast(cause instanceof Error ? cause.message : t("ui.useOpenReelBridge.text.b42f057a"));
      }
    },
    [controller, nodeId],
  );

  const schedulePersist = useCallback(
    (summary: VideoEditorProject) => {
      if (persistTimerRef.current) window.clearTimeout(persistTimerRef.current);
      persistTimerRef.current = window.setTimeout(() => {
        persistTimerRef.current = null;
        try {
          controller.persist({
            ...summary,
            openReelSnapshot: snapshotRelativePath(nodeId),
          });
        } catch (cause) {
          showToast(cause instanceof Error ? cause.message : t("ui.useOpenReelBridge.text.b42f057a"));
        }
      }, 250);
    },
    [controller, nodeId],
  );

  const applyState = useCallback(
    (state: OpenReelBridgeState) => {
      // 工程尚未恢复时，运行时报告的初始空工程不能覆盖用户的工程。
      // 落盘会把摘要时间线清空，并让空快照下次顶掉入边导入的素材。
      if (!loadedRef.current || closedRef.current) return;
      stateRef.current = state;
      setOfflineMedia(offlineEditorMedia(state.native));
      sourceSyncRef.current?.observe(state);
      void sourceSyncRef.current?.sync();
      setHistory({ canUndo: state.canUndo, canRedo: state.canRedo });
      const base = summaryRef.current || initialProject.current!;
      const summary = summaryFromNative(state, base);
      summaryRef.current = summary;
      schedulePersist(summary);
      if (state.native) writerRef.current?.schedule({ ...state.native, shotloomSession: state.session });
    },
    [schedulePersist],
  );

  const requestState = useCallback(async (requireFresh = false) => {
    if (!loadedRef.current || !runtimeRef.current) return requireFresh ? null : stateRef.current;
    try { return await runtimeRef.current.getState(); }
    catch (cause) { if (requireFresh) throw cause; return stateRef.current; }
  }, []);

  const snapshotNodeOwner = canvasNode ? store.project.nodes.find((item: any) => item.id === nodeId) : null;
  useEffect(() => {
    if (!loaded || !projectDir) return;
    const snapshotOwner = store.project;
    const snapshotNode = snapshotNodeOwner;
    const assertOwner = () => {
      if (store.project !== snapshotOwner || store.projectDir !== projectDir ||
          (canvasNode && (!snapshotNode || !snapshotOwner.nodes.includes(snapshotNode)))) {
        throw new Error(t("ui.useOpenReelBridge.text.1b9e1188"));
      }
    };
    return registerClipSnapshotReader(projectDir, nodeId, async () => {
      assertOwner();
      const state = await requestState(true);
      assertOwner();
      if (!state?.native) throw new Error(t("ui.useOpenReelBridge.text.d19d746c"));
      applyState(state);
      persistNow();
      return { ...state.native, shotloomSession: state.session };
    });
  }, [loaded, projectDir, nodeId, requestState, applyState, persistNow, canvasNode, snapshotNodeOwner]);

  const recoverMedia = useCallback(async (mediaId: string) => {
    if (relinkingRef.current || exporting || !loadedRef.current) return;
    const owner = store.project;
    const directory = store.projectDir;
    const node = canvasNode ? owner.nodes.find((item: any) => item.id === nodeId) : null;
    const assertOwner = () => {
      if (store.project !== owner || store.projectDir !== directory || (canvasNode && (!node || !owner.nodes.includes(node)))) throw new Error(t("ui.useOpenReelBridge.text.d69cb3cf"));
    };
    relinkingRef.current = true;
    setRelinking(true);
    setRelinkError("");
    try {
      const missing = offlineEditorMedia(stateRef.current?.native || null).find((item) => item.id === mediaId);
      if (!missing) return;
      if (!controller.recoverMediaFile) throw new Error(t("ui.useOpenReelBridge.text.71d50274"));
      const replacement = await controller.recoverMediaFile(missing.type as VideoEditorAsset["type"]);
      assertOwner();
      if (!replacement) return;
      const asset = restoredEditorAsset(missing, replacement);
      const payload = await buildAssetPayload(asset);
      assertOwner();
      const runtime = runtimeRef.current;
      if (!runtime) throw new Error(t("ui.useOpenReelBridge.text.0956abbf"));
      const result = await runtime.relinkMedia(mediaId, payload);
      applyState(result.state);
      assertOwner();
      if (!result.success) throw new Error(result.error || t("ui.useOpenReelBridge.text.67576a24"));
      summaryRef.current = withRestoredEditorAsset(summaryRef.current, asset);
      persistNow();
      await writerRef.current?.flush();
      setError("");
      showToast(t("ui.useOpenReelBridge.text.414def93"));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setRelinkError(message); setError(message); showToast(message);
    } finally { relinkingRef.current = false; setRelinking(false); }
  }, [applyState, canvasNode, controller, exporting, nodeId, persistNow]);

  const startLoad = useCallback(async () => {
    if (loadStartedRef.current) return;
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const owner = store.project;
    const directory = store.projectDir;
    const node = canvasNode ? owner.nodes.find((item: any) => item.id === nodeId) : null;
    const isCurrent = () => !closedRef.current && runtimeRef.current === runtime && store.project === owner &&
      store.projectDir === directory && (!canvasNode || Boolean(node && owner.nodes.includes(node)));
    loadStartedRef.current = true;
    setStatus(t("ui.useOpenReelBridge.text.52f2c220"));
    setLoadError("");
    setError("");
    try {
      const stored = stateRef.current?.native ? null : await readNativeSnapshot(projectDir, nodeId, Boolean(summaryRef.current.openReelSnapshot));
      // 已加载过的会话优先恢复内存原生状态；空工程也可能是用户删除后的真实结果。
      const native = stateRef.current?.native ?? stored;
      const { payload, warnings } = await buildLoadPayload(
        summaryRef.current,
        extraAssetsRef.current,
        native,
      );
      if (!isCurrent()) return;
      await runtime.load({ ...payload, session: stateRef.current?.session });
      if (!isCurrent()) return;
      loadedRef.current = true;
      setLoaded(true);
      setStatus(t("ui.useOpenReelBridge.text.296a21f6"));
      applyState(await runtime.getState());
      if (warnings.length) showToast(warnings.join("；"));
    } catch (cause) {
      if (!isCurrent()) return;
      loadStartedRef.current = false;
      setError(cause instanceof Error ? cause.message : String(cause));
      setLoadError(cause instanceof Error ? cause.message : String(cause));
      setStatus(t("ui.useOpenReelBridge.text.43f16fc1"));
    }
  }, [nodeId, projectDir, canvasNode, applyState]);

  const retryPersistence = useCallback(async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      if (loadError) {
        loadStartedRef.current = false;
        await startLoad();
      } else {
        if (!writerRef.current) throw new Error(t("ui.useOpenReelBridge.text.6ff347b3"));
        await writerRef.current.flush();
        setError("");
        setStatus(t("ui.useOpenReelBridge.text.5f691e16"));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setRetrying(false); }
  }, [loadError, retrying, startLoad]);

  const finishExport = useCallback(
    async (pending: PendingExport & { deliveryId: string }, buffer: ArrayBuffer) => {
      if (!pending) return;
      if (pending.cancelled) {
        if (pendingExportRef.current === pending) pendingExportRef.current = null;
        setExporting(false); setStatus(t("ui.useOpenReelBridge.text.c8feb7b4")); return;
      }
      const assertOwner = (checkCancellation = true) => {
        if (closedRef.current) throw new Error(t("ui.useOpenReelBridge.text.77dd64e0"));
        if (checkCancellation && pending.cancelled) throw new DOMException(t("ui.useOpenReelBridge.text.c8feb7b4"), "AbortError");
        if (store.project !== pending.owner || store.projectDir !== pending.directory) throw new Error(t("ui.exportDelivery.text.cc7defca"));
        if (canvasNode && !pending.owner.nodes.some((item: any) => item.id === nodeId)) throw new Error(t("ui.useOpenReelBridge.text.10456819"));
      };
      try {
        assertOwner();
        if (!buffer) throw new Error(t("ui.useOpenReelBridge.text.2a7b0c8a"));
        const dir = pending.directory;
        if (!dir) throw new Error(t("ui.useOpenReelBridge.text.8a424365"));
        const node: Record<string, any> = canvasNode ? store.project.nodes.find((item: any) => item.id === nodeId)! : workspaceVideoEditorNode();
        if (!node) throw new Error(t("ui.useOpenReelBridge.text.68d57198"));
        const safeTitle = String(title || t("ui.ReactWorkbench.text.3d65ff77")).replace(/[\\/:*?"<>|]/g, "-");
        const fileName = t("ui.useOpenReelBridge.text.42e5cfaf", { value0: safeTitle, value1: Date.now(), value2: pending.format === "srt" ? "srt" : "mp4" });
        const filePath = `${dir.replace(/[\\/]$/, "")}/assets/${fileName}`;
        const checksum = pending.target === "canvas" && pending.format !== "srt"
          ? Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)), (byte) => byte.toString(16).padStart(2, "0")).join("")
          : undefined;
        assertOwner();
        const written = await desktopApi.file.writeFileToPath(filePath, buffer);
        if (!written) throw new Error(t("ui.useOpenReelBridge.text.6041c439"));
        assertOwner(false);
        const deliveryId = pending.deliveryId;
        if (pending.target === "canvas" && pending.format !== "srt") {
          stageClipExportDelivery(nodeId, {
            id: deliveryId, directory: dir, filePath: written.filePath || filePath,
            name: fileName, title: t("ui.ReactWorkbench.text.39947cb3", { value0: safeTitle }), size: buffer.byteLength,
            duration: pending.duration, ...pending.settings,
            revision: pending.revision,
            ...(pending.requestKey ? { requestKey: pending.requestKey } : {}),
            ...(checksum ? { checksum } : {}),
          });
          if (pending.cancelled) {
            abandonClipExportDelivery(nodeId, deliveryId);
            await flushProjectCheckpoint({ force: true });
            throw new DOMException(t("ui.useOpenReelBridge.text.0c96db92", { value0: written.filePath || filePath }), "AbortError");
          }
        }
        assertOwner();
        let deliveredNode: Record<string, any> | undefined;
        if (pending.target === "local" || pending.format === "srt") {
          const saved = await desktopApi.file.exportFile(filePath, fileName);
          if (!saved) {
            setExporting(false);
            const message = t("ui.useOpenReelBridge.text.bd525aff", { value0: written.filePath || filePath });
            setError(message);
            setStatus(t("ui.useOpenReelBridge.text.1f0e8fda"));
            pending.reject(new DOMException(message, "AbortError"));
            return;
          }
          if (saved.ok === false) throw new Error(t("ui.useOpenReelBridge.text.2aafa0b4"));
          assertOwner();
        } else {
          deliveredNode = await retryClipExportDelivery(nodeId, deliveryId, { assertCurrent: () => assertOwner() });
        }
        if (pending.format === "srt") {
          setStatus(t("ui.useOpenReelBridge.text.2ad9bb97"));
          setProgress(1);
          pending.resolve({ filePath, name: fileName, duration: pending.duration });
          return;
        }
        const summary = {
          ...summaryRef.current,
          lastExport: {
            filePath,
            duration: pending.duration,
            revision: pending.revision,
            exportedAt: new Date().toISOString(),
          },
        };
        summaryRef.current = summary;
        node.videoEditProject = summary;
        node.videoEdit = { ...(node.videoEdit || {}), exportedFile: filePath,
          dirty: String(stateRef.current?.native?.modifiedAt || "") !== pending.revision };
        if (!canvasNode) saveWorkspaceVideoEditorNode(node);
        touchProject();
        persistNow(summary);
        // Delivery has already succeeded. A separate project-save failure must
        // not invite the user to encode and register the same result again.
        await writerRef.current?.flush().catch(() => {});
        setStatus(pending?.target === "local" ? t("ui.useOpenReelBridge.text.d5e823d1") : t("ui.useOpenReelBridge.text.bdc218c3"));
        setProgress(1);
        setExporting(false);
        showToast(pending?.target === "local" ? t("ui.useOpenReelBridge.text.cf9ee1c5") : t("ui.ReactWorkbench.text.1f9eec56"));
        pending?.resolve({
          filePath,
          name: fileName,
          duration: pending.duration,
          ...(deliveredNode ? { deliveryId: pending.deliveryId, nodeId: deliveredNode.id, materialId: deliveredNode.materialId, revision: pending.revision, applied: true } : {}),
        });
      } catch (cause) {
        let error = cause instanceof Error ? cause : new Error(String(cause));
        if (pending.cancelled && store.project === pending.owner && store.projectDir === pending.directory
          && (!canvasNode || store.project.nodes.some((item: any) => item.id === nodeId))) {
          const delivery = clipExportDeliveries(nodeId).find(entry => entry.id === pending.deliveryId);
          if (delivery) {
            abandonClipExportDelivery(nodeId, delivery.id);
            await flushProjectCheckpoint({ force: true });
            error = new DOMException(t("ui.useOpenReelBridge.text.73ee0296", { value0: delivery.nodeId ? t("ui.useOpenReelBridge.text.d772b1a3") : "", value1: delivery.filePath }), "AbortError");
          }
        }
        setError(error.message);
        setStatus(t("ui.useOpenReelBridge.text.033dfe81"));
        setExporting(false);
        pending.reject(error);
      } finally {
        if (pendingExportRef.current === pending) pendingExportRef.current = null;
        setExporting(false);
        refreshExportRecoveries();
      }
    },
    [nodeId, persistNow, title, canvasNode, refreshExportRecoveries],
  );

  const handleExport = useCallback((options: { target?: "canvas" | "local"; presetId?: string; format?: "video" | "srt"; requestKey?: string } = {}) => {
    if (closedRef.current) return Promise.reject(new Error(t("ui.useOpenReelBridge.text.6a46f986")));
    if (options.requestKey) {
      if (clipExportDeliveries(nodeId).some(entry => entry.requestKey === options.requestKey)) {
        return replayClipExportDelivery(nodeId, options.requestKey).then(result => {
          if (!result) throw new Error(t("ui.useOpenReelBridge.text.6391156e"));
          refreshExportRecoveries();
          return result;
        });
      }
      const existing = pendingExportRef.current?.requestKey === options.requestKey ? pendingExportRef.current : null;
      if (existing?.promise) return existing.promise;
    }
    if (relinkingRef.current) return Promise.reject(new Error(t("ui.useOpenReelBridge.text.da5936ea")));
    if (pendingClipExportDeliveries(nodeId).length) {
      refreshExportRecoveries();
      return Promise.reject(new Error(t("ui.useOpenReelBridge.text.f7ad51b7")));
    }
    if (pendingExportRef.current) {
      return Promise.reject(new Error(t("ui.useOpenReelBridge.text.a608b114")));
    }
    if (!loadedRef.current) {
      return Promise.reject(new Error(t("ui.useOpenReelBridge.text.0956abbf")));
    }
    setExportAnchor(null);
    setExporting(true);
    setError("");
    setProgress(0);
    setStatus(t("ui.useOpenReelBridge.text.1789d75c"));
    const deliveryId = uid();
    const preset = clipExportPresets(summaryRef.current).find((item) => item.id === (options.presetId || "match"));
    if (!preset) { setExporting(false); return Promise.reject(new Error(t("ui.useOpenReelBridge.text.1ff9540e"))); }
    const settings = preset.size || summaryRef.current.settings;
    const promise = new Promise<ClipExportResult>((resolve, reject) => {
      pendingExportRef.current = {
        deliveryId,
        ...(options.requestKey ? { requestKey: options.requestKey } : {}),
        resolve, reject, target: options.target || "canvas", format: options.format || "video",
        owner: store.project, directory: String(store.projectDir || ""), cancelled: false,
        duration: stateRef.current?.duration || 0, settings: { width: settings.width, height: settings.height, fps: settings.fps },
        revision: String(stateRef.current?.native?.modifiedAt || ""),
      };
    });
    const pending = pendingExportRef.current!;
    pending.promise = promise;
    const runtime = runtimeRef.current;
    if (!runtime) { pendingExportRef.current = null; setExporting(false); pending.reject(new Error(t("ui.useOpenReelBridge.text.0956abbf"))); return promise; }
    void runtime.export({ format: options.format || "video", settings }).then(result => finishExport(pending, result.buffer)).catch(cause => {
      if (pendingExportRef.current === pending) pendingExportRef.current = null;
      setExporting(false);
      if (pending.cancelled) { setStatus(t("ui.useOpenReelBridge.text.c8feb7b4")); return; }
      const error = cause instanceof Error ? cause : new Error(String(cause));
      pending.reject(error); setError(error.message); setStatus(t("ui.useOpenReelBridge.text.cfdb6deb"));
    });
    return promise;
  }, [nodeId, refreshExportRecoveries, finishExport]);

  const cancelExport = useCallback(() => {
    const pending = pendingExportRef.current;
    if (pending) { pending.cancelled = true; pending.reject(new DOMException(t("ui.useOpenReelBridge.text.c8feb7b4"), "AbortError")); }
    runtimeRef.current?.cancelExport();
    setStatus(t("ui.useOpenReelBridge.text.0e4ed38b"));
  }, []);

  const openExportMenu = useCallback((anchor?: { x: number; y: number; top?: number }) => {
    setExportAnchor(anchor || { x: window.innerWidth - 24, y: 90 });
  }, []);

  const executeActions = useCallback(
    (
      actions: Array<{ type: string; params?: Record<string, unknown> }>,
      options: { validateOnly?: boolean; description?: string } = {},
    ) => {
      if (!readyRef.current) {
        return Promise.reject(new Error(t("ui.useOpenReelBridge.text.0956abbf")));
      }
      const runtime = runtimeRef.current;
      if (!runtime) return Promise.reject(new Error(t("ui.useOpenReelBridge.text.0956abbf")));
      return runtime.executeActions(actions, options).then(result => {
        if (runtimeRef.current !== runtime || closedRef.current) throw new Error(t("ui.useOpenReelBridge.text.4e25f151"));
        applyState(result.state); return result;
      });
    },
    [applyState],
  );

  /**
   * 画布卡片只渲染轨道：素材进了 运行时 的媒体库，卡片上什么也不会变。
   * 所以在画布模式下导入要顺手把片段排到对应轨道末尾，缺轨道就先建。
   */
  const placeMediaOnTimeline = useCallback(
    async (items: OpenReelImportedAsset[], sourceConnectionId?: string) => {
      const base = summaryRef.current;
      const { missingTracks } = planEditorMediaPlacement(base, items);
      const tracks = missingTracks.map((trackType) => ({ id: uid(), trackType }));
      // Track creation and placement must commit together: one undo removes the
      // entire addition, and a failed clip cannot leave an empty orphan track.
      const { clips } = planEditorMediaPlacement({ ...base, tracks: [
        ...base.tracks,
        ...tracks.map(({ id, trackType }) => ({ id, type: trackType === "image" ? "overlay" : trackType, clips: [] })),
      ] }, items);
      if (!clips.length) return;
      const result = await executeActions(
        [
          ...tracks.map(({ id, trackType }) => ({ type: "track/add", params: { trackId: id, trackType } })),
          ...clips.map((clip) => ({ type: "clip/add", params: { ...clip, ...(sourceConnectionId ? { sourceConnectionId } : {}) } })),
        ],
        { description: t("ui.useOpenReelBridge.description.0738fffa") },
      );
      if (!result.success) throw new Error(result.error || t("ui.useOpenReelBridge.text.7266c0b1"));
      applyState(result.state);
    },
    [applyState, executeActions],
  );

  const importSpecificAssets = useCallback(async (items: VideoEditorAsset[], placeOnTimeline = false) => {
    if (!items.length) return [];
    const owner = store.project;
    const directory = store.projectDir;
    const target = canvasNode ? owner.nodes.find((item: any) => item.id === nodeId) : null;
    const assertLive = () => {
      if (closedRef.current || store.project !== owner || store.projectDir !== directory ||
          (canvasNode && (!target || !owner.nodes.includes(target)))) {
        throw new Error(t("ui.useOpenReelBridge.text.9223ede1"));
      }
    };
    assertLive();
    if (!readyRef.current) throw new Error(t("ui.useOpenReelBridge.text.0956abbf"));
    const payloads = [];
    for (const item of items) {
      payloads.push(await buildAssetPayload(item));
      assertLive();
    }
    const runtime = runtimeRef.current;
    if (!runtime) throw new Error(t("ui.useOpenReelBridge.text.0956abbf"));
    const imported = await runtime.importAssets(payloads);
    assertLive();
    const withAssets = withSummaryAssets(summaryRef.current, items);
    summaryRef.current = withAssets;
    persistNow(withAssets);
    if (placeOnTimeline) await placeMediaOnTimeline(imported);
    return imported;
  }, [persistNow, placeMediaOnTimeline, canvasNode, nodeId]);

  const sourceOperationsRef = useRef({ executeActions, importSpecificAssets, placeMediaOnTimeline });
  sourceOperationsRef.current = { executeActions, importSpecificAssets, placeMediaOnTimeline };
  useEffect(() => {
    if (!canvasNode || !loaded) return;
    const owner = store.project;
    const node = () => store.project === owner ? owner.nodes.find((item: any) => item.id === nodeId) || null : null;
    const sync = new ClipSourceConnections({
      node,
      edges: () => owner.edges,
      setEdges(edges) { if (node()) { owner.edges = edges; touchProject(); } },
      sourceExists: (id) => owner.nodes.some((item: any) => item.id === id),
      async resolve(sourceId) {
        if (!node()) throw new Error(t("ui.useOpenReelBridge.text.9775679a"));
        const candidate = editorCanvasCandidate(sourceId);
        if (!candidate) throw new Error(t("ui.useOpenReelBridge.text.bda05b67"));
        return resolveEditorMediaAsset(candidate);
      },
      async importAsset(asset) {
        if (!node()) throw new Error(t("ui.useOpenReelBridge.text.9775679a"));
        const [item] = await sourceOperationsRef.current.importSpecificAssets([asset]);
        if (!item) throw new Error(t("ui.useOpenReelBridge.text.a7509a22"));
        return item;
      },
      place: (item, connectionId) => sourceOperationsRef.current.placeMediaOnTimeline([item], connectionId),
      async actions(actions, description) {
        if (!node()) throw new Error(t("ui.useOpenReelBridge.text.6f718756"));
        const result = await sourceOperationsRef.current.executeActions(actions, { description });
        if (!result.success) throw new Error(result.error || t("ui.useOpenReelBridge.text.758604c5"));
      },
      changed() { if (node()) touchProject({ sessionDelay: 300, coalesceSession: true }); },
      error(cause) { setError(cause.message); showToast(cause.message); },
    });
    sourceSyncRef.current = sync;
    if (stateRef.current) sync.observe(stateRef.current);
    const stop = subscribeDomain(() => { void sync.sync(); });
    void sync.sync();
    return () => { stop(); sync.dispose(); if (sourceSyncRef.current === sync) sourceSyncRef.current = null; };
  }, [canvasNode, loaded, nodeId]);

  /**
   * 「添加媒体」由宿主资源选择器承接：剪辑台里点添加不再弹操作系统文件框，
   * 候选集来自 services/editorMediaCatalog —— 与 Agent 的 video_project_media 同一份。
   * 本地上传是选择器里的一个显式入口，不是默认路径。
   */
  const openMediaPicker = useCallback(() => {
    if (!loadedRef.current) {
      showToast(t("ui.useOpenReelBridge.text.8464901d"));
      return;
    }
    setPickerOpen(true);
  }, []);

  const importCandidates = useCallback(
    async (keys: string[], placeOnTimeline = false) => {
      const owner = store.project;
      const isLive = () => !closedRef.current && store.project === owner &&
        (!canvasNode || owner.nodes.some((node: { id: string }) => node.id === nodeId));
      return importMediaBatch(keys.map((key) => ({ key, name: findEditorMediaCandidate(key)?.name || key, value: key })), {
        isLive,
        async import(key) {
          const candidate = findEditorMediaCandidate(key);
          if (!candidate) throw new Error(t("ui.useOpenReelBridge.text.f3926f51"));
          const asset = await resolveEditorMediaAsset(candidate);
          if (!isLive()) throw new Error(t("ui.useOpenReelBridge.text.f0a1603c"));
          const [item] = await importSpecificAssets([asset]);
          if (!item) throw new Error(t("ui.useOpenReelBridge.text.3612ebcf"));
          return item;
        },
        ...(placeOnTimeline ? { place: placeMediaOnTimeline } : {}),
      });
    },
    [canvasNode, nodeId, importSpecificAssets, placeMediaOnTimeline],
  );

  const confirmMediaPicker = useCallback(
    async (keys: string[]) => {
      if (mediaBusy) return;
      setMediaBusy(true);
      try {
        const result = await importCandidates(keys, true);
        const { imported, failures } = result;
        if (imported) {
          showToast(t("ui.useOpenReelBridge.text.13f41926", { value0: imported, value1: failures.length ? t("ui.useOpenReelBridge.text.5f97940c", { value0: failures.length }) : "" }));
        }
        if (!failures.length) setPickerOpen(false);
        return result;
      } catch (cause) {
        showToast(cause instanceof Error ? cause.message : t("ui.useOpenReelBridge.text.11f73aec"));
      } finally {
        setMediaBusy(false);
      }
    },
    [importCandidates, mediaBusy],
  );

  const uploadLocalMedia = useCallback(async () => {
    if (mediaBusy) return;
    setMediaBusy(true);
    try {
      const items = await controller.importDeviceFiles?.() || [];
      if (!items.length) return;
      await importSpecificAssets(items, true);
      showToast(t("ui.useOpenReelBridge.text.82abf72a", { value0: items.length }));
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : t("ui.useOpenReelBridge.text.5693eca9"));
    } finally {
      setMediaBusy(false);
    }
  }, [controller, importSpecificAssets, mediaBusy]);

  const flushSnapshot = useCallback(async () => {
    const state = await requestState(true);
    if (loadedRef.current && !state?.native) throw new Error(t("ui.useOpenReelBridge.text.37e0b92f"));
    if (state?.native) {
      stateRef.current = state;
      summaryRef.current = summaryFromNative(state, summaryRef.current);
      writerRef.current?.schedule({ ...state.native, shotloomSession: state.session });
    }
    persistNow();
    await writerRef.current?.flush();
  }, [persistNow, requestState]);

  const handleClose = useCallback(async () => {
    if (exporting || closedRef.current) return;
    try {
      const state = await requestState();
      if (state) applyState(state);
      persistNow();
      await writerRef.current?.flush();
      controller.close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      showToast(t("ui.useOpenReelBridge.text.ceeec5c7"));
    }
  }, [applyState, controller, exporting, persistNow, requestState]);

  const seek = useCallback((timeSec: number) => {
    void runtimeRef.current?.seek(timeSec).catch(cause => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  const play = useCallback(() => {
    void runtimeRef.current?.togglePlayback().catch(cause => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  const undo = useCallback(() => {
    void runtimeRef.current?.undo().then(state => applyState(state)).catch(cause => setError(cause instanceof Error ? cause.message : String(cause)));
    return true;
  }, [applyState]);

  const redo = useCallback(() => {
    void runtimeRef.current?.redo().then(state => applyState(state)).catch(cause => setError(cause instanceof Error ? cause.message : String(cause)));
    return true;
  }, [applyState]);

  const reloadFromSummary = useCallback(
    async (next: VideoEditorProject) => {
      summaryRef.current = next;
      persistNow(next);
      if (!readyRef.current) return;
      try {
        const { payload, warnings } = await buildLoadPayload(
          next,
          extraAssetsRef.current,
          null,
        );
        const runtime = runtimeRef.current;
        if (!runtime || closedRef.current) return;
        await runtime.load(payload);
        applyState(await runtime.getState());
        if (warnings.length) showToast(warnings.join("；"));
      } catch (cause) {
        showToast(cause instanceof Error ? cause.message : t("ui.useOpenReelBridge.text.91cfca99"));
      }
    },
    [applyState, persistNow],
  );

  const callbacksRef = useRef({ applyState, openMediaPicker, recoverMedia, openExportMenu, handleClose, controller, importSpecificAssets, startLoad, persistNow });
  callbacksRef.current = { applyState, openMediaPicker, recoverMedia, openExportMenu, handleClose, controller, importSpecificAssets, startLoad, persistNow };
  const runtimeCallbacks = useRef({
    onState: (state: OpenReelBridgeState) => callbacksRef.current.applyState(state),
    onStatus: (phase: string) => setStatus(phase),
    onError: (cause: Error) => { setError(cause.message); setStatus(t("ui.useOpenReelBridge.text.f5f12f1d")); },
    onExportProgress: (update: { phase: string; progress: number }) => {
      if (!pendingExportRef.current || pendingExportRef.current.cancelled || closedRef.current) return;
      setStatus(t("ui.useOpenReelBridge.text.b42af1e1", { value0: update.phase || "rendering" }));
      setProgress(Math.max(0, Math.min(1, Number(update.progress) || 0)));
    },
    requestImport: async () => { callbacksRef.current.openMediaPicker(); },
    requestRelink: async (mediaId: string) => { await callbacksRef.current.recoverMedia(mediaId); },
    requestExport: async (options: { anchor?: { x: number; y: number; top?: number } }) => {
      callbacksRef.current.controller.activate?.(); callbacksRef.current.openExportMenu(options.anchor);
    },
    requestExpand: () => callbacksRef.current.controller.expand?.(),
    requestActivate: () => callbacksRef.current.controller.activate?.(),
    requestClose: () => { void callbacksRef.current.handleClose(); },
    ingestFiles: async (files: Array<{ name: string; mime?: string; bytes: ArrayBuffer }>) => {
      const owner = store.project;
      const runtime = runtimeRef.current;
      const assets = await callbacksRef.current.controller.ingestEditorFiles?.(files);
      if (!assets?.length) throw new Error(t("ui.useOpenReelBridge.text.9938ad21"));
      const payloads = await Promise.all(assets.map(buildAssetPayload));
      if (closedRef.current || store.project !== owner || runtimeRef.current !== runtime ||
          (canvasNode && !owner.nodes.some((item: any) => item.id === nodeId))) throw new Error(t("ui.useOpenReelBridge.text.9223ede1"));
      summaryRef.current = withSummaryAssets(summaryRef.current, assets);
      callbacksRef.current.persistNow();
      return payloads;
    },
  }).current;
  const bindRuntime = useCallback((runtime: ClipStudioRuntimeController | null) => {
    if (runtimeRef.current === runtime) return;
    runtimeRef.current = runtime;
    readyRef.current = Boolean(runtime);
    loadedRef.current = false;
    loadStartedRef.current = false;
    setLoaded(false);
    if (!runtime) return;
    catalogRef.current = runtime.getActionCatalog();
    setCatalog(catalogRef.current);
    void callbacksRef.current.startLoad();
  }, []);

  useEffect(() => {
    if (!active || !loaded) return;
    return registerActiveVideoEditor({
      projectKey: getAgentProjectKey(),
      nodeId,
      read: () => summaryRef.current,
      commit: (next: VideoEditorProject) => {
        void reloadFromSummary(next);
      },
      playhead: () => stateRef.current?.playhead || 0,
      selectedClipId: () => stateRef.current?.selectedClipIds[0] || "",
      seek,
      undo,
      redo,
      canUndo: () => stateRef.current?.canUndo === true,
      canRedo: () => stateRef.current?.canRedo === true,
      exportProject: (_project, requestKey) => handleExport(requestKey ? { requestKey } : {}),
      refreshState: async () => {
        const next = await requestState();
        if (next) applyState(next);
      },
      native: () => stateRef.current?.native || null,
      actionCatalog: () => catalogRef.current,
      executeNativeTool: async (name, input) => {
        const runtime = runtimeRef.current;
        if (!runtime) throw new Error(t("ui.useOpenReelBridge.text.588d88c1"));
        const result = await runtime.executeNativeTool(name, input);
        await flushSnapshot();
        return result;
      },
      executeActions,
      importAsset: async (asset: VideoEditorAsset) => {
        const [imported] = await importSpecificAssets([asset]);
        return imported || null;
      },
    });
  }, [active, loaded, applyState, executeActions, handleExport, importSpecificAssets, nodeId, redo, reloadFromSummary, requestState, seek, undo]);

  useEffect(() => {
    closedRef.current = false;
    return () => {
      closedRef.current = true;
      runtimeRef.current?.cancelExport();
      const pending = pendingExportRef.current;
      if (pending) { pending.cancelled = true; pending.reject(new Error(t("ui.useOpenReelBridge.text.4e25f151"))); }
      pendingExportRef.current = null;
      if (persistTimerRef.current) window.clearTimeout(persistTimerRef.current);
    };
  }, []);

  useEffect(() => {
    runtimeRef.current?.setPresentation(expanded ? "editor" : "canvas", canvasNode && !expanded ? CLIP_NODE_LAYOUT : undefined);
    runtimeRef.current?.setActive(active);
  }, [active, expanded, loaded, canvasNode]);

  return {
    bindRuntime,
    runtimeCallbacks,
    status,
    error,
    progress,
    exporting,
    loaded,
    dismissError: () => setError(""),
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    catalog,
    pickerOpen,
    mediaBusy,
    saveStatus,
    saveError,
    loadError,
    retrying,
    retryPersistence,
    exportRecoveries,
    retryExportDelivery,
    endExportRecovery,
    offlineMedia,
    relinkError,
    relinking,
    recoverMedia,
    deliveryBusy,
    handleClose,
    handleExport,
    cancelExport,
    exportAnchor,
    openExportMenu,
    closeExportMenu: () => setExportAnchor(null),
    exportProject: summaryRef.current,
    openMediaPicker,
    closeMediaPicker: () => setPickerOpen(false),
    confirmMediaPicker,
    uploadLocalMedia,
    executeActions,
    seek,
    play,
    undo,
    redo,
    requestState,
    persistNow,
    flushSnapshot,
  };
}
