import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  createOpenVideoStudioProject,
} from "../../services/openVideoRuntime.js";
import {
  editorClipDuration,
  normalizeVideoEditorProject,
  updateEditorTrack,
  videoEditorDuration,
} from "../../utils/videoEditorProject.mjs";
import "./VideoEditorWorkspace.css";
import type {
  VideoEditorAsset,
  VideoEditorProject,
} from "./videoEditorTypes";
import { VideoEditorInspector } from "./VideoEditorInspector";
import {
  applyBuiltInStickerSources,
  builtInStickers,
} from "./videoEditorCatalog";
import {
  VideoEditorImportBrowser,
  VideoEditorToolRail,
  VideoEditorTopBar,
} from "./VideoEditorChrome";
import { VideoEditorTimeline } from "./VideoEditorTimeline";
import { VideoEditorMonitor } from "./VideoEditorMonitor";
import { VideoEditorToolPanel } from "./VideoEditorToolPanel";
import { useVideoEditorMediaUrls } from "./useVideoEditorMediaUrls";
import { useVideoEditorCommands } from "./useVideoEditorCommands";
import { useVideoEditorGestures } from "./useVideoEditorGestures";
import { useVideoEditorProjectHistory } from "./useVideoEditorProjectHistory";
import { useVideoEditorRuntime } from "./useVideoEditorRuntime";
import { useVideoEditorShortcuts } from "./useVideoEditorShortcuts";
import { useVideoEditorSourcePreview } from "./useVideoEditorSourcePreview";
import { useVideoEditorTimeline } from "./useVideoEditorTimeline";
import type { VideoEditorRuntime } from "./videoEditorRuntimeTypes";

type EditorProject = VideoEditorProject;
export type { VideoEditorAsset } from "./videoEditorTypes";
export interface VideoEditorController {
  persist: (project: EditorProject) => void;
  export: (project: EditorProject) => Promise<unknown>;
  close: () => void;
  importAssets?: (
    source?: "device" | "library" | "local" | "files",
  ) => Promise<VideoEditorAsset[]>;
}
export interface VideoEditorWorkspaceProps {
  title?: string;
  project?: Record<string, unknown>;
  sourceFile: string;
  sourceUrl: string;
  sourceName?: string;
  metadata?: {
    duration?: number;
    width?: number;
    height?: number;
    videoWidth?: number;
    videoHeight?: number;
  };
  assets?: VideoEditorAsset[];
  controller: VideoEditorController;
}

const createId = (prefix = "item") =>
  `${prefix}-${Date.now().toString(36)}-${
    Math.random().toString(36).slice(2, 7)
  }`;
export function VideoEditorWorkspace(
  {
    title = "视频剪辑",
    project: savedProject,
    sourceFile,
    sourceUrl,
    sourceName = "video.mp4",
    metadata,
    assets = [],
    controller,
  }: VideoEditorWorkspaceProps,
) {
  const initial = useMemo(() =>
    applyBuiltInStickerSources(normalizeVideoEditorProject(savedProject, {
      sourceFile,
      sourceUrl,
      sourceName,
      duration: metadata?.duration || 0,
      width: metadata?.videoWidth || metadata?.width || 1920,
      height: metadata?.videoHeight || metadata?.height || 1080,
      createId,
    }) as EditorProject), []);
  const {
    project,
    projectRef,
    setProject,
    commit,
    recordHistory,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useVideoEditorProjectHistory(initial, controller);
  const [activeTool, setActiveTool] = useState("media");
  const [selectedId, setSelectedId] = useState("");
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const runtimeMediaUrls = useVideoEditorMediaUrls(project.assets);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [textNotice, setTextNotice] = useState("");
  const [toolNotice, setToolNotice] = useState("");
  const [importMenu, setImportMenu] = useState<"all" | "image" | "">("");
  const [importBrowser, setImportBrowser] = useState<{
    title: string;
    items: VideoEditorAsset[];
    kind: "all" | "image";
    loading: boolean;
  } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const monitorRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<VideoEditorRuntime | null>(null);
  const runtimeMutationRef = useRef(false);
  const duration = videoEditorDuration(project);
  const {
    timelineRef,
    zoom,
    viewport: timelineViewport,
    changeZoom,
    setViewport: setTimelineViewport,
  } = useVideoEditorTimeline(duration);
  const {
    fallbackRef,
    playbackUrl,
    sourceThumbnail,
    sourceState,
    usesNativeSequencePreview,
    preferFallbackPreview,
    primaryVideoAssetId,
    nativePreviewClip,
    nativePreviewAsset,
    nativePreviewUrl,
    previewAudio,
    togglePlayback,
    seekPreview,
    continueNativeSequence,
    captureSourceThumbnail,
    primeSourcePreview,
    sourceLoaded,
    sourceFailed,
  } = useVideoEditorSourcePreview({
    initialProject: initial,
    project,
    projectRef,
    setProject,
    runtimeRef,
    runtimeMediaUrls,
    sourceFile,
    sourceUrl,
    sourceName,
    metadata,
    duration,
    time,
    playing,
    setTime,
    setPlaying,
    controller,
  });
  const activeTextClips = useMemo(
    () => project.tracks
      .filter((track) => track.type === "text" && !track.hidden)
      .flatMap((track) => track.clips)
      .filter((clip) =>
        clip.id === selectedId || (
          time >= clip.timelineStart &&
          time <= clip.timelineStart + editorClipDuration(clip)
        )
      ),
    [project.tracks, selectedId, time],
  );
  const activeImageClips = useMemo(
    () => project.tracks
      .filter((track) => track.type === "overlay" && !track.hidden)
      .flatMap((track) => track.clips)
      .filter((clip) =>
        time >= clip.timelineStart &&
        time <= clip.timelineStart + editorClipDuration(clip)
      ),
    [project.tracks, time],
  );
  const allAssets = useMemo(
    () => [
      ...project.assets,
      ...assets.filter((asset) =>
        !project.assets.some((item) => item.id === asset.id)
      ),
    ],
    [assets, project.assets],
  );
  const stickerAssets = useMemo(
    () => [
      ...builtInStickers,
      ...allAssets.filter((asset) =>
        asset.type === "image" &&
        !builtInStickers.some((sticker) => sticker.id === asset.id)
      ),
    ],
    [allAssets],
  );
  const createStudioProject = useCallback((value: EditorProject) => {
    return createOpenVideoStudioProject({
      ...value,
      assets: value.assets.map((asset) =>
        ({
          ...asset,
          sourceUrl: runtimeMediaUrls[asset.id] ||
            (asset.id === primaryVideoAssetId ? playbackUrl : asset.sourceUrl),
        })
      ),
    });
  }, [playbackUrl, primaryVideoAssetId, runtimeMediaUrls]);
  const {
    beginVisualTransform,
    beginTimelineDrag,
    onRuntimeTransformStart,
    onRuntimeTransformEnd,
    visualTransformRef,
    timelineDragRef,
  } = useVideoEditorGestures({
    projectRef,
    setProject,
    monitorRef,
    runtimeRef,
    runtimeMutationRef,
    zoom,
    time,
    controller,
    createStudioProject,
    recordHistory,
    setSelectedId,
    seekPreview,
  });
  const {
    engineReady,
    engineError,
    setEngineError,
  } = useVideoEditorRuntime({
    canvasRef,
    project,
    projectRef,
    selectedId,
    time,
    playbackUrl,
    sourceState,
    preferFallbackPreview,
    runtimeRef,
    runtimeMutationRef,
    timelineDragRef,
    visualTransformRef,
    createStudioProject,
    setTime,
    setPlaying,
    setSelectedId,
    onTransformStart: onRuntimeTransformStart,
    onTransformEnd: onRuntimeTransformEnd,
  });
  const visibleTracks = useMemo(
    () => project.tracks.filter((track) =>
      track.clips.length > 0 || ["video", "audio"].includes(track.type)
    ),
    [project.tracks],
  );
  const videoClips = useMemo(
    () => project.tracks
      .filter((track) => track.type === "video" && !track.hidden)
      .flatMap((track) => track.clips)
      .sort((left, right) => left.timelineStart - right.timelineStart),
    [project.tracks],
  );
  const {
    selected,
    addAsset,
    activateAsset,
    addText,
    addTransition,
    addEffect,
    updateSelected,
    runCanvasAction,
    deleteSelected,
    deleteAsset,
    duplicateSelected,
    splitSelected,
  } = useVideoEditorCommands({
    project,
    projectRef,
    selectedId,
    setSelectedId,
    time,
    duration,
    videoClips,
    runtimeRef,
    runtimeMutationRef,
    createStudioProject,
    commit,
    seekPreview,
    setTextNotice,
    setToolNotice,
  });
  async function exportProject() {
    if (exporting) return;
    setExporting(true);
    setExportError("");
    runtimeRef.current?.pause();
    setPlaying(false);
    try {
      await controller.export(projectRef.current);
    } catch (cause) {
      const message = cause instanceof Error
        ? cause.message
        : typeof cause === "string"
        ? cause
        : cause && typeof cause === "object" && "message" in cause
        ? String((cause as { message: unknown }).message)
        : "导出失败";
      setExportError(message);
    } finally {
      setExporting(false);
    }
  }

  useEffect(() => {
    document.body.classList.add("video-editor-open");
    return () => {
      document.body.classList.remove("video-editor-open");
    };
  }, []);
  useVideoEditorShortcuts({
    exporting,
    onClose: () => controller.close(),
    onTogglePlayback: () => void togglePlayback(),
    onSplit: splitSelected,
    onDelete: deleteSelected,
    onUndo: undo,
    onRedo: redo,
  });
  async function importFrom(source: "device" | "library" | "local" | "files") {
    const kind = importMenu || "all";
    setImportMenu("");
    if (source === "device") {
      const items = await controller.importAssets?.("device") || [];
      const accepted = kind === "image" ? items.filter((item) => item.type === "image") : items;
      if (kind === "image" && !accepted.length && items.length) {
        setToolNotice("请选择 PNG、JPG、WebP 或 GIF 图片作为贴图。");
      }
      accepted.forEach(addAsset);
      return;
    }
    const labels = {
      library: "项目素材",
      local: "通用素材库",
      files: "素材文件",
    };
    setImportBrowser({ title: labels[source], items: [], kind, loading: true });
    const items = await controller.importAssets?.(source) || [];
    const accepted = kind === "image" ? items.filter((item) => item.type === "image") : items;
    setImportBrowser({ title: labels[source], items: accepted, kind, loading: false });
  }

  return createPortal(
    <section
      className="ov-editor"
      role="dialog"
      aria-modal="true"
      aria-label="视频编辑器"
    >
      <VideoEditorTopBar
        title={title}
        trackCount={project.tracks.length}
        canUndo={canUndo}
        canRedo={canRedo}
        exporting={exporting}
        exportDisabled={!duration}
        exportError={exportError}
        onUndo={undo}
        onRedo={redo}
        onResetView={() => runtimeRef.current?.resetView()}
        onClose={controller.close}
        onExport={() => void exportProject()}
      />
      <VideoEditorImportBrowser
        browser={importBrowser}
        onClose={() => setImportBrowser(null)}
        onImport={(asset) => {
          addAsset(asset);
          setImportBrowser(null);
        }}
      />
      <main className="ov-stage">
        <VideoEditorToolRail
          activeTool={activeTool}
          onSelect={(toolId) => {
            setActiveTool(toolId);
            setToolNotice("");
          }}
        />
        <aside className="ov-library">
          <VideoEditorToolPanel
            activeTool={activeTool}
            allAssets={allAssets}
            stickerAssets={stickerAssets}
            importMenu={importMenu}
            textNotice={textNotice}
            toolNotice={toolNotice}
            videoClipCount={videoClips.length}
            primaryVideoAssetId={primaryVideoAssetId}
            sourceThumbnail={sourceThumbnail}
            playbackUrl={playbackUrl}
            runtimeMediaUrls={runtimeMediaUrls}
            onToggleImportMenu={(kind) => setImportMenu(importMenu ? "" : kind)}
            onImport={(source) => void importFrom(source)}
            onActivateAsset={activateAsset}
            onDeleteAsset={deleteAsset}
            onCaptureThumbnail={captureSourceThumbnail}
            onAddText={addText}
            onAddAsset={addAsset}
            onAddTransition={addTransition}
            onAddEffect={addEffect}
          />
        </aside>
        <VideoEditorMonitor
          project={project}
          canvasRef={canvasRef}
          monitorRef={monitorRef}
          fallbackRef={fallbackRef}
          engineReady={engineReady}
          engineError={engineError}
          sourceState={sourceState}
          preferFallbackPreview={preferFallbackPreview}
          usesNativeSequencePreview={usesNativeSequencePreview}
          nativePreviewClip={nativePreviewClip}
          nativePreviewAsset={nativePreviewAsset}
          primaryVideoAssetId={primaryVideoAssetId}
          nativePreviewUrl={nativePreviewUrl}
          playbackUrl={playbackUrl}
          previewAudio={previewAudio}
          time={time}
          duration={duration}
          playing={playing}
          sourceThumbnail={sourceThumbnail}
          activeImageClips={activeImageClips}
          activeTextClips={activeTextClips}
          assets={allAssets}
          selectedId={selectedId}
          onSourceLoaded={sourceLoaded}
          onCaptureThumbnail={captureSourceThumbnail}
          onPrimeSourcePreview={primeSourcePreview}
          onSourceFailed={() => void sourceFailed()}
          onSetEngineError={setEngineError}
          onSetPlaying={setPlaying}
          onSetTime={setTime}
          onContinueSequence={continueNativeSequence}
          onBeginTransform={beginVisualTransform}
          onFramePrevious={() => {
            if (runtimeRef.current && !preferFallbackPreview) {
              void runtimeRef.current.framePrev();
            } else {
              seekPreview(time - 1 / project.settings.fps);
            }
          }}
          onFrameNext={() => {
            if (runtimeRef.current && !preferFallbackPreview) {
              void runtimeRef.current.frameNext();
            } else {
              seekPreview(time + 1 / project.settings.fps);
            }
          }}
          onTogglePlayback={() => void togglePlayback()}
          onSplit={splitSelected}
          onSeek={(nextTime) => {
            setTime(nextTime);
            seekPreview(nextTime);
          }}
          onResetView={() => runtimeRef.current?.resetView()}
        />
        <VideoEditorInspector
          selected={selected}
          project={project}
          onUpdate={updateSelected}
          onDelete={deleteSelected}
          onDuplicate={duplicateSelected}
          onCanvasAction={(action) => void runCanvasAction(action)}
        />
      </main>
      <VideoEditorTimeline
        timelineRef={timelineRef}
        duration={duration}
        zoom={zoom}
        fps={project.settings.fps}
        time={time}
        tracks={visibleTracks}
        assets={allAssets}
        selectedId={selectedId}
        viewport={timelineViewport}
        runtimeMediaUrls={runtimeMediaUrls}
        primaryVideoAssetId={primaryVideoAssetId}
        playbackUrl={playbackUrl}
        sourceThumbnail={sourceThumbnail}
        onSplit={splitSelected}
        onDuplicate={duplicateSelected}
        onDelete={deleteSelected}
        onZoomChange={changeZoom}
        onViewportChange={setTimelineViewport}
        onSeek={(nextTime) => {
          setTime(nextTime);
          seekPreview(nextTime);
        }}
        onToggleTrack={(trackId, field, value) => {
          commit(updateEditorTrack(projectRef.current, trackId, { [field]: value }));
        }}
        onClipPointerDown={beginTimelineDrag}
      />
    </section>,
    document.body,
  );
}
