import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  createOpenVideoRuntime,
  createOpenVideoStudioProject,
  getOpenVideoRuntimeSupport,
} from "../../services/openVideoRuntime.js";
import {
  addEditorClip,
  addEditorTrack,
  activeEditorClip,
  editorClipDuration,
  findEditorClip,
  normalizeVideoEditorProject,
  removeEditorClip,
  snapEditorClipStart,
  updateEditorClip,
  updateEditorTrack,
  videoEditorDuration,
} from "../../utils/videoEditorProject.mjs";
import { editorMediaMimeType } from "../../utils/editorMediaImport.mjs";
import { desktopApi } from "../../services/desktopApi.js";
import { IconSymbol } from "../components/IconSymbol";
import "./VideoEditorWorkspace.css";
import { constrainTransformToCanvas, hydrateSourceProject } from "./videoEditorModel";
import type {
  VideoEditorAsset,
  VideoEditorClip,
  VideoEditorProject,
  VideoEditorTransform,
} from "./videoEditorTypes";
import {
  VideoEditorInspector,
} from "./VideoEditorWorkspaceParts";
import {
  applyBuiltInStickerSources,
  builtInStickers,
  effects,
  textPresets,
  transitions,
} from "./videoEditorCatalog";
import {
  VideoEditorImportBrowser,
  VideoEditorToolRail,
  VideoEditorTopBar,
} from "./VideoEditorChrome";
import { VideoEditorTimeline } from "./VideoEditorTimeline";
import { VideoEditorToolPanel } from "./VideoEditorToolPanel";
import { formatEditorTime, formatEditorTimecode } from "./videoEditorFormat";
import { useVideoEditorMediaUrls } from "./useVideoEditorMediaUrls";
import { useVideoEditorProjectHistory } from "./useVideoEditorProjectHistory";
import { useVideoEditorTimeline } from "./useVideoEditorTimeline";

type EditorProject = VideoEditorProject;
type EditorClip = VideoEditorClip;
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

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
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
  const [engineReady, setEngineReady] = useState(false);
  const [engineError, setEngineError] = useState("");
  const initialVideoClip = initial.tracks
    .find((track: any) => track.type === "video")?.clips
    .find((clip: any) => clip.type === "video");
  const initialPlaybackAsset = initial.assets.find((asset: any) =>
    asset.id === initialVideoClip?.assetId
  ) || initial.assets.find((asset: any) => asset.type === "video");
  const [playbackUrl, setPlaybackUrl] = useState(
    initialPlaybackAsset?.sourceUrl || sourceUrl,
  );
  const runtimeMediaUrls = useVideoEditorMediaUrls(project.assets);
  const [sourceThumbnail, setSourceThumbnail] = useState("");
  const [sourceState, setSourceState] = useState<"empty" | "loading" | "ready" | "error">(
    initialPlaybackAsset?.sourceUrl || sourceUrl ? "loading" : "empty",
  );
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
  const fallbackRef = useRef<HTMLVideoElement>(null);
  const blobUrlRef = useRef("");
  const sourceFallbackPendingRef = useRef(false);
  const sourcePreviewPrimedRef = useRef(false);
  const runtimeRef = useRef<any>(null);
  const runtimeMutationRef = useRef(false);
  const canvasTransformSnapshotRef = useRef<EditorProject | null>(null);
  const visualTransformRef = useRef<{
    id: string;
    mode: "move" | "resize" | "rotate";
    startX: number;
    startY: number;
    transform: VideoEditorTransform;
    snapshot: EditorProject;
    monitor: DOMRect;
    startPointerAngle: number;
    clipType: string;
    fontSize: number;
    moved: boolean;
  } | null>(null);
  const dragRef = useRef<
    {
      id: string;
      startX: number;
      timelineStart: number;
      snapshot?: EditorProject;
    } | null
  >(null);
  const duration = videoEditorDuration(project);
  const {
    timelineRef,
    zoom,
    viewport: timelineViewport,
    changeZoom,
    setViewport: setTimelineViewport,
  } = useVideoEditorTimeline(duration);
  const selected = selectedId ? findEditorClip(project, selectedId) : null;
  const directPreviewClips = project.tracks
    .filter((track: any) => track.type === "video" && !track.hidden)
    .flatMap((track: any) => track.clips)
    .filter((clip: any) => clip.type === "video")
    .sort((left: any, right: any) => left.timelineStart - right.timelineStart);
  const directPreviewClip = directPreviewClips.length === 1
    ? directPreviewClips[0]
    : null;
  const usesNativeSequencePreview = directPreviewClips.length > 1;
  const preferFallbackPreview = sourceState === "ready" &&
    (usesNativeSequencePreview || (
      directPreviewClip?.timelineStart === 0 &&
      directPreviewClip?.trimStart === 0 &&
      directPreviewClip?.speed === 1 &&
      Math.abs(editorClipDuration(directPreviewClip) - duration) < .001 &&
      !project.tracks.some((track: any) =>
        ["overlay", "effect", "transition"].includes(track.type) &&
        track.clips.length > 0
      )
    ));
  const activeTextClips = useMemo(
    () => project.tracks
      .filter((track: any) => track.type === "text" && !track.hidden)
      .flatMap((track: any) => track.clips)
      .filter((clip: any) =>
        clip.id === selectedId || (
          time >= clip.timelineStart &&
          time <= clip.timelineStart + editorClipDuration(clip)
        )
      ),
    [project.tracks, selectedId, time],
  );
  const activeImageClips = useMemo(
    () => project.tracks
      .filter((track: any) => track.type === "overlay" && !track.hidden)
      .flatMap((track: any) => track.clips)
      .filter((clip: any) =>
        time >= clip.timelineStart &&
        time <= clip.timelineStart + editorClipDuration(clip)
      ),
    [project.tracks, time],
  );
  const allAssets = useMemo(
    () => [
      ...project.assets,
      ...assets.filter((asset) =>
        !project.assets.some((item: any) => item.id === asset.id)
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
  const primaryVideoAssetId = project.tracks
    .find((track: any) => track.type === "video")?.clips
    .find((clip: any) => clip.type === "video")?.assetId ||
    project.assets.find((asset: any) => asset.type === "video")?.id;
  const primaryVideoAsset = project.assets.find((asset: any) =>
    asset.id === primaryVideoAssetId
  );
  const nativePreviewClip = usesNativeSequencePreview
    ? activeEditorClip(directPreviewClips, time) ||
      (time >= duration - .001 ? directPreviewClips.at(-1) : null)
    : directPreviewClip;
  const nativePreviewAsset = project.assets.find((asset: any) =>
    asset.id === nativePreviewClip?.assetId
  );
  const nativePreviewUrl = nativePreviewAsset
    ? runtimeMediaUrls[nativePreviewAsset.id] || nativePreviewAsset.sourceUrl
    : playbackUrl;
  const createStudioProject = useCallback((value: EditorProject) => {
    return createOpenVideoStudioProject({
      ...value,
      assets: value.assets.map((asset: any) =>
        ({
          ...asset,
          sourceUrl: runtimeMediaUrls[asset.id] ||
            (asset.id === primaryVideoAssetId ? playbackUrl : asset.sourceUrl),
        })
      ),
    });
  }, [playbackUrl, primaryVideoAssetId, runtimeMediaUrls]);
  const visibleTracks = useMemo(
    () => project.tracks.filter((track: any) =>
      track.clips.length > 0 || ["video", "audio"].includes(track.type)
    ),
    [project.tracks],
  );
  const videoClips = useMemo(
    () => project.tracks
      .filter((track: any) => track.type === "video" && !track.hidden)
      .flatMap((track: any) => track.clips)
      .sort((left: any, right: any) => left.timelineStart - right.timelineStart),
    [project.tracks],
  );
  const previewAudio = useMemo(() => {
    for (const track of project.tracks) {
      if (track.type !== "video" || track.hidden) continue;
      const clip = activeEditorClip(track.clips, time);
      if (!clip) continue;
      return {
        muted: track.muted === true || clip.muted === true,
        volume: Math.max(0, Math.min(1, Number(clip.volume ?? 1))),
      };
    }
    return { muted: false, volume: 1 };
  }, [project.tracks, time]);
  const playbackStructureSignature = useMemo(() => JSON.stringify({
    settings: {
      width: project.settings.width,
      height: project.settings.height,
      fps: project.settings.fps,
    },
    tracks: project.tracks.map((track: any) => ({
      id: track.id,
      type: track.type,
      hidden: track.hidden,
      clips: track.clips.map((clip: any) => ({
        id: clip.id,
        type: clip.type,
        assetId: clip.assetId,
        timelineStart: clip.timelineStart,
        trimStart: clip.trimStart,
        trimEnd: clip.trimEnd,
        duration: clip.duration,
        speed: clip.speed,
        fromClipId: clip.fromClipId,
        toClipId: clip.toClipId,
      })),
    })),
  }), [project.settings, project.tracks]);

  const ensureTrack = (type: string, name: string) => {
    const current = projectRef.current;
    const existing = current.tracks.find((track: any) => track.type === type);
    if (existing) {
      if (!existing.locked && !existing.hidden) {
        return { project: current, track: existing };
      }
      const next = updateEditorTrack(current, existing.id, {
        locked: false,
        hidden: false,
      });
      return {
        project: next,
        track: next.tracks.find((track: any) => track.id === existing.id),
      };
    }
    const next = addEditorTrack(current, type, name, createId);
    return { project: next, track: next.tracks.at(-1) };
  };
  function addClip(
    type: string,
    payload: Record<string, unknown>,
    trackType: string,
    trackName: string,
  ) {
    const ensured = ensureTrack(trackType, trackName);
    const clipId = String(payload.id || createId("clip"));
    const next = addEditorClip(ensured.project, ensured.track.id, {
      id: clipId,
      type,
      timelineStart: Math.min(time, duration),
      ...payload,
    }, createId);
    const added = next.tracks.find((track: any) =>
      track.id === ensured.track.id
    )?.clips.find((clip: any) => clip.id === clipId);
    commit(next);
    if (added) setSelectedId(added.id);
    return added || null;
  }
  function clipFocusTime(clip: EditorClip) {
    const start = Math.max(0, Number(clip.timelineStart) || 0);
    const clipDuration = editorClipDuration(clip);
    if (clip.type !== "video" && clip.type !== "audio") return start;
    return Math.min(
      start + Math.max(0, clipDuration - .001),
      start + 1 / projectRef.current.settings.fps,
    );
  }
  function addAsset(asset: VideoEditorAsset) {
    const mediaDuration = Number(asset.duration);
    if (asset.type !== "image" && (!Number.isFinite(mediaDuration) || mediaDuration <= 0)) {
      setToolNotice(`“${asset.name}”读取失败，无法添加到时间线。`);
      return;
    }
    if (asset.type !== "image") {
      const matchingAssetIds = new Set(
        projectRef.current.assets
          .filter((item: any) =>
            item.id === asset.id ||
            (asset.sourceFile && item.sourceFile === asset.sourceFile)
          )
          .map((item: any) => item.id),
      );
      const existing = projectRef.current.tracks
        .flatMap((track: any) => track.clips)
        .find((clip: any) => matchingAssetIds.has(clip.assetId));
      if (existing) {
        setSelectedId(existing.id);
        seekPreview(clipFocusTime(existing));
        setToolNotice(`已定位到“${asset.name}”在时间线中的片段。`);
        return;
      }
    }
    let next = projectRef.current;
    if (!next.assets.some((item: any) => item.id === asset.id)) {
      next = { ...next, assets: [...next.assets, clone(asset)] };
    }
    const trackType = asset.type === "audio"
      ? "audio"
      : asset.type === "image"
      ? "overlay"
      : "video";
    const trackName = asset.type === "audio"
      ? "音乐与音效"
      : asset.type === "image"
      ? "贴图"
      : "补充画面";
    let track = next.tracks.find((item: any) => item.type === trackType);
    if (!track) {
      next = addEditorTrack(next, trackType, trackName, createId);
      track = next.tracks.at(-1);
    } else if (track.locked || track.hidden) {
      const trackId = track.id;
      next = updateEditorTrack(next, trackId, { locked: false, hidden: false });
      track = next.tracks.find((item: any) => item.id === trackId);
    }
    if (!track) {
      setToolNotice("无法创建素材轨道，请重试。");
      return;
    }
    const trimEnd = mediaDuration || 0;
    const clipId = createId("clip");
    const imageDuration = 4;
    const imageStart = duration > 0
      ? Math.min(time, Math.max(0, duration - imageDuration))
      : 0;
    const videoStart = asset.type === "video"
      ? Math.max(
        0,
        ...track.clips.map((clip: any) =>
          Number(clip.timelineStart) + editorClipDuration(clip)
        ),
      )
      : Math.min(time, duration);
    const canvasWidth = next.settings.width;
    const canvasHeight = next.settings.height;
    const sourceWidth = Math.max(1, Number(asset.width) || 512);
    const sourceHeight = Math.max(1, Number(asset.height) || 512);
    const imageScale = Math.min(
      canvasWidth * .28 / sourceWidth,
      canvasHeight * .36 / sourceHeight,
      1,
    );
    const imageWidth = Math.max(80, sourceWidth * imageScale);
    const imageHeight = Math.max(80, sourceHeight * imageScale);
    next = addEditorClip(
      next,
      track.id,
      asset.type === "image"
        ? {
          id: clipId,
          type: "image",
          assetId: asset.id,
          src: asset.sourceUrl,
          timelineStart: imageStart,
          duration: duration > 0
            ? Math.max(.08, Math.min(imageDuration, duration - imageStart))
            : imageDuration,
          transform: {
            x: (canvasWidth - imageWidth) / 2,
            y: (canvasHeight - imageHeight) / 2,
            width: imageWidth,
            height: imageHeight,
            angle: 0,
            opacity: 1,
            zIndex: 30,
            flip: { x: false, y: false },
          },
        }
        : {
          id: clipId,
          type: asset.type,
          assetId: asset.id,
          timelineStart: videoStart,
          trimStart: 0,
          trimEnd,
          speed: 1,
          muted: false,
        },
      createId,
    );
    const added = next.tracks.find((item: any) => item.id === track.id)?.clips
      .find((clip: any) => clip.id === clipId);
    commit(next);
    if (added) {
      setSelectedId(added.id);
      if (asset.type === "image") {
        seekPreview(imageStart + Math.min(.05, editorClipDuration(added) / 2));
        setToolNotice(`“${asset.name}”已添加到画面中央，可在画布拖动、缩放或旋转。`);
      } else if (asset.type === "video") {
        seekPreview(clipFocusTime(added));
        setToolNotice(`“${asset.name}”已追加到视频轨末尾。`);
      }
    } else {
      setToolNotice(
        asset.type === "image"
          ? "贴图添加失败，请重试。"
          : `“${asset.name}”读取失败，无法添加到时间线。`,
      );
    }
  }
  function activateAsset(asset: VideoEditorAsset) {
    const existing = projectRef.current.tracks
      .flatMap((track: any) => track.clips)
      .find((clip: any) => clip.assetId === asset.id);
    if (!existing) {
      addAsset(asset);
      return;
    }
    setSelectedId(existing.id);
    seekPreview(clipFocusTime(existing));
    setToolNotice(`已定位到“${asset.name}”。`);
  }
  function addText(preset = textPresets[0]) {
    const canvasWidth = projectRef.current.settings.width;
    const canvasHeight = projectRef.current.settings.height;
    const textWidth = Math.min(1200, canvasWidth * .76);
    const start = duration > 0
      ? Math.min(time, Math.max(0, duration - 3))
      : 0;
    const added = addClip(
      "text",
      {
        timelineStart: start,
        duration: Math.max(.1, Math.min(3, duration - start || 3)),
        text: preset.sample,
        style: {
          fontSize: preset.fontSize,
          fontFamily: preset.fontFamily,
          fontWeight: preset.fontWeight,
          color: "#ffffff",
          background: {
            color: "#000000",
            opacity: 0,
            borderRadius: 0,
            paddingX: 0,
            paddingY: 0,
          },
          align: "center",
          stroke: { color: "#000000", width: 0 },
        },
        transform: {
          x: (canvasWidth - textWidth) / 2,
          y: canvasHeight * preset.y,
          width: textWidth,
          height: Math.max(120, canvasHeight * .14),
          angle: 0,
          opacity: 1,
          zIndex: 40,
          flip: { x: false, y: false },
        },
      },
      "text",
      "字幕与标题",
    );
    if (added) {
      seekPreview(start);
      setTextNotice(`字幕已添加到 ${formatEditorTime(start)}`);
      window.setTimeout(() => setTextNotice(""), 2200);
    } else {
      setTextNotice("字幕添加失败，请重试");
    }
  }
  function addTransition(key: string) {
    if (videoClips.length < 2) {
      setToolNotice("转场需要连接两段视频，请先在时间线上切分视频或添加第二段素材。");
      return;
    }
    const index = videoClips.findIndex((clip: any) => clip.id === selectedId);
    const toIndex = index > 0 ? index : 1;
    const to = videoClips[toIndex];
    const from = videoClips[toIndex - 1];
    const added = addClip(
      "transition",
      {
        duration: .6,
        timelineStart: to.timelineStart - .3,
        transitionKey: key,
        fromClipId: from.id,
        toClipId: to.id,
      },
      "transition",
      "转场",
    );
    if (added) {
      const boundary = to.timelineStart;
      seekPreview(Math.max(0, boundary - .28));
      setToolNotice(`已添加 ${transitions.find((item) => item.key === key)?.name || "转场"}，播放接缝处即可预览。`);
    }
  }
  function addEffect(key: string) {
    if (duration <= 0) {
      setToolNotice("时间线上还没有可应用特效的画面。");
      return;
    }
    const start = Math.min(time, Math.max(0, duration - 1));
    const added = addClip(
      "effect",
      {
        timelineStart: start,
        duration: Math.min(4, duration - start),
        effectKey: key,
        values: {},
      },
      "effect",
      "全局特效",
    );
    if (added) {
      seekPreview(start + Math.min(.08, editorClipDuration(added) / 2));
      setToolNotice(`已应用 ${effects.find((item) => item.key === key)?.name || "视觉特效"}，当前画面可直接预览。`);
    }
  }
  function updateSelected(updates: Record<string, unknown>) {
    if (!selectedId) return;
    const next = updateEditorClip(projectRef.current, selectedId, updates);
    const runtimeUpdates: Record<string, unknown> = {};
    if (updates.transform) runtimeUpdates.transform = updates.transform;
    if (updates.style && typeof updates.style === "object") {
      const normalizedStyle = findEditorClip(next, selectedId)?.clip.style;
      Object.assign(runtimeUpdates, normalizedStyle || updates.style);
    }
    if (updates.text !== undefined) runtimeUpdates.text = updates.text;
    if (updates.muted !== undefined) {
      runtimeUpdates.volume = updates.muted ? 0 : 1;
    }
    if (Object.keys(runtimeUpdates).length) {
      const runtime = runtimeRef.current;
      if (runtime) {
        // OpenVideo Text.updateStyle consumes typography fields at the update
        // root; a nested `style` object is discarded by its timeline adapter.
        runtimeMutationRef.current = true;
        void runtime.updateClip(selectedId, runtimeUpdates).catch(() => {
          runtime.replaceProject(createStudioProject(next));
        });
      }
    }
    commit(next);
  }
  function beginVisualTransform(
    event: ReactPointerEvent,
    clip: EditorClip,
    mode: "move" | "resize" | "rotate",
  ) {
    const monitor = monitorRef.current?.getBoundingClientRect();
    const found = findEditorClip(projectRef.current, clip.id);
    if (!monitor || !monitor.width || !monitor.height || found?.track.locked || clip.locked) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedId(clip.id);
    const transform = constrainTransformToCanvas(
      clip.transform,
      projectRef.current.settings.width,
      projectRef.current.settings.height,
    );
    const centerX = monitor.left + (transform.x + transform.width / 2) /
      projectRef.current.settings.width * monitor.width;
    const centerY = monitor.top + (transform.y + transform.height / 2) /
      projectRef.current.settings.height * monitor.height;
    visualTransformRef.current = {
      id: clip.id,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      transform,
      snapshot: clone(projectRef.current),
      monitor,
      startPointerAngle: Math.atan2(event.clientY - centerY, event.clientX - centerX),
      clipType: clip.type,
      fontSize: Number(clip.style?.fontSize) || 72,
      moved: false,
    };
  }
  async function runCanvasAction(
    action: "centerClip" | "fitClip" | "coverClip",
  ) {
    const found = selectedId
      ? findEditorClip(projectRef.current, selectedId)
      : null;
    if (!found) return;
    const canvasWidth = projectRef.current.settings.width;
    const canvasHeight = projectRef.current.settings.height;
    const current = constrainTransformToCanvas(
      found.clip.transform,
      canvasWidth,
      canvasHeight,
    );
    let width = current.width;
    let height = current.height;
    if (found.clip.type === "text") {
      const transform = action === "centerClip"
        ? {
          ...current,
          x: (canvasWidth - width) / 2,
          y: (canvasHeight - height) / 2,
        }
        : action === "fitClip"
        ? {
          ...current,
          x: canvasWidth * .1,
          y: Math.min(current.y, canvasHeight - height),
          width: canvasWidth * .8,
        }
        : {
          ...current,
          x: 0,
          y: Math.max(0, canvasHeight - height - canvasHeight * .06),
          width: canvasWidth,
        };
      updateSelected({ transform });
      return;
    }
    if (action !== "centerClip") {
      const scale = action === "fitClip"
        ? Math.min(canvasWidth / width, canvasHeight / height)
        : Math.max(canvasWidth / width, canvasHeight / height);
      width *= scale;
      height *= scale;
    }
    const transform = {
      ...current,
      x: (canvasWidth - width) / 2,
      y: (canvasHeight - height) / 2,
      width,
      height,
    };
    updateSelected({ transform });
  }
  function deleteSelected() {
    if (!selectedId) return;
    const found = findEditorClip(projectRef.current, selectedId);
    let source = projectRef.current;
    if (found?.track.locked) {
      source = updateEditorTrack(source, found.track.id, { locked: false });
    }
    const next = removeEditorClip(source, selectedId);
    commit(next);
    setSelectedId("");
  }
  function deleteAsset(assetId: string) {
    const current = projectRef.current;
    const next = clone(current);
    next.assets = next.assets.filter((asset: any) => asset.id !== assetId);
    next.tracks = next.tracks.map((track: any) => ({
      ...track,
      clips: track.clips.filter((clip: any) => clip.assetId !== assetId),
    }));
    const selectedClip = selectedId ? findEditorClip(current, selectedId)?.clip : null;
    if (selectedClip?.assetId === assetId) setSelectedId("");
    commit(next);
  }
  function duplicateSelected() {
    if (!selected) return;
    addClip(
      selected.clip.type,
      {
        ...clone(selected.clip),
        id: createId("clip"),
        timelineStart: selected.clip.timelineStart +
          editorClipDuration(selected.clip),
      },
      selected.track.type,
      selected.track.name,
    );
  }
  function splitSelected() {
    if (!selected || !["video", "audio"].includes(selected.clip.type)) return;
    const local = time - selected.clip.timelineStart;
    if (local <= .08 || local >= editorClipDuration(selected.clip) - .08) {
      return;
    }
    const splitSource = selected.clip.trimStart + local * selected.clip.speed;
    let next = updateEditorClip(projectRef.current, selectedId, {
      trimEnd: splitSource,
    });
    next = addEditorClip(next, selected.track.id, {
      ...selected.clip,
      id: createId("clip"),
      timelineStart: time,
      trimStart: splitSource,
    }, createId);
    commit(next);
  }
  async function togglePlayback() {
    const runtime = runtimeRef.current;
    if (!runtime || preferFallbackPreview) {
      const video = fallbackRef.current;
      if (!video) return;
      if (!playing) {
        const start = time >= duration - .02 ? 0 : time;
        if (start !== time) setTime(start);
        const clip = activeEditorClip(directPreviewClips, start) ||
          directPreviewClips.find((item: any) => item.timelineStart > start);
        if (usesNativeSequencePreview && clip) {
          if (clip.timelineStart > start) setTime(clip.timelineStart);
          video.currentTime = Math.min(
            clip.trimEnd - .001,
            clip.trimStart + Math.max(0, start - clip.timelineStart) * clip.speed,
          );
          video.playbackRate = clip.speed;
        } else {
          video.currentTime = start;
        }
        await video.play();
        setPlaying(true);
      } else {
        video.pause();
        setPlaying(false);
      }
      return;
    }
    if (playing) {
      runtime.pause();
      setPlaying(false);
    } else {
      if (time >= duration - .02) setTime(0);
      await runtime.seek(time >= duration - .02 ? 0 : time);
      await runtime.play();
      setPlaying(true);
    }
  }
  function seekPreview(seconds: number) {
    const value = Math.max(0, Math.min(duration, seconds));
    setTime(value);
    if (runtimeRef.current) void runtimeRef.current.seek(value);
    const video = fallbackRef.current;
    if (!video) return;
    const clip = activeEditorClip(directPreviewClips, value) ||
      (value >= duration - .001 ? directPreviewClips.at(-1) : null);
    const mediaTime = usesNativeSequencePreview && clip
      ? Math.min(
        clip.trimEnd - .001,
        clip.trimStart + Math.max(0, value - clip.timelineStart) * clip.speed,
      )
      : value;
    if (Math.abs(video.currentTime - mediaTime) > .02) {
      video.currentTime = mediaTime;
    }
  }

  function continueNativeSequence(clipId: string) {
    if (!usesNativeSequencePreview) {
      setPlaying(false);
      return;
    }
    const index = directPreviewClips.findIndex((clip: any) => clip.id === clipId);
    const next = directPreviewClips[index + 1];
    if (!next) {
      setTime(duration);
      setPlaying(false);
      return;
    }
    const currentEnd = directPreviewClips[index].timelineStart +
      editorClipDuration(directPreviewClips[index]);
    setTime(Math.max(currentEnd, next.timelineStart));
    setPlaying(true);
  }

  function captureSourceThumbnail(video: HTMLVideoElement) {
    if (!video.videoWidth || !video.videoHeight) return;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 160;
      canvas.height = 90;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return;
      context.drawImage(video, 0, 0, 160, 90);
      const thumbnail = canvas.toDataURL("image/jpeg", .72);
      if (thumbnail.length > 100) setSourceThumbnail(thumbnail);
    } catch {
      // Some custom protocols disallow canvas reads; the live video remains the fallback.
    }
  }

  function primeSourcePreview(video: HTMLVideoElement) {
    if (sourcePreviewPrimedRef.current || !video.duration || video.readyState < 2) return;
    sourcePreviewPrimedRef.current = true;
    const frameTime = Math.min(
      Math.max(time, 0),
      Math.max(0, video.duration - .04),
    );
    video.pause();
    video.currentTime = frameTime;
  }
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
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, []);
  useEffect(() => {
    const runtimeUrl = primaryVideoAssetId
      ? runtimeMediaUrls[primaryVideoAssetId]
      : "";
    if (!runtimeUrl || playbackUrl === runtimeUrl) return;
    setPlaybackUrl(runtimeUrl);
    setSourceState("loading");
  }, [playbackUrl, primaryVideoAssetId, runtimeMediaUrls]);
  useEffect(() => {
    const canonicalUrl = primaryVideoAsset?.sourceUrl || sourceUrl;
    if (!canonicalUrl) {
      setPlaybackUrl("");
      setSourceState("empty");
      return;
    }
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = "";
    }
    sourceFallbackPendingRef.current = false;
    setPlaybackUrl(canonicalUrl);
    setSourceThumbnail("");
    setSourceState("loading");
    setEngineReady(false);
  }, [primaryVideoAssetId, primaryVideoAsset?.sourceUrl, sourceUrl]);
  useEffect(() => {
    if (sourceState !== "loading" || playbackUrl.startsWith("blob:")) return;
    const timer = window.setTimeout(() => void sourceFailed(), 3500);
    return () => window.clearTimeout(timer);
  }, [playbackUrl, sourceState, primaryVideoAsset?.sourceFile, sourceFile]);
  useEffect(() => {
    sourcePreviewPrimedRef.current = false;
  }, [playbackUrl]);
  useEffect(() => {
    const video = fallbackRef.current;
    if (!video) return;
    video.muted = previewAudio.muted;
    video.volume = previewAudio.volume;
  }, [previewAudio.muted, previewAudio.volume]);
  useEffect(() => {
    if (
      sourceState !== "ready" || !canvasRef.current || !playbackUrl ||
      !videoEditorDuration(projectRef.current) ||
      preferFallbackPreview ||
      !getOpenVideoRuntimeSupport().preview
    ) return;
    let active = true;
    setEngineReady(false);
    setEngineError("");
    void createOpenVideoRuntime({
      canvas: canvasRef.current,
      project: createStudioProject(projectRef.current),
      previewScale: .7,
      onTime: (value: number) => {
        if (active) {
          setTime(Math.min(videoEditorDuration(projectRef.current), value));
          if (value >= videoEditorDuration(projectRef.current) - .02) {
            setPlaying(false);
          }
        }
      },
      onSelection: (ids: string[]) => setSelectedId(ids.at(-1) || ""),
      onTransformStart: () => {
        canvasTransformSnapshotRef.current = clone(projectRef.current);
      },
      onTransformEnd: ({ id, transform }: { id: string; transform: any }) => {
        const snapshot = canvasTransformSnapshotRef.current;
        canvasTransformSnapshotRef.current = null;
        const next = updateEditorClip(projectRef.current, id, { transform });
        if (next === projectRef.current) return;
        runtimeMutationRef.current = true;
        if (snapshot) recordHistory(snapshot);
        projectRef.current = next;
        setProject(next);
        controller.persist(next);
      },
      onPlayingChange: setPlaying,
    }).then(async (runtime) => {
      if (!active) return runtime.destroy();
      runtimeRef.current = runtime;
      if (selectedId) runtime.selectClip(selectedId);
      await runtime.seek(Math.min(time, videoEditorDuration(projectRef.current)));
      if (!active) return runtime.destroy();
      setEngineReady(true);
    }).catch((cause) => {
      setEngineReady(false);
      setEngineError(
        cause instanceof Error ? cause.message : "预览引擎启动失败",
      );
    });
    return () => {
      active = false;
      runtimeRef.current?.destroy();
      runtimeRef.current = null;
    };
  }, [
    createStudioProject,
    playbackUrl,
    playbackStructureSignature,
    preferFallbackPreview,
    recordHistory,
    sourceState,
  ]);
  useEffect(() => {
    if (!runtimeRef.current || dragRef.current || visualTransformRef.current) return;
    if (runtimeMutationRef.current) {
      runtimeMutationRef.current = false;
      return;
    }
    runtimeRef.current.replaceProject(createStudioProject(project));
    if (selectedId) runtimeRef.current.selectClip(selectedId);
  }, [createStudioProject, project]);
  useEffect(() => {
    runtimeRef.current?.selectClip(selectedId);
  }, [selectedId]);
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const gesture = visualTransformRef.current;
      if (!gesture) return;
      const canvasWidth = projectRef.current.settings.width;
      const canvasHeight = projectRef.current.settings.height;
      const dx = (event.clientX - gesture.startX) / gesture.monitor.width * canvasWidth;
      const dy = (event.clientY - gesture.startY) / gesture.monitor.height * canvasHeight;
      let transform: VideoEditorTransform = { ...gesture.transform };
      if (gesture.mode === "move") {
        transform.x = gesture.transform.x + dx;
        transform.y = gesture.transform.y + dy;
      } else if (gesture.mode === "resize") {
        const ratio = gesture.transform.width / Math.max(1, gesture.transform.height);
        const widthDelta = Math.abs(dx) >= Math.abs(dy * ratio) ? dx : dy * ratio;
        const maxWidth = Math.min(canvasWidth, canvasHeight * ratio);
        transform.width = Math.min(maxWidth, Math.max(48, gesture.transform.width + widthDelta));
        transform.height = transform.width / ratio;
      } else {
        const centerX = gesture.monitor.left +
          (gesture.transform.x + gesture.transform.width / 2) / canvasWidth * gesture.monitor.width;
        const centerY = gesture.monitor.top +
          (gesture.transform.y + gesture.transform.height / 2) / canvasHeight * gesture.monitor.height;
        const pointerAngle = Math.atan2(event.clientY - centerY, event.clientX - centerX);
        transform.angle = (Number(gesture.transform.angle) || 0) +
          (pointerAngle - gesture.startPointerAngle) * 180 / Math.PI;
      }
      transform = constrainTransformToCanvas(transform, canvasWidth, canvasHeight);
      const currentClip = findEditorClip(projectRef.current, gesture.id)?.clip;
      const updates: Record<string, unknown> = { transform };
      if (gesture.mode === "resize" && gesture.clipType === "text" && currentClip) {
        updates.style = {
          ...currentClip.style,
          fontSize: Math.max(8, gesture.fontSize * transform.width / gesture.transform.width),
        };
      }
      const next = updateEditorClip(projectRef.current, gesture.id, updates);
      if (next === projectRef.current) return;
      gesture.moved = true;
      runtimeMutationRef.current = true;
      projectRef.current = next;
      setProject(next);
    };
    const up = () => {
      const gesture = visualTransformRef.current;
      if (!gesture) return;
      visualTransformRef.current = null;
      if (!gesture.moved) return;
      recordHistory(gesture.snapshot);
      controller.persist(projectRef.current);
      runtimeMutationRef.current = false;
      runtimeRef.current?.replaceProject(createStudioProject(projectRef.current));
      runtimeRef.current?.selectClip(gesture.id);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [controller, createStudioProject, recordHistory]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !exporting) controller.close();
      else if (
        event.code === "Space" &&
        !(event.target instanceof HTMLInputElement ||
          event.target instanceof HTMLTextAreaElement)
      ) {
        event.preventDefault();
        void togglePlayback();
      } else if (
        event.key.toLowerCase() === "s" && !event.metaKey && !event.ctrlKey
      ) splitSelected();
      else if (
        (event.key === "Delete" || event.key === "Backspace") &&
        !(event.target instanceof HTMLInputElement ||
          event.target instanceof HTMLTextAreaElement)
      ) deleteSelected();
      else if (
        (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z"
      ) event.shiftKey ? redo() : undo();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (!drag.snapshot) drag.snapshot = clone(projectRef.current);
      const requestedStart = Math.max(
        0,
        drag.timelineStart + (event.clientX - drag.startX) / zoom,
      );
      const nextStart = snapEditorClipStart(
        projectRef.current,
        drag.id,
        requestedStart,
        10 / zoom,
      );
      const next = updateEditorClip(projectRef.current, drag.id, {
        timelineStart: Math.round(nextStart * 100) / 100,
      });
      projectRef.current = next;
      setProject(next);
    };
    const up = () => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      if (drag.snapshot) recordHistory(drag.snapshot);
      controller.persist(projectRef.current);
      runtimeRef.current?.replaceProject(
        createStudioProject(projectRef.current),
      );
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [controller, createStudioProject, recordHistory, zoom]);

  function sourceLoaded(video: HTMLVideoElement) {
    const activeSourceFile = String(primaryVideoAsset?.sourceFile || sourceFile);
    const activeSourceUrl = String(primaryVideoAsset?.sourceUrl || sourceUrl);
    const activeSourceName = String(
      primaryVideoAsset?.name || activeSourceFile.split(/[\\/]/).pop() || sourceName,
    );
    const facts = {
      sourceFile: activeSourceFile,
      sourceUrl: activeSourceUrl,
      sourceName: activeSourceName,
      duration: Number(video.duration) || Number(metadata?.duration) || 0,
      width: Number(video.videoWidth) || Number(metadata?.videoWidth) ||
        Number(metadata?.width) || 1920,
      height: Number(video.videoHeight) || Number(metadata?.videoHeight) ||
        Number(metadata?.height) || 1080,
    };
    if (!facts.duration) {
      setSourceState("error");
      return;
    }
    const next = hydrateSourceProject(projectRef.current, facts);
    projectRef.current = next;
    setProject(next);
    controller.persist(next);
    setSourceState("ready");
  }

  async function sourceFailed() {
    const activeSourceFile = String(primaryVideoAsset?.sourceFile || sourceFile);
    if (sourceFallbackPendingRef.current) return;
    if (!activeSourceFile || playbackUrl.startsWith("blob:")) {
      setSourceState("error");
      return;
    }
    sourceFallbackPendingRef.current = true;
    try {
      const buffer = await desktopApi.file.readArrayBuffer(activeSourceFile);
      if (!buffer?.byteLength) throw new Error("视频文件为空");
      const mime = editorMediaMimeType(activeSourceFile, "video");
      const url = URL.createObjectURL(new Blob([buffer], { type: mime }));
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = url;
      setPlaybackUrl(url);
      setSourceState("loading");
    } catch {
      setSourceState("error");
    } finally {
      sourceFallbackPendingRef.current = false;
    }
  }

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
        <section className="ov-program">
          <div className="ov-monitor-head">
            <span>画面预览</span>
            <em>{project.settings.width} × {project.settings.height}</em>
            <em>{project.settings.fps} FPS</em>
            <i
              className={engineReady ? "online" : ""}
              title={engineError}
            >
              {engineReady ? "OpenVideo 已就绪" : sourceState === "loading"
                ? "正在载入"
                : "兼容预览"}
            </i>
          </div>
          <div
            ref={monitorRef}
            className="ov-monitor"
            style={{
              aspectRatio: `${project.settings.width} / ${project.settings.height}`,
            }}
          >
            <canvas
              ref={canvasRef}
              className={engineReady && !preferFallbackPreview ? "active" : ""}
            />
            <video
              key={usesNativeSequencePreview ? nativePreviewClip?.id || "gap" : "primary"}
              ref={fallbackRef}
              className={!engineReady || preferFallbackPreview ? "active" : ""}
              src={usesNativeSequencePreview ? nativePreviewUrl : playbackUrl}
              muted={previewAudio.muted}
              playsInline
              preload="auto"
              onLoadedMetadata={(event) => {
                const video = event.currentTarget;
                if (!usesNativeSequencePreview || nativePreviewAsset?.id === primaryVideoAssetId) {
                  sourceLoaded(video);
                }
                if (!usesNativeSequencePreview || !nativePreviewClip) return;
                video.playbackRate = nativePreviewClip.speed;
                const mediaTime = Math.min(
                  nativePreviewClip.trimEnd - .001,
                  nativePreviewClip.trimStart +
                    Math.max(0, time - nativePreviewClip.timelineStart) * nativePreviewClip.speed,
                );
                if (Math.abs(video.currentTime - mediaTime) > .02) {
                  video.currentTime = mediaTime;
                }
              }}
              onLoadedData={(event) => {
                const video = event.currentTarget;
                if (!usesNativeSequencePreview || nativePreviewAsset?.id === primaryVideoAssetId) {
                  captureSourceThumbnail(video);
                  primeSourcePreview(video);
                }
                if (usesNativeSequencePreview && playing) {
                  void video.play().catch(() => setPlaying(false));
                }
              }}
              onSeeked={(event) => {
                if (!sourceThumbnail) captureSourceThumbnail(event.currentTarget);
              }}
              onError={() => {
                if (usesNativeSequencePreview) {
                  setEngineError(`片段“${nativePreviewAsset?.name || "视频"}”载入失败`);
                  setPlaying(false);
                  return;
                }
                void sourceFailed();
              }}
              onTimeUpdate={(event) => {
                if (!engineReady || preferFallbackPreview) {
                  const video = event.currentTarget;
                  if (usesNativeSequencePreview && nativePreviewClip) {
                    const projectTime = nativePreviewClip.timelineStart +
                      (video.currentTime - nativePreviewClip.trimStart) /
                        nativePreviewClip.speed;
                    const clipEnd = nativePreviewClip.timelineStart +
                      editorClipDuration(nativePreviewClip);
                    setTime(Math.min(clipEnd, Math.max(nativePreviewClip.timelineStart, projectTime)));
                    if (
                      playing &&
                      video.currentTime >= nativePreviewClip.trimEnd -
                        1 / project.settings.fps
                    ) {
                      continueNativeSequence(nativePreviewClip.id);
                    }
                  } else {
                    setTime(video.currentTime);
                  }
                }
              }}
              onEnded={() => {
                if (usesNativeSequencePreview && nativePreviewClip) {
                  continueNativeSequence(nativePreviewClip.id);
                } else {
                  setPlaying(false);
                }
              }}
            />
            {activeImageClips.length > 0 && (
              <div className="ov-image-preview-layer">
                {activeImageClips.map((clip: any) => {
                  const asset = allAssets.find((item) => item.id === clip.assetId);
                  const source = clip.src || asset?.sourceUrl;
                  if (!source) return null;
                  const transform = constrainTransformToCanvas(
                    clip.transform,
                    project.settings.width,
                    project.settings.height,
                  );
                  return (
                    <div
                      key={clip.id}
                      className={`ov-image-preview-item${clip.id === selectedId ? " selected" : ""}`}
                      style={{
                        left: `${transform.x / project.settings.width * 100}%`,
                        top: `${transform.y / project.settings.height * 100}%`,
                        width: `${transform.width / project.settings.width * 100}%`,
                        height: `${transform.height / project.settings.height * 100}%`,
                        opacity: Number(transform.opacity ?? 1),
                        transform: `rotate(${Number(transform.angle) || 0}deg)`,
                      }}
                      onPointerDown={(event) => beginVisualTransform(event, clip, "move")}
                    >
                      <img src={source} alt="" draggable={false} />
                      {clip.id === selectedId && (
                        <>
                          <span
                            className="ov-transform-rotate-handle"
                            title="拖动旋转"
                            onPointerDown={(event) => beginVisualTransform(event, clip, "rotate")}
                          />
                          <span
                            className="ov-transform-resize-handle"
                            title="拖动缩放"
                            onPointerDown={(event) => beginVisualTransform(event, clip, "resize")}
                          />
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {activeTextClips.length > 0 && (
              <div className="ov-text-preview-layer">
                {activeTextClips.map((clip: any) => {
                  const transform = constrainTransformToCanvas(
                    clip.transform,
                    project.settings.width,
                    project.settings.height,
                  );
                  const style = clip.style || {};
                  const stroke = style.stroke || {};
                  return (
                    <div
                      key={clip.id}
                      className={`ov-text-preview-item${clip.id === selectedId ? " selected" : ""}`}
                      style={{
                        left: `${(Number(transform.x) || 0) / project.settings.width * 100}%`,
                        top: `${(Number(transform.y) || 0) / project.settings.height * 100}%`,
                        width: `${(Number(transform.width) || project.settings.width) / project.settings.width * 100}%`,
                        height: `${(Number(transform.height) || 1) / project.settings.height * 100}%`,
                        color: style.color || "#fff",
                        background: "transparent",
                        fontFamily: style.fontFamily || "PingFang SC",
                        fontSize: `clamp(12px, ${(Number(style.fontSize) || 64) / project.settings.height * 100}cqh, 96px)`,
                        fontWeight: style.fontWeight || 700,
                        textAlign: style.align || "center",
                        opacity: Number(transform.opacity ?? 1),
                        transform: `rotate(${Number(transform.angle) || 0}deg)`,
                        WebkitTextStroke: stroke.width
                          ? `${Math.max(1, Number(stroke.width) / project.settings.height * 100)}cqh ${stroke.color || "#111"}`
                          : undefined,
                      }}
                      onPointerDown={(event) => beginVisualTransform(event, clip, "move")}
                    >
                      <span className="ov-text-preview-content">{clip.text}</span>
                      {clip.id === selectedId && (
                        <>
                          <span
                            className="ov-transform-rotate-handle"
                            title="拖动旋转"
                            onPointerDown={(event) => beginVisualTransform(event, clip, "rotate")}
                          />
                          <span
                            className="ov-transform-resize-handle"
                            title="拖动缩放文字"
                            onPointerDown={(event) => beginVisualTransform(event, clip, "resize")}
                          />
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {sourceState === "loading" && (
              <div className="ov-monitor-state">正在读取视频…</div>
            )}
            {sourceState === "error" && (
              <div className="ov-monitor-state is-error">
                <IconSymbol name="film" />
                <strong>视频载入失败</strong>
                <span>源文件可能已移动或格式不受支持</span>
              </div>
            )}
            {sourceState === "empty" && (
              <div className="ov-monitor-state">
                <IconSymbol name="film" />
                <strong>空白剪辑工程</strong>
                <span>从左侧素材面板导入视频开始剪辑</span>
              </div>
            )}
            <div className="ov-safe-frame" />
            <output>
              {formatEditorTimecode(time)} <i>/</i> {formatEditorTimecode(duration)}
            </output>
          </div>
          <div className="ov-transport">
            <button
              title="上一帧"
              onClick={() => {
                if (runtimeRef.current && !preferFallbackPreview) {
                  void runtimeRef.current.framePrev();
                } else {
                  seekPreview(time - 1 / project.settings.fps);
                }
              }}
            >
              ‹
            </button>
            <button className="play" onClick={() => void togglePlayback()}>
              <IconSymbol name={playing ? "pause" : "play"} />
            </button>
            <button onClick={splitSelected}>
              <IconSymbol name="scissors" />
            </button>
            <button
              title="下一帧"
              onClick={() => {
                if (runtimeRef.current && !preferFallbackPreview) {
                  void runtimeRef.current.frameNext();
                } else {
                  seekPreview(time + 1 / project.settings.fps);
                }
              }}
            >
              ›
            </button>
            <input
              value={time}
              type="range"
              min="0"
              max={Math.max(.01, duration)}
              step=".01"
              onChange={(event) => {
                const value = Number(event.target.value);
                setTime(value);
                seekPreview(value);
              }}
            />
            <span>
              <b>{formatEditorTimecode(time)}</b>
              <i>/</i>
              {formatEditorTimecode(duration)}
            </span>
            <button
              className="ov-fit"
              onClick={() => runtimeRef.current?.resetView()}
            >
              适应 <IconSymbol name="maximize" />
            </button>
          </div>
        </section>
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
        onClipPointerDown={(event, clip) => {
          event.stopPropagation();
          setSelectedId(clip.id);
          const clipEnd = clip.timelineStart + editorClipDuration(clip);
          if (time <= clip.timelineStart || time >= clipEnd) seekPreview(clipFocusTime(clip));
          dragRef.current = {
            id: clip.id,
            startX: event.clientX,
            timelineStart: clip.timelineStart,
          };
        }}
      />
    </section>,
    document.body,
  );
}
