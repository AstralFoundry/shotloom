import { editorMessage } from "../../shotloom-mode";
import React, {
  useRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import { TimelineRangeActions } from "./timeline/TimelineRange";
import {
  Play,
  Pause,
  Undo2,
  Redo2,
  Layers,
  Maximize2,
  Minimize2,
  Music,
  Type,
  Scissors,
  Copy,
  Delete,
  CornerDownLeft,
  CornerDownRight,
  ChevronUp,
  ChevronDown,
  Trash2,
  Plus,
  ChevronDown as ChevronDownIcon,
  Magnet,
  Rows3,
  Rows2,
  ZoomIn,
  ZoomOut,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Volume2,
  VolumeX,
  Pencil,
  Captions,
  Keyboard,
  Upload,
  Download,
  Search,
  History,
  Diamond,
} from "@/icons/lucide-compat";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import {
  ToolcraftDropdownMenu as DropdownMenu,
  type ToolcraftDropdownMenuOption as DropdownMenuOption,
  ToolcraftPopover as Popover,
  ToolcraftText as Text,
} from "@openreel/ui";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore, ZOOM_PRESETS } from "../../stores/timeline-store";
import { useCompactEditor } from "../../hooks/useCompactEditor";
import { SHORTCUTS_MODAL_ID, useUIStore } from "../../stores/ui-store";
import { toast } from "../../stores/notification-store";
import { useEngineStore } from "../../stores/engine-store";
import { getPlaybackBridge } from "../../bridges/playback-bridge";
import { trackHasAudioItems, trackHasVisualItems } from "@openreel/core";
import {
  deleteTimelineItem,
  duplicateTimelineItem,
  getTimelineItemRanges,
  getSplittableTimelineItemIds,
  getTimelineMarqueeSelection,
  splitTimelineItem,
  trimTimelineItemToPlayhead,
} from "../../utils/timeline-item-actions";
import {
  Playhead,
  TimeRuler,
  TrackHeader,
  TrackLane,
  BeatMarkerOverlay,
  MarkerIndicator,
  getTrackInfo,
} from "./timeline/index";
import {
  filterTrackLayerEntries,
  type TrackLayerFilter,
} from "./timeline/track-layer-filter";
import { getTrackDragAutoScrollDelta } from "./timeline/track-drag-auto-scroll";
import {
  moveLinkedCaptions,
  trimLinkedCaptions,
} from "../../utils/linked-caption-edit";
import { CaptionBatchSelectButton } from "./timeline/CaptionBatchSelectButton";
import { isShotloomMode, useShotloomPresentation, requestShotloomExpand, requestShotloomImport, requestShotloomExport } from "../../shotloom-mode";

const LABELED_TOOL_CLASS =
  "inline-flex h-8 shrink-0 items-center gap-1 rounded-md pl-1.5 pr-2 text-[13px] tracking-[-0.52px] text-fg-2 transition-colors duration-75 hover:bg-bg-2 hover:text-fg";

// Small, mockup-styled timeline tool button
// 工具条按钮必须定义在组件外：Timeline 订阅了整个 useTimelineStore，播放时指针位置
// 仍会以 10Hz 提交进来触发重渲染（逐帧位置只走 <Playhead> 自己的 rAF，见 stores/playhead-live-time）。
// 写在函数体内的箭头函数会变成新的组件类型，React 会卸载重建整棵子树，
// 中文覆盖层因此每次都要重新翻译一次，界面上就是文案在英文与中文之间闪。
const TLTool = ({
  onClick,
  disabled,
  active,
  title,
  children,
  extra,
}: {
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  active?: boolean;
  title?: string;
  children: React.ReactNode;
  extra?: React.ReactNode;
}) => (
  <button
    type="button"
    aria-label={title ?? editorMessage("editor.timeline.toolbar.tool")}
    onClick={onClick}
    disabled={disabled}
    data-tip-bottom={title}
    className={`relative grid h-8 w-8 place-items-center rounded-[9px] transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
      active ? "bg-bg-3 text-fg" : "text-fg-2 hover:bg-bg-2 hover:text-fg"
    }`}
  >
    {children}
    {extra}
  </button>
);

// 参考剪辑台在时间线工具条上放的是两个带文字的入口（字幕 / 快捷键），
// 图标 20px、文字 13px，与纯图标键明显区分。
const TLToolLabeled = ({
  onClick,
  title,
  icon,
  children,
}: {
  onClick?: () => void;
  title?: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    aria-label={title}
    data-tip-bottom={title}
    onClick={onClick}
    className={LABELED_TOOL_CLASS}
  >
    {icon}
    <span>{children}</span>
  </button>
);

const TRACK_LAYER_FILTERS: readonly {
  id: TrackLayerFilter;
  label: () => string;
}[] = [
  { id: "all", label: () => editorMessage("editor.timeline.toolbar.all") },
  { id: "video", label: () => editorMessage("editor.timeline.toolbar.video") },
  { id: "image", label: () => editorMessage("editor.timeline.toolbar.image") },
  { id: "audio", label: () => editorMessage("editor.timeline.toolbar.audio") },
  { id: "text", label: () => editorMessage("editor.timeline.toolbar.text") },
  { id: "graphics", label: () => editorMessage("editor.timeline.toolbar.graphics") },
];

const ADD_TRACK_ROW_HEIGHT = 36;
const TIMELINE_SCROLLBAR_SIZE = 10;

const zoomFillPercent = (pixelsPerSecond: number) =>
  Math.max(
    0,
    Math.min(
      100,
      ((pixelsPerSecond - ZOOM_PRESETS.MIN) /
        (ZOOM_PRESETS.MAX - ZOOM_PRESETS.MIN)) *
        100,
    ),
  );

/** 参考剪辑台的走带时间码：MM:SS，不是秒.百分秒。 */
function formatClock(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export const Timeline: React.FC = () => {
  const compact = useCompactEditor();
  const canvas = useShotloomPresentation() === "canvas";
  const headerWidth = canvas ? 44 : compact ? 108 : 140;
  useEffect(() => {
    if (!canvas) return;
    const { trackHeight, trackHeights } = useTimelineStore.getState();
    useTimelineStore.setState({ trackHeight: 80, trackHeights: {} });
    return () => useTimelineStore.setState({ trackHeight, trackHeights });
  }, [canvas]);
  const containerRef = useRef<HTMLDivElement>(null);
  const tracksRef = useRef<HTMLDivElement>(null);
  const trackHeadersRef = useRef<HTMLDivElement>(null);
  const suppressNextBackgroundClickRef = useRef(false);
  const trackDragPointerYRef = useRef<number | null>(null);
  const trackDragAutoScrollFrameRef = useRef<number | null>(null);

  const {
    project,
    undo,
    redo,
    canUndo,
    canRedo,
    addTrack,
    duplicateTrack,
    reorderTrack,
    removeMarker,
    updateMarker,
    updateClipKeyframes,
    rippleDeleteClip,
    hideTrack,
    lockTrack,
    muteTrack,
    soloTrack,
    renameTrack,
    removeTrack,
  } = useProjectStore();
  const tracks = project.timeline.tracks;

  const [draggedTrackId, setDraggedTrackId] = React.useState<string | null>(
    null,
  );

  const stopTrackDrag = useCallback(() => {
    if (trackDragAutoScrollFrameRef.current !== null) {
      cancelAnimationFrame(trackDragAutoScrollFrameRef.current);
      trackDragAutoScrollFrameRef.current = null;
    }
    trackDragPointerYRef.current = null;
    setDraggedTrackId(null);
  }, []);

  const startTrackDragAutoScroll = useCallback(() => {
    if (trackDragAutoScrollFrameRef.current !== null) {
      cancelAnimationFrame(trackDragAutoScrollFrameRef.current);
    }

    const scrollFrame = () => {
      const viewport = tracksRef.current;
      const pointerY = trackDragPointerYRef.current;

      if (viewport && pointerY !== null) {
        const rect = viewport.getBoundingClientRect();
        const maxScrollTop = Math.max(
          0,
          viewport.scrollHeight - viewport.clientHeight,
        );
        const delta = getTrackDragAutoScrollDelta(
          pointerY,
          rect.top,
          rect.bottom,
          viewport.scrollTop,
          maxScrollTop,
        );

        if (delta !== 0) {
          viewport.scrollTop = Math.max(
            0,
            Math.min(maxScrollTop, viewport.scrollTop + delta),
          );
        }
      }

      trackDragAutoScrollFrameRef.current = requestAnimationFrame(scrollFrame);
    };

    trackDragAutoScrollFrameRef.current = requestAnimationFrame(scrollFrame);
  }, []);

  useEffect(
    () => () => {
      if (trackDragAutoScrollFrameRef.current !== null) {
        cancelAnimationFrame(trackDragAutoScrollFrameRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!draggedTrackId) return;

    const trackPointerAcrossEditor = (event: DragEvent) => {
      trackDragPointerYRef.current = event.clientY;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    };

    // Capture the native drag event before child controls or the context-menu
    // wrapper can consume it. This makes the entire header column participate
    // in edge scrolling, including gaps exposed as the list moves underneath
    // a stationary pointer.
    window.addEventListener("dragover", trackPointerAcrossEditor, true);
    return () => {
      window.removeEventListener("dragover", trackPointerAcrossEditor, true);
    };
  }, [draggedTrackId]);

  const {
    playheadPosition,
    playbackState,
    pixelsPerSecond,
    scrollX,
    scrollY,
    viewportWidth,
    setScrollX,
    setScrollY,
    setViewportDimensions,
    zoomIn,
    zoomOut,
    setZoom,
    trackHeight,
    trackHeights,
    setTrackHeight,
    setTrackHeightById,
    getTrackHeight,
  } = useTimelineStore();

  const [showLayersPanel, setShowLayersPanel] = useState(false);
  const [showCaptionsMenu, setShowCaptionsMenu] = useState(false);
  const [trackLayerQuery, setTrackLayerQuery] = useState("");
  const [trackLayerFilter, setTrackLayerFilter] =
    useState<TrackLayerFilter>("all");
  const [renamingTrackId, setRenamingTrackId] = useState<string | null>(null);
  const [trackNameDraft, setTrackNameDraft] = useState("");
  const [pendingTrackDeleteId, setPendingTrackDeleteId] = useState<string | null>(
    null,
  );

  const startTrackRename = useCallback((trackId: string, name: string) => {
    setRenamingTrackId(trackId);
    setTrackNameDraft(name);
  }, []);

  const finishTrackRename = useCallback(
    (commit: boolean) => {
      if (commit && renamingTrackId && trackNameDraft.trim()) {
        void renameTrack(renamingTrackId, trackNameDraft.trim());
      }
      setRenamingTrackId(null);
      setTrackNameDraft("");
    },
    [renameTrack, renamingTrackId, trackNameDraft],
  );
  const pendingTrackDelete = tracks.find(
    (track) => track.id === pendingTrackDeleteId,
  );
  const filteredTrackEntries = useMemo(
    () => filterTrackLayerEntries(tracks, trackLayerQuery, trackLayerFilter),
    [trackLayerFilter, trackLayerQuery, tracks],
  );

  const {
    select,
    selectMultiple,
    clearSelection,
    getSelectedClipIds,
    selectedItems,
    snapSettings,
    toggleSnap,
    timelineMaximized,
    toggleTimelineMaximized,
    openModal,
    activeModal,
    toggleKeyframeEditor,
    keyframeEditorOpen,
    togglePanel,
    panels,
  } = useUIStore();
  const selectedClipIds = useMemo(
    () => getSelectedClipIds(),
    [getSelectedClipIds, selectedItems],
  );
  const splittableSelectedClipIds = useMemo(
    () =>
      getSplittableTimelineItemIds(project, selectedClipIds, playheadPosition),
    [playheadPosition, project, selectedClipIds],
  );
  const selectedMediaClipIds = useMemo(
    () =>
      selectedClipIds.filter((clipId) =>
        tracks.some((track) => track.clips.some((clip) => clip.id === clipId)),
      ),
    [selectedClipIds, tracks],
  );
  const canRippleDelete =
    selectedMediaClipIds.length > 0 &&
    selectedMediaClipIds.length === selectedClipIds.length;

  // 必须用选择器：engine store 每帧都会被写入 currentFrame（预览渲染器提交画面），
  // 整店订阅会让这条时间线跟着每一帧重渲染——指针节流之后剩下的卡顿就在这里。
  const getTitleEngine = useEngineStore((state) => state.getTitleEngine);
  const getGraphicsEngine = useEngineStore((state) => state.getGraphicsEngine);
  const titleEngine = getTitleEngine();
  const allTextClips = useMemo(() => {
    return titleEngine?.getAllTextClips() ?? [];
  }, [titleEngine, project.modifiedAt]);

  const textClipsByTrack = useMemo(
    () =>
      new Map(tracks.map((track) => [
        track.id,
        allTextClips.filter((clip) => clip.trackId === track.id),
      ])),
    [allTextClips, tracks],
  );

  const graphicsEngine = getGraphicsEngine();
  const allShapeClips = useMemo(() => {
    const shapes = graphicsEngine?.getAllShapeClips() ?? [];
    const svgs = graphicsEngine?.getAllSVGClips() ?? [];
    const stickers = graphicsEngine?.getAllStickerClips() ?? [];
    return [...shapes, ...svgs, ...stickers];
  }, [graphicsEngine, project.modifiedAt]);

  const shapeClipsByTrack = useMemo(
    () =>
      new Map(tracks.map((track) => [
        track.id,
        allShapeClips.filter((clip) => clip.trackId === track.id),
      ])),
    [allShapeClips, tracks],
  );
  const [isBoxSelecting, setIsBoxSelecting] = React.useState(false);
  const [selectionBox, setSelectionBox] = React.useState<{
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
    additive: boolean;
  } | null>(null);

  const timelineDuration = useMemo(() => {
    let maxEnd = 0;
    for (const track of tracks) {
      for (const clip of track.clips) {
        const end = clip.startTime + clip.duration;
        if (end > maxEnd) maxEnd = end;
      }
    }
    for (const clip of [...allTextClips, ...allShapeClips]) {
      maxEnd = Math.max(maxEnd, clip.startTime + clip.duration);
    }
    return Math.max(maxEnd, 60); // Minimum 60 seconds
  }, [tracks, allTextClips, allShapeClips]);

  const playheadSnapPoints = useMemo(() => {
    const points = new Set<number>();
    for (const track of tracks) {
      for (const clip of track.clips) {
        points.add(clip.startTime);
        points.add(clip.startTime + clip.duration);
      }
    }
    for (const clip of [...allTextClips, ...allShapeClips]) {
      points.add(clip.startTime);
      points.add(clip.startTime + clip.duration);
    }
    return Array.from(points).sort((a, b) => a - b);
  }, [tracks, allTextClips, allShapeClips]);

  const totalTracksHeight = useMemo(() => {
    let height = 0;
    for (const track of tracks) {
      height += getTrackHeight(track.id, track.type);
    }
    return height;
  }, [tracks, getTrackHeight, trackHeight, trackHeights]);

  // Restored session values must reach the DOM as well as the ruler/clip
  // coordinates. Otherwise a reopened project shows the top-left viewport
  // while hit testing and thumbnails still use the saved scroll offsets.
  useLayoutEffect(() => {
    const viewport = tracksRef.current;
    const headers = trackHeadersRef.current;
    if (viewport) {
      if (Math.abs(viewport.scrollLeft - scrollX) > 0.5) viewport.scrollLeft = scrollX;
      if (Math.abs(viewport.scrollTop - scrollY) > 0.5) viewport.scrollTop = scrollY;
    }
    if (headers && Math.abs(headers.scrollTop - scrollY) > 0.5) headers.scrollTop = scrollY;
  }, [scrollX, scrollY, pixelsPerSecond, totalTracksHeight, project.timeline.duration]);

  const trackHeightsMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const track of tracks) {
      map.set(track.id, getTrackHeight(track.id, track.type));
    }
    return map;
  }, [tracks, getTrackHeight, trackHeight, trackHeights]);

  useEffect(() => {
    const el = tracksRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        const pointerX = e.clientX - rect.left;
        const { pixelsPerSecond: pps, setZoom: applyZoom } =
          useTimelineStore.getState();
        const timeAtCursor = (pointerX + el.scrollLeft) / pps;
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        const next = Math.max(
          ZOOM_PRESETS.MIN,
          Math.min(ZOOM_PRESETS.MAX, pps * factor),
        );
        if (next === pps) return;
        applyZoom(next);
        requestAnimationFrame(() => {
          el.scrollLeft = Math.max(0, timeAtCursor * next - pointerX);
        });
      } else if (e.shiftKey && e.deltaY !== 0) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const handleTrackDragStart = useCallback(
    (e: React.DragEvent, trackId: string) => {
      e.dataTransfer.setData("trackId", trackId);
      e.dataTransfer.effectAllowed = "move";
      trackDragPointerYRef.current = e.clientY;
      setDraggedTrackId(trackId);
      startTrackDragAutoScroll();
    },
    [startTrackDragAutoScroll],
  );

  const handleTrackDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    trackDragPointerYRef.current = e.clientY;
  }, []);

  const handleTrackDrop = useCallback(
    async (e: React.DragEvent, targetTrackId: string) => {
      e.preventDefault();
      const sourceTrackId = e.dataTransfer.getData("trackId");
      stopTrackDrag();

      if (sourceTrackId && sourceTrackId !== targetTrackId) {
        const targetIndex = tracks.findIndex((t) => t.id === targetTrackId);
        if (targetIndex !== -1) {
          await reorderTrack(sourceTrackId, targetIndex);
        }
      }
    },
    [tracks, reorderTrack, stopTrackDrag],
  );

  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setViewportDimensions(
          entry.contentRect.width,
          entry.contentRect.height,
        );
      }
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [setViewportDimensions]);

  useEffect(() => {
    if (playbackState !== "playing") return;
    const el = tracksRef.current;
    if (!el) return;

    const playheadPixels = playheadPosition * pixelsPerSecond;
    // Keep the playhead in the left portion of the viewport during playback so
    // most of the upcoming timeline stays visible. When it crosses near the
    // right edge (or jumps out of view via a seek/loop), page the view so the
    // playhead lands back near the left with the rest as lookahead — instead of
    // pinning it at the end on a long timeline.
    const leftMargin = Math.min(Math.max(viewportWidth * 0.12, 60), 220);
    const followThreshold = scrollX + viewportWidth - leftMargin;

    if (playheadPixels > followThreshold || playheadPixels < scrollX) {
      el.scrollLeft = Math.max(0, playheadPixels - leftMargin);
    }
  }, [playheadPosition, playbackState, pixelsPerSecond, scrollX, viewportWidth]);

  const handleSelectClip = useCallback(
    (clipId: string, addToSelection: boolean) => {
      const isTextClip = allTextClips.some((tc) => tc.id === clipId);
      if (isTextClip) {
        const textClip = allTextClips.find((tc) => tc.id === clipId);
        select(
          { type: "text-clip", id: clipId, trackId: textClip?.trackId },
          addToSelection,
        );
        return;
      }
      const isShapeClip = allShapeClips.some((sc) => sc.id === clipId);
      if (isShapeClip) {
        const shapeClip = allShapeClips.find((sc) => sc.id === clipId);
        select(
          { type: "shape-clip", id: clipId, trackId: shapeClip?.trackId },
          addToSelection,
        );
        return;
      }

      let trackId: string | undefined;
      for (const track of tracks) {
        if (track.clips.some((c) => c.id === clipId)) {
          trackId = track.id;
          break;
        }
      }
      select({ type: "clip", id: clipId, trackId }, addToSelection);
    },
    [tracks, select, allTextClips, allShapeClips],
  );

  const handleSelectTransition = useCallback(
    (transitionId: string, trackId: string) => {
      select({ type: "transition", id: transitionId, trackId });
    },
    [select],
  );

  const selectedTransitionId =
    selectedItems.find((item) => item.type === "transition")?.id ?? null;

  const [selectedKeyframeIds, setSelectedKeyframeIds] = useState<string[]>([]);

  const handleKeyframeSelect = useCallback(
    (keyframeId: string, addToSelection: boolean) => {
      if (addToSelection) {
        setSelectedKeyframeIds((prev) =>
          prev.includes(keyframeId)
            ? prev.filter((id) => id !== keyframeId)
            : [...prev, keyframeId]
        );
      } else {
        setSelectedKeyframeIds([keyframeId]);
      }
    },
    []
  );

  const handleKeyframeMove = useCallback(
    (keyframeId: string, newTime: number) => {
      for (const track of tracks) {
        for (const clip of track.clips) {
          const keyframe = clip.keyframes?.find((kf) => kf.id === keyframeId);
          if (keyframe) {
            const updatedKeyframes = clip.keyframes?.map((kf) =>
              kf.id === keyframeId ? { ...kf, time: Math.max(0, newTime) } : kf
            );
            if (updatedKeyframes) {
              updateClipKeyframes(clip.id, updatedKeyframes);
            }
            return;
          }
        }
      }
    },
    [tracks, updateClipKeyframes]
  );

  const handleKeyframeDelete = useCallback(
    (keyframeId: string) => {
      for (const track of tracks) {
        for (const clip of track.clips) {
          const keyframe = clip.keyframes?.find((kf) => kf.id === keyframeId);
          if (keyframe) {
            const updatedKeyframes = clip.keyframes?.filter(
              (kf) => kf.id !== keyframeId
            );
            if (updatedKeyframes) {
              updateClipKeyframes(clip.id, updatedKeyframes);
            }
            setSelectedKeyframeIds((prev) =>
              prev.filter((id) => id !== keyframeId)
            );
            return;
          }
        }
      }
    },
    [tracks, updateClipKeyframes]
  );

  const handleSplit = useCallback(async () => {
    const store = useProjectStore.getState();
    for (const clipId of splittableSelectedClipIds) {
      await splitTimelineItem(
        store,
        clipId,
        playheadPosition,
      );
    }
  }, [playheadPosition, splittableSelectedClipIds]);

  const handleDelete = useCallback(async () => {
    if (selectedClipIds.length === 0) return;

    const store = useProjectStore.getState();
    for (const id of selectedClipIds) {
      await deleteTimelineItem(store, id);
    }
    clearSelection();
  }, [selectedClipIds, clearSelection]);

  const handleDuplicate = useCallback(async () => {
    if (selectedClipIds.length === 0) return;

    const store = useProjectStore.getState();
    for (const id of selectedClipIds) {
      await duplicateTimelineItem(store, id);
    }
  }, [selectedClipIds]);

  const handleRippleDelete = useCallback(async () => {
    if (!canRippleDelete) return;
    for (const id of selectedMediaClipIds) {
      await rippleDeleteClip(id);
    }
    clearSelection();
  }, [canRippleDelete, clearSelection, rippleDeleteClip, selectedMediaClipIds]);

  const handleTrimToPlayhead = useCallback(
    async (trimStart: boolean) => {
      const store = useProjectStore.getState();
      for (const id of splittableSelectedClipIds) {
        await trimTimelineItemToPlayhead(
          store,
          id,
          playheadPosition,
          trimStart,
        );
      }
    },
    [playheadPosition, splittableSelectedClipIds],
  );

  const handleBackgroundClick = useCallback(() => {
    if (suppressNextBackgroundClickRef.current) {
      suppressNextBackgroundClickRef.current = false;
      return;
    }
    clearSelection();
  }, [clearSelection]);

  const handleBoxSelectionStart = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest(".clip-component")) return;

      const rect = tracksRef.current?.getBoundingClientRect();
      if (!rect) return;

      // Convert viewport coordinates to timeline coordinates by accounting for scroll position
      const x = e.clientX - rect.left + scrollX;
      const y = e.clientY - rect.top + scrollY;

      setIsBoxSelecting(true);
      setSelectionBox({
        startX: x,
        startY: y,
        currentX: x,
        currentY: y,
        additive: e.shiftKey || e.metaKey || e.ctrlKey,
      });
    },
    [scrollX, scrollY],
  );

  const handleBoxSelectionMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isBoxSelecting || !selectionBox) return;

      const rect = tracksRef.current?.getBoundingClientRect();
      if (!rect) return;

      const x = e.clientX - rect.left + scrollX;
      const y = e.clientY - rect.top + scrollY;

      setSelectionBox({
        ...selectionBox,
        currentX: x,
        currentY: y,
      });
    },
    [isBoxSelecting, selectionBox, scrollX, scrollY],
  );

  const handleBoxSelectionEnd = useCallback(() => {
    if (!isBoxSelecting || !selectionBox) {
      setIsBoxSelecting(false);
      setSelectionBox(null);
      return;
    }

    // Convert pixel coordinates to timeline time using current zoom level
    const minX = Math.min(selectionBox.startX, selectionBox.currentX);
    const maxX = Math.max(selectionBox.startX, selectionBox.currentX);
    const minTime = minX / pixelsPerSecond;
    const maxTime = maxX / pixelsPerSecond;
    const isMarqueeGesture =
      Math.abs(selectionBox.currentX - selectionBox.startX) > 3 ||
      Math.abs(selectionBox.currentY - selectionBox.startY) > 3;
    if (isMarqueeGesture) {
      suppressNextBackgroundClickRef.current = true;
    }

    const marqueeItems = getTimelineMarqueeSelection(
      project,
      {
        minTime,
        maxTime,
        minY: Math.min(selectionBox.startY, selectionBox.currentY),
        maxY: Math.max(selectionBox.startY, selectionBox.currentY),
      },
      getTrackHeight,
    );

    if (selectionBox.additive) {
      const merged = [...selectedItems];
      for (const item of marqueeItems) {
        if (!merged.some((selected) => selected.id === item.id)) {
          merged.push(item);
        }
      }
      selectMultiple(merged);
    } else if (marqueeItems.length > 0) {
      selectMultiple(marqueeItems);
    } else {
      clearSelection();
    }

    setIsBoxSelecting(false);
    setSelectionBox(null);
  }, [
    isBoxSelecting,
    selectionBox,
    pixelsPerSecond,
    project,
    getTrackHeight,
    selectMultiple,
    selectedItems,
    clearSelection,
  ]);

  useEffect(() => {
    if (!isBoxSelecting) return;

    const handleMouseUp = () => handleBoxSelectionEnd();
    document.addEventListener("mouseup", handleMouseUp);
    return () => document.removeEventListener("mouseup", handleMouseUp);
  }, [isBoxSelecting, handleBoxSelectionEnd]);

  const handleDropMedia = useCallback(
    async (trackId: string, mediaId: string, startTime: number) => {
      await useProjectStore
        .getState()
        .placeMediaClip(mediaId, trackId || undefined, startTime);
    },
    [],
  );

  const handleMoveClip = useCallback(
    async (clipId: string, newStartTime: number, targetTrackId?: string) => {
      const store = useProjectStore.getState();
      const sourceClip = store.getClip(clipId);
      const isOverlay = Boolean(
        store.getTextClip(clipId) ||
          store.getShapeClip(clipId) ||
          store.getSVGClip(clipId) ||
          store.getStickerClip(clipId),
      );
      const result = targetTrackId
        ? await store.moveTimelineItem(clipId, newStartTime, targetTrackId)
        : isOverlay
          ? store.updateOverlayClipTiming(clipId, {
              startTime: newStartTime,
            })
            ? { success: true as const }
            : { success: false as const }
          : await store.moveClip(clipId, newStartTime);
      if (result.success && sourceClip) {
        moveLinkedCaptions(useProjectStore.getState(), sourceClip, newStartTime);
      }
    },
    [],
  );

  const [snapIndicatorTime, setSnapIndicatorTime] = React.useState<
    number | null
  >(null);

  const handleSnapIndicator = useCallback((time: number | null) => {
    setSnapIndicatorTime(time);
  }, []);

  const handleTrimTextClip = useCallback(
    (clipId: string, edge: "left" | "right", newTime: number) => {
      const store = useProjectStore.getState();
      const textClip = store.getTextClip(clipId);
      if (!textClip) return;
      const newDuration =
        edge === "left"
          ? Math.max(0.1, textClip.startTime + textClip.duration - newTime)
          : Math.max(0.1, newTime - textClip.startTime);
      store.updateOverlayClipTiming(clipId, {
        ...(edge === "left" ? { startTime: newTime } : {}),
        duration: newDuration,
      });
    },
    [],
  );

  const handleMoveTextClip = useCallback(
    async (clipId: string, newStartTime: number, targetTrackId?: string) => {
      await handleMoveClip(clipId, Math.max(0, newStartTime), targetTrackId);
    },
    [handleMoveClip],
  );

  const handleTrimShapeClip = useCallback(
    (clipId: string, edge: "left" | "right", newTime: number) => {
      const store = useProjectStore.getState();
      const graphicClip =
        store.getShapeClip(clipId) ||
        store.getSVGClip(clipId) ||
        store.getStickerClip(clipId);
      if (!graphicClip) return;
      const newDuration =
        edge === "left"
          ? Math.max(
              0.1,
              graphicClip.startTime + graphicClip.duration - newTime,
            )
          : Math.max(0.1, newTime - graphicClip.startTime);

      store.updateOverlayClipTiming(clipId, {
        ...(edge === "left" ? { startTime: newTime } : {}),
        duration: newDuration,
      });
    },
    [],
  );

  const handleTrimClip = useCallback(
    async (clipId: string, edge: "left" | "right", newTime: number) => {
      const store = useProjectStore.getState();
      const clip = store.getClip(clipId);
      if (!clip) return;
      const speed = clip.speed || 1;
      const media = store.project.mediaLibrary.items.find(item => item.id === clip.mediaId);
      const mediaEnd = media?.type === "image" ? Infinity : media?.metadata.duration || clip.outPoint;
      const inPoint = edge === "left"
        ? Math.max(0, Math.min(clip.outPoint - 0.1 * speed, clip.inPoint + (newTime - clip.startTime) * speed))
        : clip.inPoint;
      const outPoint = edge === "right"
        ? Math.min(mediaEnd, Math.max(inPoint + 0.1 * speed, inPoint + (newTime - clip.startTime) * speed))
        : clip.outPoint;
      const result = await store.trimClip(clipId, inPoint, outPoint);
      if (!result.success) return;
      if (edge === "left") {
        await useProjectStore.getState().moveClip(clipId, clip.startTime + (inPoint - clip.inPoint) / speed);
      }
      const updated = useProjectStore.getState().getClip(clipId);
      if (updated) trimLinkedCaptions(useProjectStore.getState(), clip, updated.startTime, updated.startTime + updated.duration);
    },
    [],
  );

  const visualOrderTracks = useMemo(() => tracks, [tracks]);
  // 宿主模式隐藏了顶部工具栏，inspector 也只在选中片段时占位，所以字幕的
  // 导入/导出必须有一个常驻入口；动作直接复用 store 里已有的 SRT 实现。
  const importCaptionsFromFile = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".srt,.vtt,text/plain";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      void file
        .text()
        .then((content) => useProjectStore.getState().importSRT(content))
        .then((result) => {
          if (!result?.success) {
            toast.error(
              editorMessage("editor.timeline.toolbar.importFailed"),
              result?.errors.join("\n") || editorMessage("editor.timeline.toolbar.noSubtitles"),
            );
            return;
          }
          toast.success(editorMessage("editor.timeline.toolbar.imported"), file.name);
        })
        .catch((error: unknown) => {
          toast.error(
            editorMessage("editor.timeline.toolbar.importFailed"),
            error instanceof Error ? error.message : editorMessage("editor.timeline.toolbar.retry"),
          );
        });
    };
    input.click();
  }, []);

  const exportCaptionsToSRT = useCallback(async () => {
    const store = useProjectStore.getState();
    const srt = await store.exportSRT();
    if (!srt.trim()) {
      toast.error(editorMessage("editor.timeline.toolbar.noCaptions"));
      return;
    }
    const url = URL.createObjectURL(
      new Blob([srt], { type: "application/x-subrip" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${(store.project.name || "captions").replace(/[^\w.-]+/g, "_")}.srt`;
    link.click();
    URL.revokeObjectURL(url);
  }, []);

  const addTrackItems: DropdownMenuOption[] = useMemo(
    () => [
      {
        label: editorMessage("editor.timeline.toolbar.track"),
        icon: <Layers size={16} className="text-foreground" aria-hidden />,
        onClick: () => addTrack("video", undefined, { mode: "standard" }),
      },
      {
        label: editorMessage("editor.timeline.toolbar.dialogue"),
        icon: <Music size={16} className="text-clip-audio" aria-hidden />,
        onClick: () =>
          addTrack("video", undefined, {
            mode: "standard",
            role: "dialogue",
            name: editorMessage("editor.timeline.toolbar.dialogue"),
          }),
      },
      {
        label: editorMessage("editor.timeline.toolbar.music"),
        icon: <Music size={16} className="text-clip-audio" aria-hidden />,
        onClick: () =>
          addTrack("video", undefined, {
            mode: "standard",
            role: "music",
            name: editorMessage("editor.timeline.toolbar.music"),
          }),
      },
      {
        label: editorMessage("editor.timeline.toolbar.captions"),
        icon: <Type size={16} className="text-clip-text" aria-hidden />,
        onClick: () =>
          addTrack("video", undefined, {
            mode: "standard",
            role: "captions",
            name: editorMessage("editor.timeline.toolbar.captions"),
          }),
      },
    ],
    [addTrack],
  );

  // Popover 的触发器用 asChild，必须是一个能接 ref 的原生按钮。
  const CaptionsMenuTrigger = (
    <button
      type="button"
      aria-label={editorMessage("editor.timeline.toolbar.subtitleFiles")}
      data-tip-bottom={editorMessage("editor.timeline.toolbar.subtitleFiles")}
      className={LABELED_TOOL_CLASS}
    >
      <Captions size={20} strokeWidth={1.5} aria-hidden />
      <span>{editorMessage("editor.timeline.toolbar.captions")}</span>
    </button>
  );

  return (
    <div
      data-tour="timeline"
      className="h-full bg-tl-bg flex flex-col min-h-0 relative overflow-hidden"
    >
      {/* ── Timeline toolbar（参考剪辑台：无边框线性图标、无分隔竖线） ── */}
      {canvas ? (
        <div className="shotloom-canvas-tools">
          <button type="button" onClick={requestShotloomImport} title={editorMessage("editor.timeline.toolbar.addMedia")}><Plus size={14} />{editorMessage("editor.timeline.toolbar.addMedia")}</button>
          <TLTool onClick={handleSplit} disabled={splittableSelectedClipIds.length === 0} title={editorMessage("editor.timeline.toolbar.split")}><Scissors size={16} /></TLTool>
          <TLTool onClick={handleDelete} disabled={selectedClipIds.length === 0} title={editorMessage("editor.timeline.toolbar.deleteClip")}><Trash2 size={16} /></TLTool>
          <TLTool onClick={undo} disabled={!canUndo()} title={editorMessage("editor.timeline.toolbar.undo")}><Undo2 size={16} /></TLTool>
          <TLTool onClick={redo} disabled={!canRedo()} title={editorMessage("editor.timeline.toolbar.redo")}><Redo2 size={16} /></TLTool>
          <span className="shotloom-canvas-transport">
            <TLTool onClick={() => { void getPlaybackBridge().togglePlayback(); }} title={editorMessage(playbackState === "playing" ? "editor.timeline.toolbar.pause" : "editor.timeline.toolbar.play")}>
              {playbackState === "playing" ? <Pause size={14} /> : <Play size={14} />}
            </TLTool>
            <span>{formatClock(playheadPosition)} / {formatClock(project.timeline.duration)}</span>
          </span>
          <TLTool onClick={zoomOut} title={editorMessage("editor.timeline.toolbar.zoomOut")}><ZoomOut size={14} /></TLTool>
          <input aria-label={editorMessage("editor.timeline.toolbar.zoom")} type="range" min={ZOOM_PRESETS.MIN} max={ZOOM_PRESETS.MAX} value={pixelsPerSecond} onChange={(event) => setZoom(Number(event.currentTarget.value))} />
          <TLTool onClick={zoomIn} title={editorMessage("editor.timeline.toolbar.zoomIn")}><ZoomIn size={14} /></TLTool>
          <TLTool onClick={(event) => requestShotloomExport(event.currentTarget)} title={editorMessage("editor.timeline.toolbar.exportEdit")}><Download size={15} /></TLTool>
          <button type="button" onClick={requestShotloomExpand} title={editorMessage("editor.timeline.toolbar.expand")}><Maximize2 size={14} />{editorMessage("editor.timeline.toolbar.expand")}</button>
        </div>
      ) : (
      <div className="flex items-center h-12 px-3 gap-1.5 bg-bg-1 border-b border-border shrink-0 relative z-50">
        <TLTool onClick={undo} disabled={!canUndo()} title={editorMessage("editor.timeline.toolbar.undoShortcut")}>
          <Undo2 size={16} aria-hidden />
        </TLTool>
        <TLTool onClick={redo} disabled={!canRedo()} title={editorMessage("editor.timeline.toolbar.redoShortcut")}>
          <Redo2 size={16} aria-hidden />
        </TLTool>

        <TLTool
          onClick={handleSplit}
          disabled={splittableSelectedClipIds.length === 0}
          title={editorMessage("editor.timeline.toolbar.splitShortcut")}
        >
          <Scissors size={16} aria-hidden />
        </TLTool>
        {!isShotloomMode && (
          <>
            <TLTool
              onClick={() => handleTrimToPlayhead(true)}
              disabled={splittableSelectedClipIds.length === 0}
              title={editorMessage("editor.timeline.toolbar.trimStart")}
            >
              <CornerDownLeft size={16} aria-hidden />
            </TLTool>
            <TLTool
              onClick={() => handleTrimToPlayhead(false)}
              disabled={splittableSelectedClipIds.length === 0}
              title={editorMessage("editor.timeline.toolbar.trimEnd")}
            >
              <CornerDownRight size={16} aria-hidden />
            </TLTool>
          </>
        )}
        <TLTool
          onClick={handleDelete}
          disabled={selectedClipIds.length === 0}
          title={editorMessage("editor.timeline.toolbar.deleteShortcut")}
        >
          <Trash2 size={16} aria-hidden />
        </TLTool>
        {!isShotloomMode && (
          <>
            <TLTool
              onClick={handleDuplicate}
              disabled={selectedClipIds.length === 0}
              title={editorMessage("editor.timeline.toolbar.duplicateShortcut")}
            >
              <Copy size={16} aria-hidden />
            </TLTool>
            <TLTool
              onClick={handleRippleDelete}
              disabled={!canRippleDelete}
              title={editorMessage("editor.timeline.toolbar.rippleDelete")}
            >
              <Delete size={16} aria-hidden />
            </TLTool>
          </>
        )}

        {/* 参考的「+ 添加轨道」把一枚小 chevron 收在加号右下（实测偏移约 +5/+9px）。
            DropdownMenu 的 isIconOnly 分支会丢掉 endContent/hasChevron，所以 chevron
            只能作为 icon 的一部分进来，不去改共享 ui 包的按钮契约。 */}
        <DropdownMenu
          items={addTrackItems}
          placement="above"
          menuWidth={192}
          button={{
            label: editorMessage("editor.timeline.toolbar.addTrack"),
            isIconOnly: true,
            size: "sm",
            variant: "ghost",
            icon: (
              <span className="relative flex items-center justify-center">
                <Plus size={16} aria-hidden />
                <ChevronDownIcon
                  size={8}
                  aria-hidden
                  className="absolute left-[9px] top-[11px] text-fg-muted"
                />
              </span>
            ),
          }}
        />

        <Popover
          isOpen={showLayersPanel}
          onOpenChange={(open) => {
            setShowLayersPanel(open);
            if (!open) {
              finishTrackRename(false);
              setPendingTrackDeleteId(null);
            }
          }}
          placement="above"
          alignment="start"
          width={340}
          label={editorMessage("editor.timeline.toolbar.layers")}
          content={
            <>
              <div className="flex items-center justify-between px-3 py-2.5 border-b border-border bg-bg-2">
                <span className="text-xs font-semibold text-fg">{editorMessage("editor.timeline.toolbar.layers")}</span>
                <span className="text-[10px] tabular-nums text-fg-3">
                  {filteredTrackEntries.length}/{tracks.length}
                </span>
              </div>
              {pendingTrackDelete ? (
                <div
                  role="alertdialog"
                  aria-label={editorMessage("editor.timeline.deleteTrackLabel", { name: pendingTrackDelete.name })}
                  className="border-b border-danger/30 bg-danger/10 px-3 py-2.5"
                >
                  <p className="text-[11px] font-semibold text-danger">
                    {editorMessage("editor.timeline.deleteTrackQuestion", { name: pendingTrackDelete.name })}
                  </p>
                  <p className="mt-0.5 text-[10px] leading-relaxed text-fg-3">
                    {editorMessage("editor.timeline.toolbar.deleteHelp")}
                  </p>
                  <div className="mt-2 flex justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => setPendingTrackDeleteId(null)}
                      className="h-7 rounded-md border border-border bg-bg-1 px-2.5 text-[10px] font-semibold text-fg-2 hover:bg-hover"
                    >
                      {editorMessage("editor.timeline.toolbar.cancel")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void removeTrack(pendingTrackDelete.id);
                        setPendingTrackDeleteId(null);
                      }}
                      className="h-7 rounded-md bg-danger px-2.5 text-[10px] font-semibold text-white hover:opacity-90"
                    >
                      {editorMessage("editor.timeline.toolbar.deleteTrack")}
                    </button>
                  </div>
                </div>
              ) : null}
              <div className="space-y-2 border-b border-border px-3 py-2.5">
                <input
                  type="search"
                  value={trackLayerQuery}
                  onChange={(event) => setTrackLayerQuery(event.currentTarget.value)}
                  placeholder={editorMessage("editor.timeline.toolbar.searchTracks")}
                  aria-label={editorMessage("editor.timeline.toolbar.searchLayers")}
                  className="h-8 w-full rounded-md border border-border bg-bg-1 px-2.5 text-[11px] text-fg outline-none placeholder:text-fg-muted focus:border-accent"
                />
                <div
                  className="flex gap-1 overflow-x-auto pb-0.5"
                  role="group"
                  aria-label={editorMessage("editor.timeline.toolbar.layerTypes")}
                >
                  {TRACK_LAYER_FILTERS.map((filter) => {
                    const count =
                      filter.id === "all"
                        ? tracks.length
                        : tracks.filter((track) => track.type === filter.id).length;
                    return (
                      <button
                        key={filter.id}
                        type="button"
                        aria-pressed={trackLayerFilter === filter.id}
                        onClick={() => setTrackLayerFilter(filter.id)}
                        className={`h-6 shrink-0 rounded-md border px-2 text-[9px] font-semibold transition-colors ${
                          trackLayerFilter === filter.id
                            ? "border-accent bg-accent-soft text-accent"
                            : "border-border bg-bg-2 text-fg-3 hover:border-accent/50 hover:text-fg"
                        }`}
                      >
                        {filter.label()} {count}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="p-2 max-h-60 overflow-y-auto">
                {tracks.length === 0 ? (
                  <Text type="supporting" color="secondary" className="text-xs text-fg-muted text-center py-6">
                    {editorMessage("editor.timeline.toolbar.empty")}
                  </Text>
                ) : filteredTrackEntries.length === 0 ? (
                  <Text
                    type="supporting"
                    color="secondary"
                    className="block py-6 text-center text-xs text-fg-muted"
                  >
                    {editorMessage("editor.timeline.toolbar.noMatches")}
                  </Text>
                ) : (
                  <div className="space-y-0.5">
                    {filteredTrackEntries.map(({ track, index }) => {
                      const info = getTrackInfo(track, index);
                      const name = track.name || info.label;
                      const isVisual = trackHasVisualItems(project, track.id);
                      const isAudio = trackHasAudioItems(project, track.id);
                      return (
                        <div
                          key={track.id}
                          className="flex items-center gap-2.5 px-2 py-2 rounded-md hover:bg-hover group transition-colors cursor-default"
                        >
                          <div
                            className={`w-7 h-7 rounded-md flex items-center justify-center ${info.bgLight}`}
                          >
                            <info.icon size={14} className={info.textColor} aria-hidden />
                          </div>
                          {renamingTrackId === track.id ? (
                            <input
                              autoFocus
                              aria-label={editorMessage("editor.timeline.toolbar.renameNamed", { name })}
                              value={trackNameDraft}
                              onChange={(event) =>
                                setTrackNameDraft(event.currentTarget.value)
                              }
                              onBlur={() => finishTrackRename(true)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  finishTrackRename(true);
                                } else if (event.key === "Escape") {
                                  event.preventDefault();
                                  finishTrackRename(false);
                                }
                              }}
                              className="h-7 min-w-0 flex-1 rounded-md border border-accent bg-bg-1 px-2 text-[11px] font-medium text-fg outline-none"
                            />
                          ) : (
                            <span
                              className="flex-1 truncate text-[11px] font-medium text-fg"
                              onDoubleClick={() => startTrackRename(track.id, name)}
                            >
                              {name}
                            </span>
                          )}
                          <div className="flex gap-0.5 opacity-60 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                            <IconButton
                              label={editorMessage("editor.timeline.toolbar.renameNamed", { name })}
                              icon={<Pencil size={12} aria-hidden />}
                              size="sm"
                              variant="ghost"
                              onClick={() => startTrackRename(track.id, name)}
                            />
                            <IconButton
                              label={editorMessage("editor.timeline.toolbar.duplicateNamed", { name })}
                              icon={<Copy size={12} aria-hidden />}
                              size="sm"
                              variant="ghost"
                              onClick={() => void duplicateTrack(track.id)}
                            />
                            <IconButton
                              label={editorMessage("editor.timeline.toolbar.deleteNamed", { name })}
                              icon={<Trash2 size={12} aria-hidden />}
                              size="sm"
                              variant="ghost"
                              onClick={() => setPendingTrackDeleteId(track.id)}
                            />
                            {isVisual ? (
                              <IconButton
                                label={editorMessage("editor.timeline.toolbar.hideNamed", { name })}
                                icon={
                                  track.hidden ? (
                                    <EyeOff size={12} aria-hidden />
                                  ) : (
                                    <Eye size={12} aria-hidden />
                                  )
                                }
                                size="sm"
                                variant={track.hidden ? "secondary" : "ghost"}
                                aria-pressed={track.hidden}
                                onClick={() => void hideTrack(track.id, !track.hidden)}
                              />
                            ) : null}
                            {isAudio ? (
                              <>
                                <IconButton
                                  label={editorMessage("editor.timeline.toolbar.muteNamed", { name })}
                                  icon={
                                    track.muted ? (
                                      <VolumeX size={12} aria-hidden />
                                    ) : (
                                      <Volume2 size={12} aria-hidden />
                                    )
                                  }
                                  size="sm"
                                  variant={track.muted ? "secondary" : "ghost"}
                                  aria-pressed={track.muted}
                                  onClick={() => void muteTrack(track.id, !track.muted)}
                                />
                                <button
                                  type="button"
                                  aria-label={editorMessage("editor.timeline.toolbar.soloNamed", { name })}
                                  aria-pressed={track.solo}
                                  onClick={() => void soloTrack(track.id, !track.solo)}
                                  className={`flex h-7 min-w-7 items-center justify-center rounded-md px-1 text-[10px] font-black transition-colors ${
                                    track.solo
                                      ? "bg-status-warning text-black"
                                      : "text-fg-muted hover:bg-hover hover:text-fg"
                                  }`}
                                >
                                  S
                                </button>
                              </>
                            ) : null}
                            <IconButton
                              label={editorMessage("editor.timeline.toolbar.lockNamed", { name })}
                              icon={
                                track.locked ? (
                                  <Unlock size={12} aria-hidden />
                                ) : (
                                  <Lock size={12} aria-hidden />
                                )
                              }
                              size="sm"
                              variant={track.locked ? "secondary" : "ghost"}
                              aria-pressed={track.locked}
                              onClick={() => void lockTrack(track.id, !track.locked)}
                            />
                            <IconButton
                              label={editorMessage("editor.timeline.toolbar.moveUp", { name })}
                              icon={<ChevronUp size={12} aria-hidden />}
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                index > 0 && reorderTrack(track.id, index - 1)
                              }
                              isDisabled={index === 0}
                            />
                            <IconButton
                              label={editorMessage("editor.timeline.toolbar.moveDown", { name })}
                              icon={<ChevronDown size={12} aria-hidden />}
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                index < tracks.length - 1 &&
                                reorderTrack(track.id, index + 1)
                              }
                              isDisabled={index === tracks.length - 1}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          }
        >
          <IconButton
            label={editorMessage("editor.timeline.toolbar.manage")}
            icon={<Layers size={16} aria-hidden />}
            size="sm"
            variant={showLayersPanel ? "secondary" : "ghost"}
            data-tip-bottom={editorMessage("editor.timeline.toolbar.layers")}
          />
        </Popover>

        {/* 宿主模式没有顶部工具栏，字幕与快捷键这两个入口只能挂在这里。 */}
        {isShotloomMode && (
          <>
            <Popover
              isOpen={showCaptionsMenu}
              onOpenChange={setShowCaptionsMenu}
              placement="above"
              alignment="start"
              width={224}
              label={editorMessage("editor.timeline.toolbar.captions")}
              content={
                <div className="p-1">
                  <button
                    type="button"
                    onClick={() => {
                      setShowCaptionsMenu(false);
                      importCaptionsFromFile();
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] text-fg-2 transition-colors hover:bg-bg-2 hover:text-fg"
                  >
                    <Upload size={16} aria-hidden />
                    <span>{editorMessage("editor.timeline.toolbar.importSubtitles")}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowCaptionsMenu(false);
                      void exportCaptionsToSRT();
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] text-fg-2 transition-colors hover:bg-bg-2 hover:text-fg"
                  >
                    <Download size={16} aria-hidden />
                    <span>{editorMessage("editor.timeline.toolbar.exportSrt")}</span>
                  </button>
                </div>
              }
            >
              {CaptionsMenuTrigger}
            </Popover>
            <TLToolLabeled
              title={editorMessage("editor.timeline.toolbar.shortcutsHint")}
              icon={<Keyboard size={20} strokeWidth={1.5} aria-hidden />}
              onClick={() => openModal(SHORTCUTS_MODAL_ID)}
            >
              {editorMessage("editor.timeline.toolbar.shortcuts")}
            </TLToolLabeled>
          </>
        )}

        <CaptionBatchSelectButton />

        <div className="ml-auto flex items-center gap-0.5">
          {/* 参考剪辑台的右侧顺序：吸附 | 轨道高度 | 缩放 | 时间线停靠 */}
          <TLTool
            onClick={toggleSnap}
            active={snapSettings.enabled}
            title={editorMessage(snapSettings.enabled ? "editor.timeline.toolbar.snapOn" : "editor.timeline.toolbar.snapOff")}
          >
            <Magnet size={16} />
          </TLTool>

          {/* 参考的右侧集群只用间距分组，不画分隔线。 */}
          {!isShotloomMode && <div className="mx-1 w-px h-5 bg-border" />}

          <TLTool
            onClick={() => {
              setTrackHeight(84);
              useTimelineStore.setState({ trackHeights: {} });
            }}
            active={trackHeight >= 52}
            title={editorMessage("editor.timeline.toolbar.large")}
          >
            {/* 参考用"两行"表示大轨道（可见行数少），"三行"表示紧凑。 */}
            <Rows2 size={16} />
          </TLTool>
          <TLTool
            onClick={() => {
              setTrackHeight(40);
              useTimelineStore.setState({ trackHeights: {} });
            }}
            active={trackHeight < 52}
            title={editorMessage("editor.timeline.toolbar.compact")}
          >
            <Rows3 size={16} />
          </TLTool>

          {!isShotloomMode && <div className="mx-1 w-px h-5 bg-border" />}

          {/* Zoom control（实测参考：6px 圆轨道 + 中灰填充（≈rgba(0,0,0,.65)，
              不是播放器进度条那种实心黑）+ 一枚白色圆钮，圆钮把轨道压出一段白缺口） */}
          <div className="flex items-center gap-2 px-1">
            <TLTool onClick={zoomOut} title={editorMessage("editor.timeline.toolbar.zoomOut")}>
              <ZoomOut size={16} aria-hidden />
            </TLTool>
            <div className="relative h-5 w-[130px]">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute left-0 top-1/2 h-[6px] w-full -translate-y-1/2 rounded-full bg-bg-2"
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute left-0 top-1/2 h-[6px] -translate-y-1/2 rounded-full bg-fg-3"
                style={{
                  width: `${zoomFillPercent(pixelsPerSecond)}%`,
                }}
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 h-[11px] w-[11px] -translate-y-1/2 -translate-x-1/2 rounded-full bg-bg-1 shadow-sm ring-1 ring-border-strong"
                style={{
                  left: `${zoomFillPercent(pixelsPerSecond)}%`,
                }}
              />
              <input
                type="range"
                aria-label={editorMessage("editor.timeline.toolbar.zoom")}
                aria-valuetext={editorMessage("editor.timeline.toolbar.zoomValue", { count: Math.round(pixelsPerSecond) })}
                min={ZOOM_PRESETS.MIN}
                max={ZOOM_PRESETS.MAX}
                step={1}
                value={pixelsPerSecond}
                onChange={(event) => setZoom(Number(event.currentTarget.value))}
                className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
              />
            </div>
            <TLTool onClick={zoomIn} title={editorMessage("editor.timeline.toolbar.zoomIn")}>
              <ZoomIn size={16} aria-hidden />
            </TLTool>
          </div>

          <TLTool
            onClick={toggleTimelineMaximized}
            active={timelineMaximized}
            title={
              editorMessage(timelineMaximized ? "editor.timeline.toolbar.restore" : "editor.timeline.toolbar.maximize")
            }
          >
            {timelineMaximized ? (
              <Minimize2 size={16} />
            ) : (
              <Maximize2 size={16} />
            )}
          </TLTool>

          {/* 宿主模式收起了编辑器工具栏，这四个入口挂到右侧集群末尾：
              参考项目没有它们，所以不能占用左侧那组与参考逐位对应的工具。 */}
          {isShotloomMode && (
            <>
              <div className="mx-1 w-px h-5 bg-border" />
              <TLTool
                onClick={() => openModal("search")}
                active={activeModal === "search"}
                title={editorMessage("editor.timeline.toolbar.search")}
              >
                <Search size={16} aria-hidden />
              </TLTool>
              <TLTool
                onClick={() => openModal("history")}
                active={activeModal === "history"}
                title={editorMessage("editor.timeline.toolbar.history")}
              >
                <History size={16} aria-hidden />
              </TLTool>
              <TLTool
                onClick={toggleKeyframeEditor}
                active={keyframeEditorOpen}
                title={editorMessage("editor.timeline.toolbar.keyframes")}
              >
                <Diamond size={16} aria-hidden />
              </TLTool>
              <TLTool
                onClick={() => togglePanel("audioMixer")}
                active={Boolean(panels.audioMixer?.visible)}
                title={editorMessage("editor.timeline.toolbar.mixer")}
              >
                <Music size={16} aria-hidden />
              </TLTool>
            </>
          )}
        </div>
      </div>
      )}

      <div
        ref={containerRef}
        className="flex-1 flex flex-col overflow-hidden relative"
        onClick={handleBackgroundClick}
      >
        <div className="flex shrink-0">
          <div style={{ width: headerWidth, height: canvas ? 28 : 44 }} className="bg-bg-1 border-b border-r border-border shrink-0">
            <TimelineRangeActions duration={project.timeline.duration} frameRate={project.settings.frameRate} />
          </div>
          <div className="flex-1 overflow-hidden relative bg-bg-1 border-b border-border">
            <div
              style={{
                width: `${timelineDuration * pixelsPerSecond}px`,
                transform: `translateX(-${scrollX}px)`,
              }}
            >
              <TimeRuler
                compact={canvas}
                duration={timelineDuration}
                rangeDuration={project.timeline.duration}
                frameRate={project.settings.frameRate}
                pixelsPerSecond={pixelsPerSecond}
                scrollX={scrollX}
                viewportWidth={viewportWidth}
                snapPoints={playheadSnapPoints}
                onSeek={(time) => {
                  const bridge = getPlaybackBridge();
                  bridge.scrubTo(time);
                }}
                onScrubStart={() => {
                  const bridge = getPlaybackBridge();
                  bridge.startScrubbing();
                }}
                onScrubEnd={() => {
                  const bridge = getPlaybackBridge();
                  bridge.endScrubbing();
                }}
              />
            </div>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          <div
            ref={trackHeadersRef}
            data-testid="timeline-track-headers-scroll"
            style={{ width: headerWidth }}
            className="bg-bg-1 border-r border-border shrink-0 z-20 overflow-y-auto overflow-x-hidden scrollbar-none overscroll-contain"
            onDragOverCapture={handleTrackDragOver}
            onScroll={(e) => {
              const nextScrollTop = e.currentTarget.scrollTop;
              const timeline = tracksRef.current;
              if (timeline && Math.abs(timeline.scrollTop - nextScrollTop) > 0.5) {
                timeline.scrollTop = nextScrollTop;
              }
              setScrollY(nextScrollTop);
            }}
          >
            <div className="flex flex-col">
              {visualOrderTracks.map((track, i) => {
                const keyframeCount = track.clips.reduce(
                  (sum, clip) => sum + (clip.keyframes?.length || 0),
                  0
                );
                return (
                  <div
                    key={track.id}
                    className={draggedTrackId === track.id ? "opacity-50" : ""}
                  >
                    <TrackHeader
                      track={track}
                      index={i}
                      onDragStart={handleTrackDragStart}
                      onDragOver={handleTrackDragOver}
                      onDrop={handleTrackDrop}
                      onDragEnd={stopTrackDrag}
                      keyframeCount={keyframeCount}
                    />
                  </div>
                );
              })}
              {/* 参考的轨道列表下方没有常驻的"+ 添加轨道"行：添加入口只有工具条的 +。 */}
              {!isShotloomMode && (
                <button
                  type="button"
                  onClick={() =>
                    addTrack("video", undefined, { mode: "standard" })
                  }
                  className="mx-3 my-1 h-7 flex items-center justify-center gap-1.5 rounded-[7px] border border-dashed border-border-strong text-fg-muted hover:text-fg-2 hover:border-fg-3 transition-colors"
                  aria-label={editorMessage("editor.timeline.toolbar.addTrack")}
                >
                  <Plus size={16} aria-hidden />
                </button>
              )}
              <div
                aria-hidden="true"
                style={{ height: TIMELINE_SCROLLBAR_SIZE }}
              />
            </div>
          </div>

          <div
            ref={tracksRef}
            data-testid="timeline-tracks-scroll"
            className="flex-1 bg-background relative overflow-auto custom-scrollbar"
            onScroll={(e) => {
              setScrollX(e.currentTarget.scrollLeft);
              const nextScrollTop = e.currentTarget.scrollTop;
              const headers = trackHeadersRef.current;
              if (headers && Math.abs(headers.scrollTop - nextScrollTop) > 0.5) {
                headers.scrollTop = nextScrollTop;
              }
              setScrollY(nextScrollTop);
            }}
            onMouseDown={handleBoxSelectionStart}
            onMouseMove={handleBoxSelectionMove}
            onDragOver={(e) => {
              e.preventDefault();
              if (draggedTrackId) {
                e.dataTransfer.dropEffect = "move";
                trackDragPointerYRef.current = e.clientY;
                return;
              }
              e.dataTransfer.dropEffect = "copy";
              const element = tracksRef.current;
              if (!element) return;
              const rect = element.getBoundingClientRect();
              const edgeSize = 56;
              const maxStep = 24;
              const horizontal =
                e.clientX < rect.left + edgeSize
                  ? -maxStep * (1 - (e.clientX - rect.left) / edgeSize)
                  : e.clientX > rect.right - edgeSize
                    ? maxStep * (1 - (rect.right - e.clientX) / edgeSize)
                    : 0;
              const vertical =
                e.clientY < rect.top + edgeSize
                  ? -maxStep * (1 - (e.clientY - rect.top) / edgeSize)
                  : e.clientY > rect.bottom - edgeSize
                    ? maxStep * (1 - (rect.bottom - e.clientY) / edgeSize)
                    : 0;
              if (horizontal || vertical) {
                element.scrollBy({ left: horizontal, top: vertical });
              }
            }}
            onDrop={async (e) => {
              e.preventDefault();

              const rect = tracksRef.current?.getBoundingClientRect();
              if (!rect) return;
              const x = e.clientX - rect.left + (tracksRef.current?.scrollLeft ?? 0);
              const rawTime = Math.max(0, x / pixelsPerSecond);

              const allClips = getTimelineItemRanges(project);
              let snappedTime = rawTime;
              if (snapSettings.enabled) {
                const threshold = snapSettings.snapThreshold / pixelsPerSecond;
                let bestDist = Infinity;
                for (const clip of allClips) {
                  const clipEnd = clip.startTime + clip.duration;
                  const distToEnd = Math.abs(rawTime - clipEnd);
                  const distToStart = Math.abs(rawTime - clip.startTime);
                  if (distToEnd < threshold && distToEnd < bestDist) {
                    bestDist = distToEnd;
                    snappedTime = clipEnd;
                  }
                  if (distToStart < threshold && distToStart < bestDist) {
                    bestDist = distToStart;
                    snappedTime = clip.startTime;
                  }
                }
                if (snapSettings.snapToPlayhead) {
                  const distToPlayhead = Math.abs(rawTime - playheadPosition);
                  if (distToPlayhead < threshold && distToPlayhead < bestDist) {
                    snappedTime = playheadPosition;
                  }
                }
              }

              // External OS file drop (e.g. from Windows Explorer)
              if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                const { importMedia, placeMediaClip } = useProjectStore.getState();
                for (const file of Array.from(e.dataTransfer.files)) {
                  try {
                    const beforeIds = new Set(
                      useProjectStore.getState().project.mediaLibrary.items.map(i => i.id)
                    );
                    const result = await importMedia(file);
                    if (result.success) {
                      const newItem = useProjectStore
                        .getState()
                        .project.mediaLibrary.items.find(i => !beforeIds.has(i.id));
                      if (newItem) {
                        await placeMediaClip(newItem.id, undefined, snappedTime);
                        const track = useProjectStore
                          .getState()
                          .project.timeline.tracks.find(t =>
                            t.clips.some(c => c.mediaId === newItem.id)
                          );
                        if (track) {
                          toast.success(editorMessage("editor.timeline.toolbar.added", { name: track.name }), file.name);
                        }
                      }
                    }
                  } catch (err) {
                    console.error("[Timeline] External file drop failed:", err);
                  }
                }
                return;
              }

              // Internal drag from assets panel
              try {
                const rawData = e.dataTransfer.getData("application/json");
                if (!rawData) return;
                const data = JSON.parse(rawData);
                if (!data?.mediaId) return;
                handleDropMedia("", data.mediaId, snappedTime);
              } catch {
                // ignore
              }
            }}
          >
            <div
              style={{ width: `${timelineDuration * pixelsPerSecond}px` }}
              className="min-w-full"
            >
              {visualOrderTracks.map((track) => (
                <TrackLane
                  key={track.id}
                  track={track}
                  allTracks={visualOrderTracks}
                  pixelsPerSecond={pixelsPerSecond}
                  selectedClipIds={selectedClipIds}
                  textClips={textClipsByTrack.get(track.id)!}
                  shapeClips={shapeClipsByTrack.get(track.id)!}
                  trackHeights={trackHeightsMap}
                  timelineRef={tracksRef}
                  onSelectClip={handleSelectClip}
                  onDropMedia={handleDropMedia}
                  onMoveClip={handleMoveClip}
                  onSnapIndicator={handleSnapIndicator}
                  onTrimClip={handleTrimClip}
                  onTrimTextClip={handleTrimTextClip}
                  onMoveTextClip={handleMoveTextClip}
                  onTrimShapeClip={handleTrimShapeClip}
                  scrollX={scrollX}
                  trackHeight={getTrackHeight(track.id, track.type)}
                  onResizeTrack={setTrackHeightById}
                  onKeyframeSelect={handleKeyframeSelect}
                  onKeyframeMove={handleKeyframeMove}
                  onKeyframeDelete={handleKeyframeDelete}
                  selectedKeyframeIds={selectedKeyframeIds}
                  onSelectTransition={handleSelectTransition}
                  selectedTransitionId={selectedTransitionId}
                />
              ))}

              <div
                aria-hidden="true"
                style={{ height: canvas ? 0 : ADD_TRACK_ROW_HEIGHT }}
              />

              <BeatMarkerOverlay
                pixelsPerSecond={pixelsPerSecond}
                scrollX={scrollX}
                viewportWidth={viewportWidth}
                totalHeight={totalTracksHeight}
              />

              {project.timeline.markers.map((marker) => (
                <MarkerIndicator
                  key={marker.id}
                  marker={marker}
                  pixelsPerSecond={pixelsPerSecond}
                  scrollX={scrollX}
                  onSeek={(time) => {
                    const bridge = getPlaybackBridge();
                    bridge.scrubTo(time);
                  }}
                  onRemove={removeMarker}
                  onUpdate={updateMarker}
                />
              ))}

              {snapIndicatorTime !== null && (
                <div
                  className="absolute top-0 bottom-0 w-px bg-yellow-400 z-30 pointer-events-none"
                  style={{ left: `${snapIndicatorTime * pixelsPerSecond}px` }}
                >
                  <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-yellow-400 rounded-full" />
                </div>
              )}

              {isBoxSelecting && selectionBox && (
                <div
                  className="absolute border-2 border-primary bg-primary/10 pointer-events-none z-40"
                  style={{
                    left:
                      Math.min(selectionBox.startX, selectionBox.currentX) -
                      scrollX,
                    top:
                      Math.min(selectionBox.startY, selectionBox.currentY) -
                      scrollY,
                    width: Math.abs(
                      selectionBox.currentX - selectionBox.startX,
                    ),
                    height: Math.abs(
                      selectionBox.currentY - selectionBox.startY,
                    ),
                  }}
                />
              )}
            </div>
          </div>
        </div>

        <Playhead
          position={playheadPosition}
          pixelsPerSecond={pixelsPerSecond}
          scrollX={scrollX}
          headerOffset={headerWidth}
          playing={playbackState === "playing"}
          compact={canvas}
        />
      </div>
    </div>
  );
};

export default Timeline;
