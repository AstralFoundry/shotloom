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
  editorClipDuration,
  findEditorClip,
  normalizeVideoEditorProject,
  removeEditorClip,
  updateEditorClip,
  updateEditorTrack,
  videoEditorDuration,
} from "../../utils/videoEditorProject.mjs";
import { desktopApi } from "../../services/desktopApi.js";
import { type IconName, IconSymbol } from "../components/IconSymbol";
import stickerActionUrl from "../../assets/stickers/action.svg?no-inline";
import stickerHeartUrl from "../../assets/stickers/heart.svg?no-inline";
import stickerStarUrl from "../../assets/stickers/star.svg?no-inline";
import "./VideoEditorWorkspace.css";

type EditorProject = any;
type EditorClip = any;
export interface VideoEditorAsset {
  id: string;
  type: "video" | "audio" | "image";
  name: string;
  sourceFile?: string;
  sourceUrl: string;
  duration?: number;
  width?: number;
  height?: number;
}
export interface VideoEditorController {
  persist: (project: EditorProject) => void;
  export: (project: EditorProject) => Promise<unknown>;
  close: () => void;
  importAssets?: () => Promise<VideoEditorAsset[]>;
}
export interface VideoEditorWorkspaceProps {
  title?: string;
  project?: EditorProject;
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

const tools: Array<{ id: string; label: string; icon: IconName }> = [
  { id: "media", label: "素材", icon: "film" },
  { id: "text", label: "文字", icon: "text" },
  { id: "stickers", label: "贴图", icon: "spark" },
  { id: "transitions", label: "转场", icon: "layers" },
  { id: "effects", label: "特效", icon: "sliders" },
];
const trackMeta: Record<string, { code: string; icon: IconName }> = {
  video: { code: "V", icon: "film" },
  audio: { code: "A", icon: "sliders" },
  text: { code: "T", icon: "text" },
  overlay: { code: "O", icon: "image" },
  effect: { code: "FX", icon: "spark" },
  transition: { code: "TR", icon: "layers" },
};
const transitions = [
  { key: "fade", name: "溶解" },
  { key: "Directional", name: "方向推移" },
  { key: "directionalwarp", name: "方向扭曲" },
  { key: "circleopen", name: "圆形展开" },
  { key: "pixelize", name: "像素化" },
  { key: "CrossZoom", name: "交叉缩放" },
];
const effects = [
  { key: "vignette", name: "暗角" },
  { key: "glitch", name: "故障" },
  { key: "pixelate", name: "像素" },
  { key: "chromatic", name: "色散" },
  { key: "filmStripPro", name: "胶片" },
];
const textPresets = [{
  id: "subtitle",
  name: "清晰字幕",
  sample: "对白字幕",
  fontFamily: "PingFang SC",
  fontSize: 52,
  fontWeight: 600,
  y: .78,
}, {
  id: "cinema",
  name: "银幕标题",
  sample: "银幕标题",
  fontFamily: "Songti SC",
  fontSize: 76,
  fontWeight: 600,
  y: .42,
}, {
  id: "chapter",
  name: "章节标题",
  sample: "第一幕",
  fontFamily: "PingFang SC",
  fontSize: 60,
  fontWeight: 700,
  y: .18,
}];
const builtInStickers: VideoEditorAsset[] = [{
  id: "sticker-star",
  type: "image",
  name: "明星",
  sourceUrl: stickerStarUrl,
  width: 512,
  height: 512,
}, {
  id: "sticker-action",
  type: "image",
  name: "动作",
  sourceUrl: stickerActionUrl,
  width: 512,
  height: 512,
}, {
  id: "sticker-love",
  type: "image",
  name: "心情",
  sourceUrl: stickerHeartUrl,
  width: 512,
  height: 512,
}];
const builtInStickerById = new Map(builtInStickers.map((asset) => [asset.id, asset]));

function applyBuiltInStickerSources(project: EditorProject) {
  for (const asset of project.assets || []) {
    const builtIn = builtInStickerById.get(asset.id);
    if (builtIn) asset.sourceUrl = builtIn.sourceUrl;
  }
  for (const track of project.tracks || []) {
    for (const clip of track.clips || []) {
      const builtIn = builtInStickerById.get(clip.assetId);
      if (builtIn && clip.type === "image") clip.src = builtIn.sourceUrl;
    }
  }
  return project;
}
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const createId = (prefix = "item") =>
  `${prefix}-${Date.now().toString(36)}-${
    Math.random().toString(36).slice(2, 7)
  }`;
const formatTime = (seconds: number) => {
  const value = Math.max(0, Number(seconds) || 0);
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${
    (value % 60).toFixed(1).padStart(4, "0")
  }`;
};
const formatTimecode = (seconds: number) => {
  const value = Math.max(0, Number(seconds) || 0);
  return [
    Math.floor(value / 3600),
    Math.floor((value % 3600) / 60),
    Math.floor(value % 60),
    Math.floor((value % 1) * 30),
  ].map((part) => String(part).padStart(2, "0")).join(":");
};

interface CanvasTransform extends Record<string, unknown> {
  x: number;
  y: number;
  width: number;
  height: number;
  opacity?: number;
  angle?: number;
}

function constrainTransformToCanvas(
  transform: Record<string, any> = {},
  canvasWidth: number,
  canvasHeight: number,
): CanvasTransform {
  const width = Math.min(canvasWidth, Math.max(1, Number(transform.width) || canvasWidth * .76));
  const height = Math.min(canvasHeight, Math.max(1, Number(transform.height) || canvasHeight * .14));
  return {
    ...transform,
    x: Math.min(Math.max(0, Number(transform.x) || 0), Math.max(0, canvasWidth - width)),
    y: Math.min(Math.max(0, Number(transform.y) || 0), Math.max(0, canvasHeight - height)),
    width,
    height,
  };
}

function hydrateSourceProject(
  project: EditorProject,
  source: {
    sourceFile: string;
    sourceUrl: string;
    sourceName: string;
    duration: number;
    width: number;
    height: number;
  },
) {
  const next = clone(project);
  let asset = next.assets.find((item: any) =>
    item.type === "video" && item.sourceFile === source.sourceFile
  ) || next.assets.find((item: any) => item.type === "video");
  if (!asset) {
    asset = { id: createId("asset"), type: "video" };
    next.assets.unshift(asset);
  }
  Object.assign(asset, {
    name: source.sourceName,
    sourceFile: source.sourceFile,
    sourceUrl: source.sourceUrl,
    duration: source.duration,
    width: source.width,
    height: source.height,
  });
  let track = next.tracks.find((item: any) => item.type === "video");
  if (!track) {
    track = {
      id: createId("track-video"),
      type: "video",
      name: "主画面",
      locked: false,
      hidden: false,
      muted: false,
      clips: [],
    };
    next.tracks.unshift(track);
  }
  const hasVideoClip = next.tracks.some((item: any) =>
    item.clips.some((clip: any) => clip.type === "video")
  );
  if (!hasVideoClip && source.duration > 0) {
    track.clips.push({
      id: createId("clip"),
      type: "video",
      assetId: asset.id,
      timelineStart: 0,
      trimStart: 0,
      trimEnd: source.duration,
      speed: 1,
      muted: false,
    });
  }
  next.settings.width = source.width || next.settings.width;
  next.settings.height = source.height || next.settings.height;
  for (const item of next.tracks) {
    for (const clip of item.clips) {
      if (clip.type === "text") {
        clip.transform = constrainTransformToCanvas(
          clip.transform,
          next.settings.width,
          next.settings.height,
        );
      }
    }
  }
  return normalizeVideoEditorProject(next, source);
}

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
    })), []);
  const [project, setProject] = useState<EditorProject>(initial);
  const projectRef = useRef(project);
  projectRef.current = project;
  const [activeTool, setActiveTool] = useState("media");
  const [selectedId, setSelectedId] = useState("");
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState(64);
  const [engineReady, setEngineReady] = useState(false);
  const [engineError, setEngineError] = useState("");
  const [playbackUrl, setPlaybackUrl] = useState(sourceUrl);
  const [sourceThumbnail, setSourceThumbnail] = useState("");
  const [sourceState, setSourceState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [textNotice, setTextNotice] = useState("");
  const [toolNotice, setToolNotice] = useState("");
  const [history, setHistory] = useState<EditorProject[]>([]);
  const [future, setFuture] = useState<EditorProject[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const monitorRef = useRef<HTMLDivElement>(null);
  const fallbackRef = useRef<HTMLVideoElement>(null);
  const blobUrlRef = useRef("");
  const sourcePreviewPrimedRef = useRef(false);
  const runtimeRef = useRef<any>(null);
  const runtimeMutationRef = useRef(false);
  const canvasTransformSnapshotRef = useRef<EditorProject | null>(null);
  const timelineFitRef = useRef(false);
  const timelineRef = useRef<HTMLDivElement>(null);
  const visualTransformRef = useRef<{
    id: string;
    mode: "move" | "resize" | "rotate";
    startX: number;
    startY: number;
    transform: CanvasTransform;
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
  const selected = selectedId ? findEditorClip(project, selectedId) : null;
  const preferFallbackPreview = sourceState === "ready" &&
    !project.tracks.some((track: any) =>
      ["overlay", "effect", "transition"].includes(track.type) &&
      track.clips.length > 0
    );
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
  const primaryVideoAssetId = project.assets.find((asset: any) =>
    asset.type === "video"
  )?.id;
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
      const clip = track.clips.find((item: any) =>
        item.assetId === primaryVideoAssetId &&
        time >= item.timelineStart &&
        time <= item.timelineStart + editorClipDuration(item)
      );
      if (!clip) continue;
      return {
        muted: track.muted === true || clip.muted === true,
        volume: Math.max(0, Math.min(1, Number(clip.volume ?? 1))),
      };
    }
    return { muted: false, volume: 1 };
  }, [primaryVideoAssetId, project.tracks, time]);

  const commit = useCallback((next: EditorProject, record = true) => {
    if (next === projectRef.current) return;
    if (record) {
      setHistory((items) => [...items.slice(-59), clone(projectRef.current)]);
      setFuture([]);
    }
    projectRef.current = next;
    setProject(next);
    controller.persist(next);
  }, [controller]);
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
  function addAsset(asset: VideoEditorAsset) {
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
      next = updateEditorTrack(next, track.id, { locked: false, hidden: false });
      track = next.tracks.find((item: any) => item.id === track.id);
    }
    const trimEnd = asset.duration || 5;
    const clipId = createId("clip");
    const imageDuration = 4;
    const imageStart = duration > 0
      ? Math.min(time, Math.max(0, duration - imageDuration))
      : 0;
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
          timelineStart: Math.min(time, duration),
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
      }
    } else if (asset.type === "image") {
      setToolNotice("贴图添加失败，请重试。");
    }
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
      setTextNotice(`字幕已添加到 ${formatTime(start)}`);
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
          runtime.replaceProject(createOpenVideoStudioProject(next));
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
  function undo() {
    const previous = history.at(-1);
    if (!previous) return;
    setHistory((items) => items.slice(0, -1));
    setFuture((items) => [...items, clone(projectRef.current)]);
    commit(clone(previous), false);
  }
  function redo() {
    const next = future.at(-1);
    if (!next) return;
    setFuture((items) => items.slice(0, -1));
    setHistory((items) => [...items, clone(projectRef.current)]);
    commit(clone(next), false);
  }
  async function togglePlayback() {
    const runtime = runtimeRef.current;
    if (!runtime || preferFallbackPreview) {
      const video = fallbackRef.current;
      if (!video) return;
      if (video.paused) {
        video.currentTime = time >= duration - .02 ? 0 : time;
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
    if (fallbackRef.current && Math.abs(fallbackRef.current.currentTime - value) > .02) {
      fallbackRef.current.currentTime = value;
    }
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
      const pixels = context.getImageData(0, 0, 160, 90).data;
      let luminance = 0;
      for (let index = 0; index < pixels.length; index += 64) {
        luminance += pixels[index] + pixels[index + 1] + pixels[index + 2];
      }
      const samples = Math.ceil(pixels.length / 64);
      if (luminance / samples / 3 < 10) return;
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
      Math.max(time, 1 / projectRef.current.settings.fps),
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
      setExportError(cause instanceof Error ? cause.message : "导出失败");
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
    if (!duration || timelineFitRef.current) return;
    timelineFitRef.current = true;
    setZoom(Math.max(24, Math.min(180, (window.innerWidth - 120) / duration)));
  }, [duration]);
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
      !getOpenVideoRuntimeSupport().preview
    ) return;
    let active = true;
    setEngineError("");
    void createOpenVideoRuntime({
      canvas: canvasRef.current,
      project: createOpenVideoStudioProject(projectRef.current),
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
        if (snapshot) {
          setHistory((items) => [...items.slice(-59), snapshot]);
        }
        setFuture([]);
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
  }, [playbackUrl, sourceState]);
  useEffect(() => {
    if (!runtimeRef.current || dragRef.current || visualTransformRef.current) return;
    if (runtimeMutationRef.current) {
      runtimeMutationRef.current = false;
      return;
    }
    runtimeRef.current.replaceProject(createOpenVideoStudioProject(project));
    if (selectedId) runtimeRef.current.selectClip(selectedId);
  }, [project]);
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
      let transform: CanvasTransform = { ...gesture.transform };
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
      setHistory((items) => [...items.slice(-59), gesture.snapshot]);
      setFuture([]);
      controller.persist(projectRef.current);
      runtimeMutationRef.current = false;
      runtimeRef.current?.replaceProject(createOpenVideoStudioProject(projectRef.current));
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
  }, [controller]);
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
      const nextStart = Math.max(
        0,
        drag.timelineStart + (event.clientX - drag.startX) / zoom,
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
      if (drag.snapshot) {
        setHistory((
          items,
        ) => [...items.slice(-59), drag.snapshot as EditorProject]);
      }
      setFuture([]);
      controller.persist(projectRef.current);
      runtimeRef.current?.replaceProject(
        createOpenVideoStudioProject(projectRef.current),
      );
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [controller, zoom]);

  function sourceLoaded(video: HTMLVideoElement) {
    const facts = {
      sourceFile,
      sourceUrl: playbackUrl,
      sourceName,
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
    if (!sourceFile || playbackUrl.startsWith("blob:")) {
      setSourceState("error");
      return;
    }
    try {
      const buffer = await desktopApi.file.readArrayBuffer(sourceFile);
      if (!buffer?.byteLength) throw new Error("视频文件为空");
      const extension = sourceName.split(".").pop()?.toLowerCase();
      const mime = extension === "webm" ? "video/webm" : "video/mp4";
      const url = URL.createObjectURL(new Blob([buffer], { type: mime }));
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = url;
      setPlaybackUrl(url);
      setSourceState("loading");
    } catch {
      setSourceState("error");
    }
  }

  const toolPanel = activeTool === "media"
    ? (
      <>
        <div className="ov-library-heading">
          <strong>素材</strong>
          <span>{allAssets.length}</span>
          <button
            onClick={() =>
              void controller.importAssets?.().then((items) =>
                items.forEach(addAsset)
              )}
          >
            <IconSymbol name="download" /> 导入
          </button>
        </div>
        {allAssets.length === 0 && (
          <button
            className="ov-import"
            onClick={() =>
              void controller.importAssets?.().then((items) =>
                items.forEach(addAsset)
              )}
          >
            <IconSymbol name="download" />
            <strong>导入视频、图片或音频</strong>
            <span>点击选择本地文件</span>
          </button>
        )}
        <div className="ov-asset-grid">
          {allAssets.map((asset) => (
            <article
              key={asset.id}
              className="ov-asset-card"
            >
              <button
                className="ov-asset-preview"
                title="双击添加到时间线"
                onDoubleClick={() => addAsset(asset)}
              >
              <span className="ov-asset-thumbnail">
                {asset.type === "image"
                  ? <img src={asset.sourceUrl} />
                  : asset.type === "video"
                  ? (asset.id === primaryVideoAssetId && sourceThumbnail
                    ? <img src={sourceThumbnail} />
                    : (
                    <video
                      src={asset.sourceUrl}
                      muted
                      playsInline
                      preload="auto"
                      onLoadedMetadata={(event) => {
                        const video = event.currentTarget;
                        video.currentTime = Math.min(
                          Math.max(.12, video.duration * .08),
                          Math.max(0, video.duration - .05),
                        );
                      }}
                      onSeeked={(event) => {
                        if (asset.id === primaryVideoAssetId && !sourceThumbnail) {
                          captureSourceThumbnail(event.currentTarget);
                        }
                      }}
                    />
                    ))
                  : <IconSymbol name="sliders" />}
              </span>
              <strong>{asset.name}</strong>
              <small>
                {asset.type.toUpperCase()}
                {asset.duration ? ` · ${formatTime(asset.duration)}` : ""}
              </small>
              </button>
              <button
                className="ov-asset-delete"
                title="删除素材及其时间线片段"
                aria-label={`删除素材 ${asset.name}`}
                onClick={() => deleteAsset(asset.id)}
              >
                <IconSymbol name="trash" />
              </button>
            </article>
          ))}
        </div>
      </>
    )
    : activeTool === "text"
    ? (
      <>
        <PanelHeading title="文字与字幕" count={textPresets.length} />
        <div className="ov-text-presets">
          {textPresets.map((preset) => (
            <button
              key={preset.id}
              className={`ov-preset-card text-preset is-${preset.id}`}
              onClick={() => addText(preset)}
            >
              <strong style={{ fontFamily: preset.fontFamily }}>{preset.name}</strong>
              <span>{preset.sample} · 添加到当前时间</span>
            </button>
          ))}
        </div>
        {textNotice && <div className="ov-text-notice">{textNotice}</div>}
        <p className="ov-panel-note">
          文字是独立轨道，可在画布中拖动、缩放和旋转。
        </p>
      </>
    )
    : activeTool === "stickers"
    ? (
      <>
        <div className="ov-library-heading">
          <strong>贴图</strong>
          <span>{stickerAssets.length}</span>
          <button
            onClick={() =>
              void controller.importAssets?.().then((items) => {
                const images = items.filter((item) => item.type === "image");
                if (!images.length) {
                  setToolNotice("请选择 PNG、JPG、WebP 或 GIF 图片作为贴图。");
                  return;
                }
                images.forEach(addAsset);
              })}
          >
            <IconSymbol name="download" /> 导入图片
          </button>
        </div>
        <div className="ov-sticker-grid">
          {stickerAssets.map((asset) => (
            <button
              key={asset.id}
              onClick={() => addAsset(asset)}
            >
              <img src={asset.sourceUrl} />
              <span>{asset.name}</span>
            </button>
          ))}
        </div>
        {toolNotice && <div className="ov-tool-notice">{toolNotice}</div>}
        <p className="ov-panel-note">点击添加到当前画面；选中后可在检查器调整位置、大小、旋转与透明度。</p>
      </>
    )
    : activeTool === "transitions"
    ? (
      <>
        <PanelHeading title="转场" count={transitions.length} />
        <div className="ov-preset-list">
          {transitions.map((item) => (
            <button
              key={item.key}
              onClick={() => addTransition(item.key)}
              disabled={videoClips.length < 2}
            >
              <i />
              <strong>{item.name}</strong>
              <small>{item.key}</small>
            </button>
          ))}
        </div>
        {toolNotice && <div className="ov-tool-notice">{toolNotice}</div>}
        <p className="ov-panel-note">
          {videoClips.length < 2
            ? "当前只有一段视频。先移动播放头并切分，或添加第二段视频素材。"
            : "选择接缝后的片段并应用，转场会连接前后两段视频。"}
        </p>
      </>
    )
    : (
      <>
        <PanelHeading title="视觉特效" count={effects.length} />
        <div className="ov-preset-list">
          {effects.map((item) => (
            <button
              key={item.key}
              onClick={() => addEffect(item.key)}
            >
              <i className="effect-swatch" />
              <strong>{item.name}</strong>
              <small>{item.key}</small>
            </button>
          ))}
        </div>
        {toolNotice && <div className="ov-tool-notice">{toolNotice}</div>}
        <p className="ov-panel-note">特效从当前播放头开始，应用后可直接在画布预览。</p>
      </>
    );

  return createPortal(
    <section
      className="ov-editor"
      role="dialog"
      aria-modal="true"
      aria-label="视频编辑器"
    >
      <header className="ov-topbar">
        <div className="ov-brand">
          <span>
            <IconSymbol name="film" />
          </span>
          <div>
            <strong>{title}</strong>
            <small>{project.tracks.length} 条轨道 · 自动保存</small>
          </div>
        </div>
        <div className="ov-history">
          <button title="撤销" aria-label="撤销" disabled={!history.length} onClick={undo}>
            <IconSymbol name="undo" />
          </button>
          <button title="重做" aria-label="重做" disabled={!future.length} onClick={redo}>
            <IconSymbol name="redo" />
          </button>
          <button title="重置画布视图" aria-label="重置画布视图" onClick={() => runtimeRef.current?.resetView()}>
            <IconSymbol name="maximize" />
          </button>
        </div>
        <div className="ov-actions">
          {exportError && <span>{exportError}</span>}
          <button disabled={exporting} onClick={controller.close}>关闭</button>
          <button
            className="primary"
            disabled={exporting || !duration}
            onClick={() => void exportProject()}
          >
            <IconSymbol name="download" />
            {exporting ? "正在导出…" : "导出成片"}
          </button>
        </div>
      </header>
      <main className="ov-stage">
        <nav className="ov-toolrail">
          {tools.map((tool) => (
            <button
              key={tool.id}
              className={activeTool === tool.id ? "active" : ""}
              onClick={() => {
                setActiveTool(tool.id);
                setToolNotice("");
              }}
            >
              <IconSymbol name={tool.icon} />
              <span>{tool.label}</span>
            </button>
          ))}
        </nav>
        <aside className="ov-library">{toolPanel}</aside>
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
              ref={fallbackRef}
              className={!engineReady || preferFallbackPreview ? "active" : ""}
              src={playbackUrl}
              muted={previewAudio.muted}
              playsInline
              preload="auto"
              onLoadedMetadata={(event) => sourceLoaded(event.currentTarget)}
              onLoadedData={(event) => {
                captureSourceThumbnail(event.currentTarget);
                primeSourcePreview(event.currentTarget);
              }}
              onSeeked={(event) => {
                if (!sourceThumbnail) captureSourceThumbnail(event.currentTarget);
              }}
              onError={() => void sourceFailed()}
              onTimeUpdate={(event) => {
                if (!engineReady || preferFallbackPreview) {
                  setTime(event.currentTarget.currentTime);
                }
              }}
              onEnded={() => setPlaying(false)}
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
            <div className="ov-safe-frame" />
            <output>
              {formatTimecode(time)} <i>/</i> {formatTimecode(duration)}
            </output>
          </div>
          <div className="ov-transport">
            <button
              title="上一帧"
              onClick={() => {
                if (runtimeRef.current) void runtimeRef.current.framePrev();
                else if (fallbackRef.current) {
                  fallbackRef.current.currentTime = Math.max(
                    0,
                    time - 1 / project.settings.fps,
                  );
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
                if (runtimeRef.current) void runtimeRef.current.frameNext();
                else if (fallbackRef.current) {
                  fallbackRef.current.currentTime = Math.min(
                    duration,
                    time + 1 / project.settings.fps,
                  );
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
              <b>{formatTimecode(time)}</b>
              <i>/</i>
              {formatTimecode(duration)}
            </span>
            <button
              className="ov-fit"
              onClick={() => runtimeRef.current?.resetView()}
            >
              适应 <IconSymbol name="maximize" />
            </button>
          </div>
        </section>
        <Inspector
          selected={selected}
          project={project}
          onUpdate={updateSelected}
          onDelete={deleteSelected}
          onDuplicate={duplicateSelected}
          onCanvasAction={(action) => void runCanvasAction(action)}
        />
      </main>
      <footer className="ov-timeline">
        <div className="ov-timeline-toolbar">
          <div className="ov-edit-buttons">
            <button title="切分片段" aria-label="切分片段" onClick={splitSelected}>
              <IconSymbol name="scissors" />切分
            </button>
            <button title="复制片段" aria-label="复制片段" onClick={duplicateSelected}>
              <IconSymbol name="copy" />复制
            </button>
            <button title="删除片段" aria-label="删除片段" onClick={deleteSelected}>
              <IconSymbol name="trash" />删除
            </button>
          </div>
          <div className="ov-sequence-title">
            <strong>主场景</strong>
            <span>主时间线</span>
            <em>{formatTime(duration)}</em>
          </div>
          <label>
            缩放<input
              value={zoom}
              type="range"
              min="24"
              max="180"
              onChange={(event) => setZoom(Number(event.target.value))}
            />
            <output>{zoom}px/s</output>
          </label>
        </div>
        <div ref={timelineRef} className="ov-timeline-scroll">
          <div
            className="ov-timeline-content"
            style={{ width: Math.max(1100, duration * zoom + 280) }}
            onPointerDown={(event) => {
              if (
                (event.target as Element).closest(".ov-clip,.ov-track-head")
              ) return;
              const rect = event.currentTarget.getBoundingClientRect();
              const value = Math.max(
                0,
                Math.min(duration, (event.clientX - rect.left - 112) / zoom),
              );
              setTime(value);
              seekPreview(value);
            }}
          >
            <Ruler duration={duration} zoom={zoom} />
            {visibleTracks.map((track: any) => (
              <div
                className={`ov-track type-${track.type}${
                  track.hidden ? " hidden" : ""
                }`}
                key={track.id}
              >
                <div className="ov-track-head">
                  <b>{trackMeta[track.type]?.code || "?"}</b>
                  <span>{track.name}</span>
                  <button
                    className={track.muted ? "active" : ""}
                    onClick={() =>
                      commit(
                        updateEditorTrack(projectRef.current, track.id, {
                          muted: !track.muted,
                        }),
                      )}
                  >
                    M
                  </button>
                  <button
                    className={track.locked ? "active" : ""}
                    onClick={() =>
                      commit(
                        updateEditorTrack(projectRef.current, track.id, {
                          locked: !track.locked,
                        }),
                      )}
                  >
                    <IconSymbol name="lock" />
                  </button>
                </div>
                <div className="ov-track-lane">
                  {track.clips.map((clip: any) => {
                    const clipAsset = allAssets.find((asset) =>
                      asset.id === clip.assetId
                    );
                    const mediaUrl = clip.src || clipAsset?.sourceUrl;
                    const hasMedia = Boolean(
                      mediaUrl && ["video", "image"].includes(clip.type),
                    );
                    const hasThumbnail = clip.type === "image" ||
                      Boolean(sourceThumbnail);
                    return (
                    <button
                      key={clip.id}
                      className={`ov-clip clip-${clip.type}${
                        clip.id === selectedId ? " selected" : ""
                      }${hasMedia ? " has-media" : ""}${
                        hasThumbnail ? " has-thumbnail" : ""
                      }`}
                      style={{
                        left: clip.timelineStart * zoom,
                        width: Math.max(12, editorClipDuration(clip) * zoom),
                      }}
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        setSelectedId(clip.id);
                        const clipEnd = clip.timelineStart + editorClipDuration(clip);
                        if (time < clip.timelineStart || time > clipEnd) {
                          seekPreview(clip.timelineStart);
                        }
                        dragRef.current = {
                          id: clip.id,
                          startX: event.clientX,
                          timelineStart: clip.timelineStart,
                        };
                      }}
                      onDoubleClick={() => {
                        setTime(clip.timelineStart);
                        seekPreview(clip.timelineStart);
                      }}
                    >
                      {hasMedia && (
                        <span
                          className="ov-clip-media"
                          aria-hidden="true"
                          style={clip.type === "video" && sourceThumbnail
                            ? { backgroundImage: `url(${sourceThumbnail})` }
                            : undefined}
                        >
                          {clip.type === "image" && <img src={mediaUrl} />}
                        </span>
                      )}
                      <i>
                        {clip.type === "text"
                          ? clip.text
                          : clip.type === "transition"
                          ? clip.transitionKey
                          : clip.type === "effect"
                          ? clip.effectKey
                          : clip.type === "image"
                          ? "贴图"
                          : clipAsset?.name || clip.type}
                      </i>
                      <small>{formatTime(editorClipDuration(clip))}</small>
                    </button>
                    );
                  })}
                </div>
              </div>
            ))}
            <div className="ov-playhead" style={{ left: 112 + time * zoom }}>
              <i />
            </div>
          </div>
        </div>
      </footer>
    </section>,
    document.body,
  );
}

function PanelHeading({ title, count }: { title: string; count: number }) {
  return (
    <header className="ov-panel-heading">
      <div>
        <small>编辑面板</small>
        <strong>{title}</strong>
      </div>
      <span>{count}</span>
    </header>
  );
}
function Ruler({ duration, zoom }: { duration: number; zoom: number }) {
  const step = zoom >= 100 ? 1 : zoom >= 48 ? 5 : 10;
  const ticks = [];
  for (let value = 0; value <= duration + step; value += step) {
    ticks.push(value);
  }
  return (
    <div className="ov-ruler">
      {ticks.map((value) => (
        <span key={value} style={{ left: 112 + value * zoom }}>
          <i />
          {formatTime(value)}
        </span>
      ))}
    </div>
  );
}
function Inspector({
  selected,
  project,
  onUpdate,
  onDelete,
  onDuplicate,
  onCanvasAction,
}: {
  selected: any;
  project: EditorProject;
  onUpdate: (updates: Record<string, unknown>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onCanvasAction: (action: "centerClip" | "fitClip" | "coverClip") => void;
}) {
  if (!selected) {
    return (
      <aside className="ov-inspector">
        <div className="ov-inspector-empty">
          <IconSymbol name="cursor" />
          <strong>选择一个片段</strong>
          <span>在时间线或画布中选择内容后编辑参数</span>
        </div>
      </aside>
    );
  }
  const clip = selected.clip;
  const transform = clip.transform || {};
  const isVisual = ["video", "image", "text"].includes(clip.type);
  return (
    <aside className="ov-inspector">
      <PanelHeading title="检查器" count={1} />
      <div className="ov-selected">
        <i>{trackMeta[selected.track.type]?.code}</i>
        <div>
          <strong>{clip.type === "text" ? clip.text : clip.type}</strong>
          <small>{clip.id}</small>
        </div>
      </div>
      <div className="ov-inspector-section">
        <h4>时间</h4>
        <label>
          <span>开始</span>
          <input
            type="number"
            min="0"
            step=".1"
            value={clip.timelineStart}
            onChange={(event) =>
              onUpdate({ timelineStart: Number(event.target.value) })}
          />
        </label>
        {!["video", "audio"].includes(clip.type) && (
          <label>
            <span>时长</span>
            <input
              type="number"
              min=".08"
              step=".1"
              value={clip.duration}
              onChange={(event) =>
                onUpdate({ duration: Number(event.target.value) })}
            />
          </label>
        )}
        {["video", "audio"].includes(clip.type) && (
          <>
            <label>
              <span>速度</span>
              <select
                value={clip.speed || 1}
                onChange={(event) =>
                  onUpdate({ speed: Number(event.target.value) })}
              >
                {[.5, .75, 1, 1.25, 1.5, 2].map((rate) => (
                  <option key={rate} value={rate}>{rate}×</option>
                ))}
              </select>
            </label>
            <label className="ov-check">
              <span>保留声音</span>
              <input
                type="checkbox"
                checked={!clip.muted}
                onChange={(event) => onUpdate({ muted: !event.target.checked })}
              />
            </label>
          </>
        )}
      </div>
      {clip.type === "text" && (
        <div className="ov-inspector-section">
          <h4>文字</h4>
          <textarea
            value={clip.text}
            rows={3}
            onChange={(event) => onUpdate({ text: event.target.value })}
          />
          <label>
            <span>字体</span>
            <select
              value={clip.style?.fontFamily || "PingFang SC"}
              onChange={(event) =>
                onUpdate({
                  style: { ...clip.style, fontFamily: event.target.value },
                })}
            >
              <option value="PingFang SC">苹方黑体</option>
              <option value="Songti SC">宋体标题</option>
              <option value="Kaiti SC">楷体</option>
              <option value="Hiragino Sans GB">冬青黑体</option>
            </select>
          </label>
          <label>
            <span>字号</span>
            <input
              type="number"
              value={clip.style?.fontSize || 72}
              onChange={(event) =>
                onUpdate({
                  style: {
                    ...clip.style,
                    fontSize: Number(event.target.value),
                  },
                })}
            />
          </label>
          <label>
            <span>字重</span>
            <select
              value={clip.style?.fontWeight || 600}
              onChange={(event) =>
                onUpdate({
                  style: { ...clip.style, fontWeight: Number(event.target.value) },
                })}
            >
              <option value="400">常规</option>
              <option value="500">中等</option>
              <option value="600">半粗</option>
              <option value="700">粗体</option>
            </select>
          </label>
          <label>
            <span>对齐</span>
            <select
              value={clip.style?.align || "center"}
              onChange={(event) =>
                onUpdate({ style: { ...clip.style, align: event.target.value } })}
            >
              <option value="left">左对齐</option>
              <option value="center">居中</option>
              <option value="right">右对齐</option>
            </select>
          </label>
          <label>
            <span>颜色</span>
            <input
              type="color"
              value={clip.style?.color || "#ffffff"}
              onChange={(event) =>
                onUpdate({
                  style: { ...clip.style, color: event.target.value },
                })}
            />
          </label>
        </div>
      )}
      {isVisual && (
        <div className="ov-inspector-section ov-transform-section">
          <h4>画布变换</h4>
          <div className="ov-transform-presets">
            <button onClick={() => onCanvasAction("centerClip")}>居中</button>
            <button onClick={() => onCanvasAction("fitClip")}>适应</button>
            <button onClick={() => onCanvasAction("coverClip")}>填充</button>
          </div>
          {(["x", "y", "width", "height", "angle", "opacity"] as const).map((
            key,
          ) => (
            <label key={key}>
              <span>
                {({
                  x: "X",
                  y: "Y",
                  width: "宽度",
                  height: "高度",
                  angle: "旋转",
                  opacity: "不透明度",
                })[key]}
              </span>
              <input
                type="number"
                step={key === "opacity" ? .05 : 1}
                value={Number(transform[key] ?? (key === "opacity" ? 1 : 0))}
                onChange={(event) =>
                  onUpdate({
                    transform: {
                      ...transform,
                      [key]: Number(event.target.value),
                    },
                  })}
              />
            </label>
          ))}
        </div>
      )}
      <div className="ov-inspector-actions">
        <button onClick={onDuplicate}>复制片段</button>
        <button className="danger" onClick={onDelete}>
          <IconSymbol name="trash" />删除
        </button>
      </div>
      <div className="ov-project-facts">
        <span>工程画布</span>
        <strong>{project.settings.width} × {project.settings.height}</strong>
        <small>{project.settings.fps} FPS · JSON v{project.version}</small>
      </div>
    </aside>
  );
}
