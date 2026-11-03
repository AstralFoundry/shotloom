import {
  DEFAULT_VIDEO_SETTINGS,
  getExportEngine,
  resolveWebCodecsExportLimits,
  setEncoderBackendFactory,
  WebCodecsBackend,
  type Project,
  type Transition,
} from "@openreel/core";
import { getPlaybackBridge, disposePlaybackBridge } from "./bridges/playback-bridge";
import { disposeAudioBridge } from "./bridges/audio-bridge";
import { useEngineStore } from "./stores/engine-store";
import { useProjectStore } from "./stores/project-store";
import { useUIStore } from "./stores/ui-store";
import { useTimelineStore } from "./stores/timeline-store";
import { useThemeStore } from "./stores/theme-store";
import { createEmptyProject } from "./stores/project/project-helpers";
import { saveMediaBlob } from "./services/media-storage";
import { serializeProjectForAutoSave } from "./services/auto-save";
import { EditingSession } from "./services/agent/editing-session";
import {
  disposeEffectsBridge,
  initializeEffectsBridge,
} from "./bridges/effects-bridge";
import {
  disposeTransitionBridge,
  initializeTransitionBridge,
} from "./bridges/transition-bridge";
import {
  isShotloomMode,
  configureShotloomLocale,
  shotloomMessage,
  setShotloomPresentation,
  setShotloomActive,
  isShotloomActive,
  syncShotloomPresentationClass,
  bindShotloomHost,
} from "./shotloom-mode";
import { SHOTLOOM_ACTION_CATALOG } from "./shotloom-action-catalog";
import { createEmbeddedAgent } from './embedded/agent';
import type {
  ClipStudioAction,
  ClipStudioHost,
  ClipStudioExportResult,
  ClipStudioRuntimeController,
  ClipStudioRuntimeEvents,
  ClipStudioRuntimeOptions,
  ClipStudioLayout,
  OpenReelActionResult,
  OpenReelBridgeState,
  OpenReelImportedAsset,
  OpenReelAssetPayload,
} from "./embedded/runtime-types";

type ShotloomAssetPayload = {
  key: string;
  name: string;
  type: "video" | "audio" | "image";
  mime?: string;
  bytes: ArrayBuffer;
  duration?: number;
  width?: number;
  height?: number;
};

type ShotloomClipPayload = {
  sourceConnectionId?: string;
  id: string;
  mediaKey: string;
  start: number;
  duration: number;
  inPoint: number;
  outPoint: number;
  speed?: number;
  volume?: number;
  transform?: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    opacity?: number;
    angle?: number;
    fit?: "fit" | "fill";
  };
};

type ShotloomTransitionPayload = {
  id: string;
  clipAId: string;
  clipBId: string;
  type: string;
  duration: number;
};

type ShotloomTrackPayload = {
  id: string;
  type: "video" | "audio" | "image" | "text" | "graphics";
  name: string;
  locked?: boolean;
  hidden?: boolean;
  muted?: boolean;
  clips: ShotloomClipPayload[];
  transitions: ShotloomTransitionPayload[];
};

type ShotloomSession = Pick<ReturnType<typeof useProjectStore.getState>,
  "clipUndoStack" | "clipRedoStack" | "templateUndoStack" | "templateRedoStack" | "redoJournal"> & {
  undo: ReturnType<ReturnType<typeof useProjectStore.getState>["actionHistory"]["getHistoryEntries"]>;
  redo: ReturnType<ReturnType<typeof useProjectStore.getState>["actionHistory"]["getRedoEntries"]>;
  playhead: number;
  view?: { pixelsPerSecond: number; scrollX: number; scrollY: number };
  selected?: ReturnType<typeof useUIStore.getState>["selectedItems"];
};

type ShotloomLoadPayload = {
  name: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  assets: ShotloomAssetPayload[];
  tracks: ShotloomTrackPayload[];
  nativeProject?: Record<string, unknown> | null;
  session?: ShotloomSession;
};

type NativeMediaItem = {
  id: string;
  name?: string;
  type?: "video" | "audio" | "image";
  metadata?: Record<string, unknown>;
  shotloomAssetId?: string | null;
  [key: string]: unknown;
};

const reverseMediaKeys = new Map<string, string>();
let publishingTimer: ReturnType<typeof setTimeout> | null = null;
let documentDisposed = false;
let runtimeUI: ClipStudioHost["ui"] | undefined;
let embeddedRuntimeEvents: ClipStudioRuntimeEvents | null = null;
let embeddedExportResolver: ((result: ClipStudioExportResult) => void) | null = null;

function post(message: Record<string, unknown>, _transfer: Transferable[] = []) {
  if (message.type === "shotloom:request-activate") runtimeUI?.requestActivate();
  else if (message.type === "shotloom:request-close") runtimeUI?.requestClose();
  if (embeddedRuntimeEvents) {
    if (message.type === "shotloom:state" && message.state) embeddedRuntimeEvents.onState(message.state as OpenReelBridgeState);
    else if (message.type === "shotloom:status" && message.phase) embeddedRuntimeEvents.onStatus(String(message.phase));
    else if (message.type === "shotloom:error") embeddedRuntimeEvents.onError(new Error(String(message.error || shotloomMessage('editor.runtime.failed'))));
    else if (message.type === "shotloom:export-progress") embeddedRuntimeEvents.onExportProgress({ phase: String(message.phase || ""), progress: Number(message.progress || 0) });
    else if (message.type === "shotloom:exported" && message.buffer) {
      const resolve = embeddedExportResolver;
      embeddedExportResolver = null;
      resolve?.({ buffer: message.buffer as ArrayBuffer, mime: String(message.mime || "video/mp4"), size: Number(message.size || (message.buffer as ArrayBuffer).byteLength) });
    }
    return;
  }

}

function fail(error: unknown) {
  post({
    type: "shotloom:error",
    error: error instanceof Error ? error.message : String(error),
  });
}

function status(phase: string) {
  post({ type: "shotloom:status", phase });
}

function mimeOf(asset: ShotloomAssetPayload) {
  if (asset.mime) return asset.mime;
  if (asset.type === "video") return "video/mp4";
  if (asset.type === "audio") return "audio/mpeg";
  return "image/png";
}

function mapTransitionType(type: string): Transition["type"] {
  const normalized = String(type || "").toLowerCase();
  if (normalized.includes("cross") || normalized === "fade") return "crossfade" as Transition["type"];
  if (normalized.includes("circle")) return "circleReveal" as Transition["type"];
  if (normalized.includes("wipe")) return "wipe" as Transition["type"];
  if (normalized.includes("slide")) return "slide" as Transition["type"];
  if (normalized.includes("zoom")) return "zoom" as Transition["type"];
  if (normalized.includes("blur")) return "blur" as Transition["type"];
  if (normalized.includes("push")) return "push" as Transition["type"];
  return "crossfade" as Transition["type"];
}

function defaultTransform(payload: ShotloomClipPayload, width: number, height: number) {
  const transform = payload.transform || {};
  const w = Number(transform.width) || width;
  const h = Number(transform.height) || height;
  return {
    position: {
      x: (Number(transform.x) || 0) + w / 2 - width / 2,
      y: (Number(transform.y) || 0) + h / 2 - height / 2,
    },
    scale: {
      x: w / Math.max(1, width),
      y: h / Math.max(1, height),
    },
    rotation: Number(transform.angle) || 0,
    anchor: { x: 0.5, y: 0.5 },
    opacity: Number.isFinite(Number(transform.opacity)) ? Number(transform.opacity) : 1,
    fitMode: (transform.fit === "fill" ? "cover" : "contain") as "cover" | "contain",
  };
}

type ImportedShotloomAsset = { mediaId: string; item: Record<string, unknown> };
const pendingAssetImports = new Map<string, Promise<ImportedShotloomAsset>>();

async function importShotloomAsset(asset: ShotloomAssetPayload): Promise<ImportedShotloomAsset> {
  const project = useProjectStore.getState().project;
  const existing = project.mediaLibrary.items.find((item) =>
    reverseMediaKeys.get(item.id) === asset.key ||
    (item as unknown as NativeMediaItem).shotloomAssetId === asset.key);
  if (existing && !existing.isPlaceholder && !(existing as unknown as NativeMediaItem).shotloomOverview) {
    reverseMediaKeys.set(existing.id, asset.key);
    return { mediaId: existing.id, item: existing as unknown as Record<string, unknown> };
  }
  const claim = JSON.stringify([project.id, asset.key]);
  const pending = pendingAssetImports.get(claim);
  if (pending) return pending;
  const operation = (async () => {
    const file = new File([asset.bytes], asset.name, { type: mimeOf(asset) });
    const result = await useProjectStore.getState().importMedia(file);
    if (!result.success || !result.actionId) {
      throw new Error(shotloomMessage('editor.runtime.importFailed', { name: asset.name, error: result.error?.message || 'unknown' }));
    }
    if (useProjectStore.getState().project.id !== project.id) throw new Error(shotloomMessage('editor.runtime.importProjectChanged'));
    const mediaId = result.actionId;
    const item = useProjectStore.getState().project.mediaLibrary.items.find(
      (candidate) => candidate.id === mediaId,
    );
    if (!item) throw new Error(shotloomMessage('editor.runtime.importMissing', { name: asset.name }));
    reverseMediaKeys.set(mediaId, asset.key);
    return {
      mediaId,
      item: item as unknown as Record<string, unknown>,
    };
  })();
  pendingAssetImports.set(claim, operation);
  try { return await operation; }
  finally { if (pendingAssetImports.get(claim) === operation) pendingAssetImports.delete(claim); }
}

async function importShotloomAssets(assets: ShotloomAssetPayload[], recoverable?: { keys: Set<string>; failures: Map<string, string> }) {
  const imported = new Map<string, ImportedShotloomAsset>();
  const projectId = useProjectStore.getState().project.id;
  for (const asset of assets) {
    try {
      imported.set(asset.key, await importShotloomAsset(asset));
    } catch (error) {
      // Existing native media can remain offline without losing its clips or
      // history. New imports and stale project loads still fail explicitly.
      if (useProjectStore.getState().project.id !== projectId || !recoverable?.keys.has(asset.key)) throw error;
      recoverable.failures.set(asset.key, error instanceof Error ? error.message : String(error));
    }
  }
  return imported;
}

function buildTracksFromSummary(
  payload: ShotloomLoadPayload,
  imported: Map<string, { mediaId: string; item: Record<string, unknown> }>,
) {
  const tracks = payload.tracks.map((track) => ({
    id: track.id,
    type: track.type,
    name: track.name,
    locked: track.locked === true,
    hidden: track.hidden === true,
    muted: track.muted === true,
    solo: false,
    clips: track.clips.map((clip) => {
      const mediaId = imported.get(clip.mediaKey)?.mediaId || "";
      if (!mediaId) {
        throw new Error(shotloomMessage('editor.runtime.clipMediaMissing', { clipId: clip.id, mediaKey: clip.mediaKey }));
      }
      return {
        id: clip.id,
        ...(clip.sourceConnectionId ? { sourceConnectionId: clip.sourceConnectionId } : {}),
        mediaId,
        trackId: track.id,
        startTime: Math.max(0, Number(clip.start) || 0),
        duration: Math.max(0.01, Number(clip.duration) || 0.01),
        inPoint: Math.max(0, Number(clip.inPoint) || 0),
        outPoint: Math.max(0, Number(clip.outPoint) || 0),
        effects: [],
        audioEffects: [],
        transform: defaultTransform(clip, payload.width, payload.height),
        volume: Number.isFinite(Number(clip.volume)) ? Number(clip.volume) : 1,
        keyframes: [],
        speed: Number.isFinite(Number(clip.speed)) ? Number(clip.speed) : 1,
      };
    }),
    transitions: track.transitions.map((transition) => ({
      id: transition.id,
      clipAId: transition.clipAId,
      clipBId: transition.clipBId,
      type: mapTransitionType(transition.type),
      duration: Math.max(0.05, Number(transition.duration) || 0.6),
      params: {},
    })),
  }));
  return tracks;
}

async function restoreNativeMedia(
  nativeProject: Record<string, unknown>,
  projectId: string,
  imported: Map<string, { mediaId: string; item: Record<string, unknown> }>,
  failures: Map<string, string>,
) {
  const nativeLibrary = (nativeProject.mediaLibrary || {}) as {
    items?: NativeMediaItem[];
  };
  const nativeItems = Array.isArray(nativeLibrary.items) ? nativeLibrary.items : [];
  const restoredItems: Record<string, unknown>[] = [];
  const consumedKeys = new Set<string>();
  for (const item of nativeItems) {
    const key = item.shotloomAssetId;
    if (key) reverseMediaKeys.set(item.id, key);
    const importedEntry = key ? imported.get(key) : undefined;
    if (importedEntry) {
      if (key) consumedKeys.add(key);
      const restored = {
        ...importedEntry.item,
        id: item.id,
        name: item.name || importedEntry.item.name,
        type: item.type || importedEntry.item.type,
        metadata: {
          ...((importedEntry.item.metadata || {}) as Record<string, unknown>),
          ...((item.metadata || {}) as Record<string, unknown>),
        },
        shotloomAssetId: key,
        fileHandle: null,
        isPlaceholder: false,
      };
      const blob = importedEntry.item.blob as Blob | undefined;
      if (blob) {
        try {
          await saveMediaBlob(
            projectId,
            item.id,
            blob,
            restored.metadata as never,
          );
        } catch (error) {
          console.error("[shotloom-bridge] Failed to persist restored media", error);
        }
      }
      restoredItems.push(restored);
      if (key) reverseMediaKeys.set(item.id, key);
    } else {
      restoredItems.push({
        ...item,
        blob: null,
        fileHandle: null,
        waveformData: null,
        thumbnailUrl: null,
        filmstripThumbnails: undefined,
        isPlaceholder: true,
        shotloomOfflineReason: (key && failures.get(key)) || shotloomMessage('editor.runtime.offline'),
      });
    }
  }
  for (const [key, entry] of imported) {
    if (consumedKeys.has(key)) continue;
    restoredItems.push({
      ...entry.item,
      shotloomAssetId: key,
    });
    reverseMediaKeys.set(entry.mediaId, key);
  }
  return restoredItems;
}

async function reinitializeBridges(width: number, height: number) {
  try {
    disposeEffectsBridge();
  } catch {}
  try {
    await initializeEffectsBridge(width, height);
  } catch (error) {
    console.error("[shotloom-bridge] EffectsBridge reinit failed:", error);
  }
  try {
    disposeTransitionBridge();
  } catch {}
  try {
    initializeTransitionBridge(width, height);
  } catch (error) {
    console.error("[shotloom-bridge] TransitionBridge reinit failed:", error);
  }
  // 先把已加载的工程重新灌一次，让新尺寸的 effects/transition 桥拿到当前工程状态。
  try {
    useProjectStore.getState().loadProject(useProjectStore.getState().getFullProject());
  } catch (error) {
    console.error("[shotloom-bridge] bridge resync failed:", error);
  }
}

async function loadProject(payload: ShotloomLoadPayload) {
  status(shotloomMessage('editor.runtime.importing'));
  const native = payload.nativeProject || null;
  const nativeSettings = (native?.settings || {}) as Record<string, unknown>;
  const nativeTimeline = (native?.timeline || {}) as Record<string, unknown>;
  const width = Math.max(2, Math.round(Number(nativeSettings.width) || payload.width || 1920));
  const height = Math.max(2, Math.round(Number(nativeSettings.height) || payload.height || 1080));
  const fps = Math.max(1, Number(nativeSettings.frameRate) || payload.fps || 30);
  const generated = createEmptyProject(
    String(native?.name || payload.name || shotloomMessage('editor.runtime.projectName')),
    { width, height, frameRate: fps },
  );
  const empty: Project = native?.id ? { ...generated, id: String(native.id) } : generated;
  // Keep the same renderer's read-only timeline visible while media is restored.
  // Importing into its library is temporary; the authoritative snapshot replaces it below.
  useProjectStore.getState().loadProject(empty);
  reverseMediaKeys.clear();

  const failures = new Map<string, string>();
  const nativeItems = (native?.mediaLibrary as { items?: NativeMediaItem[] } | undefined)?.items || [];
  const imported = await importShotloomAssets(payload.assets, native ? {
    keys: new Set(nativeItems.map(item => item.shotloomAssetId).filter((key): key is string => Boolean(key))), failures,
  } : undefined);

  if (native) {
    status(shotloomMessage('editor.runtime.restoring'));
    const projectId = String(native.id || empty.id);
    const mediaItems = await restoreNativeMedia(native, projectId, imported, failures);
    const restored: Project = {
      ...(native as unknown as Project),
      id: projectId,
      name: String(native.name || empty.name),
      settings: {
        ...empty.settings,
        ...nativeSettings,
        width,
        height,
        frameRate: fps,
      },
      mediaLibrary: { items: mediaItems as never },
      timeline: {
        ...empty.timeline,
        ...nativeTimeline,
        duration: Math.max(0, Number(nativeTimeline.duration) || 0),
      } as never,
      modifiedAt: Date.now(),
    };
    useProjectStore.getState().loadProject(restored);
  } else {
    const tracks = buildTracksFromSummary(payload, imported);
    const current = useProjectStore.getState().project;
    const project: Project = {
      ...empty,
      name: payload.name || empty.name,
      settings: {
        ...empty.settings,
        width,
        height,
        frameRate: fps,
      },
      mediaLibrary: current.mediaLibrary,
      timeline: {
        tracks,
        subtitles: [],
        duration: Math.max(0, Number(payload.duration) || 0),
        markers: [],
      } as never,
      modifiedAt: Date.now(),
    };
    useProjectStore.getState().loadProject(project);
  }

  await reinitializeBridges(width, height);
  useUIStore.getState().setSkipWelcomeScreen(true);
  useUIStore.getState().clearSelection?.();
  const restoredSession = payload.session || payload.nativeProject?.shotloomSession as ShotloomSession | undefined;
  if (restoredSession) {
    const { undo, redo, playhead, view, selected, ...stacks } = restoredSession;
    useProjectStore.getState().actionHistory.restoreEntries(undo, redo);
    useProjectStore.setState(stacks);
    await getPlaybackBridge().seek(playhead);
    if (view) useTimelineStore.setState(view);
    if (selected) useUIStore.setState({ selectedItems: selected });
  } else {
    await getPlaybackBridge().seek(0);
  }
  window.location.hash = "#/editor";
  document.body.inert = false;
  document.body.classList.remove("shotloom-restoring");
  post({
    type: "shotloom:loaded",
    projectId: useProjectStore.getState().project.id,
    duration: useProjectStore.getState().project.timeline.duration,
    media: useProjectStore.getState().project.mediaLibrary.items.length,
  });
  postState();
}

function collectNativeSnapshot() {
  const project = useProjectStore.getState().getFullProject();
  const serialized = JSON.parse(serializeProjectForAutoSave(project)) as Record<string, unknown>;
  const library = (serialized.mediaLibrary || {}) as { items?: NativeMediaItem[] };
  if (Array.isArray(library.items)) {
    serialized.mediaLibrary = {
      ...library,
      items: library.items.map((item) => ({
        ...item,
        shotloomAssetId: reverseMediaKeys.get(item.id) || item.shotloomAssetId || null,
      })),
    };
  }
  return serialized;
}

export function collectShotloomState() {
  const store = useProjectStore.getState();
  if (!store.hasOpenProject) {
    return {
      native: null,
      playhead: 0,
      selectedClipIds: [],
      canUndo: false,
      canRedo: false,
      duration: 0,
    };
  }
  const selected = useUIStore.getState().selectedItems || [];
  const native = collectNativeSnapshot();
  const view = useTimelineStore.getState();
  // Presentation-only projection: no media bytes, history or executable session.
  // Reusing the native timeline avoids a second layout implementation drifting on takeover.
  const overview = {
    id: native.id, name: native.name, settings: native.settings,
    timeline: native.timeline,
    textClips: native.textClips, shapeClips: native.shapeClips,
    svgClips: native.svgClips, stickerClips: native.stickerClips,
    shotloomSession: { view: { pixelsPerSecond: view.pixelsPerSecond, scrollX: view.scrollX, scrollY: view.scrollY }, playhead: view.playheadPosition, selected },
    mediaLibrary: { items: store.project.mediaLibrary.items.map(item => ({
      id: item.id, name: item.name, type: item.type, metadata: item.metadata,
      thumbnailUrl: item.thumbnailUrl?.startsWith("data:") ? item.thumbnailUrl : null,
      filmstripThumbnails: item.filmstripThumbnails?.filter(thumb => thumb.url.startsWith("data:")),
      waveformData: item.waveformData ? Array.from(item.waveformData) : null,
      blob: null, fileHandle: null, isPlaceholder: item.isPlaceholder,
    })) },
  };
  return {
    native,
    overview,
    // The host persists this session alongside the native project, including view and undo history.
    session: {
      view: { pixelsPerSecond: useTimelineStore.getState().pixelsPerSecond, scrollX: useTimelineStore.getState().scrollX, scrollY: useTimelineStore.getState().scrollY },
      selected,
      undo: store.actionHistory.getHistoryEntries(),
      redo: store.actionHistory.getRedoEntries(),
      clipUndoStack: store.clipUndoStack,
      clipRedoStack: store.clipRedoStack,
      templateUndoStack: store.templateUndoStack,
      templateRedoStack: store.templateRedoStack,
      redoJournal: store.redoJournal,
      playhead: useTimelineStore.getState().playheadPosition || 0,
    } satisfies ShotloomSession,
    playhead: useTimelineStore.getState().playheadPosition || 0,
    selectedClipIds: selected.map((item) => item.id),
    canUndo: store.canUndo(),
    canRedo: store.canRedo(),
    duration: store.project.timeline.duration || 0,
  };
}

function postState() {
  try {
    post({ type: "shotloom:state", state: collectShotloomState() });
  } catch (error) {
    console.error("[shotloom-bridge] Failed to collect state", error);
  }
}

function scheduleState() {
  if (!isShotloomMode || documentDisposed) return;
  if (publishingTimer) clearTimeout(publishingTimer);
  publishingTimer = setTimeout(() => {
    publishingTimer = null;
    postState();
  }, 600);
}

async function relinkMedia(mediaId: string, asset: ShotloomAssetPayload): Promise<void> {
  const before = useProjectStore.getState().project;
  const item = before.mediaLibrary.items.find((entry) => entry.id === mediaId) as NativeMediaItem | undefined;
  if (!item || !item.isPlaceholder || item.type !== asset.type || (item.shotloomAssetId && item.shotloomAssetId !== asset.key)) throw new Error(shotloomMessage('editor.runtime.relinkChanged'));
  const result = await useProjectStore.getState().replaceMediaAsset(mediaId, new File([asset.bytes], asset.name, { type: mimeOf(asset) }));
  if (!result.success) throw new Error(result.error?.message || shotloomMessage('editor.runtime.relinkFailed'));
  const current = useProjectStore.getState().project;
  if (current.id !== before.id) throw new Error(shotloomMessage('editor.runtime.restoreProjectChanged'));
  useProjectStore.setState({ project: { ...current, mediaLibrary: { ...current.mediaLibrary, items: current.mediaLibrary.items.map((entry) => entry.id === mediaId ? { ...entry, shotloomAssetId: asset.key } : entry) } } });
  reverseMediaKeys.set(mediaId, asset.key);
  void getPlaybackBridge().seek(useTimelineStore.getState().playheadPosition).catch(fail);
}

async function exportProject(
  settings: { width?: number; height?: number; fps?: number } = {},
  requestId?: string,
) {
  postState();
  const project = structuredClone(useProjectStore.getState().getFullProject());
  const engine = getExportEngine();
  if (!engine.isInitialized()) await engine.initialize();
  let buffer = new Uint8Array(0);
  let length = 0;
  let cursor = 0;
  const ensure = (size: number) => {
    if (buffer.length >= size) return;
    const next = new Uint8Array(Math.max(size, buffer.length * 2, 1 << 20));
    next.set(buffer);
    buffer = next;
  };
  const writable: any = {
    async seek(position: number) {
      cursor = Math.max(0, Number(position) || 0);
    },
    async write(chunk: unknown) {
      const bytes = chunkToBytes(chunk);
      if (!bytes) return;
      ensure(cursor + bytes.byteLength);
      buffer.set(bytes, cursor);
      cursor += bytes.byteLength;
      length = Math.max(length, cursor);
    },
    async close() {},
    async abort() {},
  };
  const width = Number(settings.width) || project.settings.width;
  const height = Number(settings.height) || project.settings.height;
  const frameRate = Number(settings.fps) || project.settings.frameRate;
  const limits = resolveWebCodecsExportLimits({ ...DEFAULT_VIDEO_SETTINGS, width, height, frameRate }, project.timeline.duration);
  if (limits.wasAdjusted) throw new Error(shotloomMessage('editor.runtime.unsupportedPreset'));
  // Product exports return muxed bytes for canvas delivery. Native Agent
  // exports publish their own files, so scope the byte-producing backend here.
  const previousFactory = setEncoderBackendFactory(library => new WebCodecsBackend(library!));
  try {
  const generator = engine.exportVideo(project, {
    ...DEFAULT_VIDEO_SETTINGS,
    width,
    height,
    frameRate,
  }, writable);
  let result: any;
  for (;;) {
    const next = await generator.next();
    if (next.done) {
      result = next.value;
      break;
    }
    post({ type: "shotloom:export-progress", requestId, phase: next.value.phase, progress: next.value.progress });
  }
  if (!result?.success) {
    throw new Error(result?.error?.message || shotloomMessage('editor.runtime.exportFailed'));
  }
  const blob = new Blob([buffer.slice(0, length)], { type: "video/mp4" });
  const arrayBuffer = await blob.arrayBuffer();
  postState();
  post({ type: "shotloom:exported", requestId, buffer: arrayBuffer, mime: blob.type, size: blob.size }, [arrayBuffer]);
  } finally { setEncoderBackendFactory(previousFactory); }
}

function chunkToBytes(chunk: unknown): Uint8Array | null {
  if (chunk instanceof Uint8Array) return chunk;
  if (chunk instanceof ArrayBuffer) return new Uint8Array(chunk);
  if (ArrayBuffer.isView(chunk)) return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  if (chunk && typeof chunk === "object" && "data" in chunk) {
    const data = (chunk as { data?: unknown }).data;
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
  }
  return null;
}

if (isShotloomMode) {
  // Release decoders and audio when the desktop document leaves.
  window.addEventListener("pagehide", (event) => {
    if (event.persisted || documentDisposed) return;
    documentDisposed = true;
    if (publishingTimer) clearTimeout(publishingTimer);
    publishingTimer = null;
    for (const dispose of [disposePlaybackBridge, disposeAudioBridge, disposeEffectsBridge, disposeTransitionBridge, useEngineStore.getState().dispose]) {
      try { dispose(); } catch (error) { console.error("[shotloom-bridge] Document cleanup failed", error); }
    }
  });
  document.body.classList.add("shotloom-mode");
  syncShotloomPresentationClass();
  localStorage.setItem("openreel-onboarding-complete", "true");
  localStorage.setItem("openreel-mograph-tour-complete", "true");
  useThemeStore.getState().setMode("light");
  document.documentElement.dataset.theme = "light";
  useUIStore.getState().setSkipWelcomeScreen(true);
  window.location.hash = "#/editor";

  window.addEventListener("pointerdown", (event) => {
    if (!document.body.classList.contains("shotloom-canvas") || isShotloomActive()) return;
    post({ type: "shotloom:request-activate" });
    setShotloomActive(true);
    const target = event.target as Element | null;
    if (!target?.closest("button,input,[role=menuitem]")) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
  window.addEventListener("keydown", (event) => {
    if (!isShotloomActive()) { event.stopImmediatePropagation(); return; }
    if (event.key === "Escape" && !document.querySelector('[role="dialog"],[role="menu"]')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      post({ type: "shotloom:request-close" });
    }
  }, true);
  useProjectStore.subscribe((state, previous) => {
    if (state.project !== previous.project) scheduleState();
  });
  useUIStore.subscribe((state, previous) => {
    if (state.selectedItems !== previous.selectedItems) scheduleState();
  });
  useTimelineStore.subscribe((state, previous) => {
    if (state.playbackState !== "playing" && (state.playheadPosition !== previous.playheadPosition || state.pixelsPerSecond !== previous.pixelsPerSecond || state.scrollX !== previous.scrollX || state.scrollY !== previous.scrollY)) scheduleState();
  });
}

export function getShotloomActionCatalog() {
  return SHOTLOOM_ACTION_CATALOG;
}

/** Direct, iframe-free controller used by the ShadowRoot host. */
export function createEmbeddedRuntime(options: ClipStudioRuntimeOptions): ClipStudioRuntimeController {
  configureShotloomLocale(options.host.app.locale);
  let disposed = false;
  const events = options.events;
  const nativeTool = createEmbeddedAgent(options.host);
  runtimeUI = options.host.ui;
  bindShotloomHost(runtimeUI, async (files) => { await ready; const assets = await options.host.ui.ingestFiles(files); await importShotloomAssets(assets); postState(); });
  embeddedRuntimeEvents = events;
  const ready = (async () => {
    await options.host.ready;
    const engine = useEngineStore.getState();
    if (!engine.initialized) await engine.initialize();
    const { initializeMediaBridge } = await import("./bridges/media-bridge");
    const { initializePlaybackBridge } = await import("./bridges/playback-bridge");
    const { initializeRenderBridge } = await import("./bridges/render-bridge");
    await initializeMediaBridge();
    await initializePlaybackBridge();
    await initializeRenderBridge();
  })();
  let pendingOperation: Promise<unknown> = Promise.resolve();
  const enqueue = <T,>(operation: () => Promise<T>): Promise<T> => { const next = pendingOperation.then(operation); pendingOperation = next.catch(() => {}); return next; };
  const state = async () => {
    await ready;
    const next = collectShotloomState();
    events.onState(next);
    return next;
  };
  const execute = async (actions: ClipStudioAction[], options2: { validateOnly?: boolean; description?: string } = {}): Promise<OpenReelActionResult> => {
    await ready;
    const session = new EditingSession();
    const results: Array<{ type: string; success: boolean; error?: unknown }> = [];
    try {
      session.beginTransaction();
      for (const input of actions) {
        const action = { type: String(input.type || ""), id: crypto.randomUUID(), timestamp: Date.now(), params: input.params || {} };
        const result = await session.applyAction(action);
        results.push({ type: action.type, success: result.success, error: result.error });
        if (!result.success) { await session.rollbackTransaction(); return { success: false, validateOnly: Boolean(options2.validateOnly), results, error: String(result.error || shotloomMessage('editor.runtime.actionFailed')), state: await state() }; }
      }
      if (options2.validateOnly) await session.rollbackTransaction();
      else await session.commitTransaction({ id: crypto.randomUUID() }, options2.description || shotloomMessage('editor.runtime.editOperation'));
      return { success: true, validateOnly: Boolean(options2.validateOnly), results, state: await state() };
    } catch (error) {
      try { await session.rollbackTransaction(); } catch {}
      return { success: false, validateOnly: Boolean(options2.validateOnly), results, error: error instanceof Error ? error.message : String(error), state: await state() };
    }
  };
  return {
    ready,
    executeNativeTool: (name, input) => enqueue(async () => {
      await ready;
      if (disposed) throw new Error(shotloomMessage('editor.runtime.closed'));
      const result = await nativeTool(name, input);
      await state();
      return result;
    }),
    load: async (payload) => { await ready; await loadProject(payload as unknown as ShotloomLoadPayload); return state(); },
    getState: async () => { await pendingOperation; return state(); },
    importAssets: async (assets: OpenReelAssetPayload[]) => {
      await ready;
      const imported = await importShotloomAssets(assets);
      const result = [...imported.entries()].map(([key, entry]): OpenReelImportedAsset => ({ key, mediaId: entry.mediaId, name: String(entry.item.name || ""), type: entry.item.type as OpenReelImportedAsset["type"], duration: Number((entry.item.metadata as Record<string, unknown> | undefined)?.duration || 0), width: Number((entry.item.metadata as Record<string, unknown> | undefined)?.width || 0), height: Number((entry.item.metadata as Record<string, unknown> | undefined)?.height || 0) }));
      await state(); return result;
    },
    relinkMedia: (mediaId, asset) => enqueue(async () => {
      await ready;
      try { await relinkMedia(mediaId, asset); return { success: true, validateOnly: false, results: [], state: await state() }; }
      catch (error) { return { success: false, validateOnly: false, results: [], error: error instanceof Error ? error.message : String(error), state: await state() }; }
    }),
    executeActions: (actions, actionOptions) => enqueue(() => execute(actions, actionOptions)),
    undo: () => enqueue(async () => { await ready; await useProjectStore.getState().undo(); return state(); }),
    redo: () => enqueue(async () => { await ready; await useProjectStore.getState().redo(); return state(); }),
    seek: async (time) => { await ready; await getPlaybackBridge().seek(time); return state(); },
    togglePlayback: async () => { await ready; await getPlaybackBridge().togglePlayback(); },
    setPresentation: (presentation, layout?: ClipStudioLayout) => {
      setShotloomPresentation(presentation);
      if (layout) {
        useTimelineStore.setState({ trackHeight: layout.row, trackHeights: {} });
        document.documentElement.style.setProperty("--clip-preview-gap", `${layout.previewGap}px`);
        document.documentElement.style.setProperty("--clip-rail", `${layout.rail}px`);
        document.documentElement.style.setProperty("--clip-ruler", `${layout.ruler}px`);
      }
      // Moving a session between the canvas card and the full editor can
      // recreate or resize its preview canvas. Re-seek the current frame so a
      // cleared canvas never remains black after the handoff.
      void getPlaybackBridge().seek(useTimelineStore.getState().playheadPosition).catch(() => {});
    },
    setActive: (active) => {
      setShotloomActive(active);
      if (!active) {
        getPlaybackBridge().pause();
        return;
      }
      // React-flow movement can temporarily deactivate the embedded session.
      // Refresh the visible frame when it becomes active again.
      void getPlaybackBridge().seek(useTimelineStore.getState().playheadPosition).catch(() => {});
    },
    export: (options2 = {}) => enqueue(async () => { await ready; if (options2.format === "srt") { const text = await useProjectStore.getState().exportSRT(); if (!text.trim()) throw new Error(shotloomMessage('editor.runtime.noSubtitles')); const buffer = new TextEncoder().encode(text).buffer; return { buffer, mime: "application/x-subrip", size: buffer.byteLength }; } return new Promise<ClipStudioExportResult>((resolve, reject) => { embeddedExportResolver = resolve; void exportProject(options2.settings || {}).catch(reject); }); }),
    cancelExport: () => { try { getExportEngine().cancel(); } catch {} },
    getActionCatalog: () => SHOTLOOM_ACTION_CATALOG,
    dispose: async () => { if (disposed) return; disposed = true; embeddedRuntimeEvents = null; embeddedExportResolver = null; documentDisposed = true; if (publishingTimer) clearTimeout(publishingTimer); for (const disposeFn of [disposePlaybackBridge, disposeAudioBridge, disposeEffectsBridge, disposeTransitionBridge, useEngineStore.getState().dispose]) { try { disposeFn(); } catch {} } },
  };
}
