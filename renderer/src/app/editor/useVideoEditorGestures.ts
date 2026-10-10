import {
  type Dispatch,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type SetStateAction,
  useEffect,
  useRef,
} from "react";
import {
  MIN_DURATION,
  addEditorTrack,
  editorClipDuration,
  findEditorClip,
  moveEditorClip,
  snapEditorClipStart,
  trimEditorClip,
  updateEditorClip,
} from "../../utils/videoEditorProject.mjs";
import { constrainTransformToCanvas, resizeEditorTransform, type TransformCorner } from "./videoEditorModel";
import type { VideoEditorRuntimeRef } from "./videoEditorRuntimeTypes";
import type {
  VideoEditorClip,
  VideoEditorProject,
  VideoEditorTransform,
} from "./videoEditorTypes";

type TransformMode = "move" | "resize" | "rotate";
/** 按下后超过该位移才算拖动：点选与拖动互不干扰，也避免误触产生撤销记录。 */
const DRAG_THRESHOLD_PX = 5;
/** 时间线吸附容差（屏幕像素，除以 zoom 换算成秒）。 */
const SNAP_TOLERANCE_PX = 10;
/** 时间线网格吸附间隔（秒），优先级最低。 */
const SNAP_GRID_SECONDS = 1;
/** 指针距滚动容器边缘多近开始自动滚动，以及每帧滚动多少像素。 */
const AUTO_SCROLL_BAND_PX = 80;
const AUTO_SCROLL_STEP_PX = 10;
/** 在轨道区下方空白处拖出新轨道时的默认名称。 */
const DEFAULT_TRACK_NAMES: Record<string, string> = {
  video: "补充画面",
  audio: "音乐与音效",
  text: "文字",
};

interface VisualTransformGesture {
  id: string;
  mode: TransformMode;
  corner: TransformCorner;
  startX: number;
  startY: number;
  transform: VideoEditorTransform;
  snapshot: VideoEditorProject;
  monitor: DOMRect;
  startPointerAngle: number;
  clipType: string;
  fontSize: number;
  /** 最近一次指针事件的 Shift 状态：按住时等比缩放。 */
  lockRatio: boolean;
  moved: boolean;
}

interface TimelineDragGesture {
  id: string;
  /** 起始轨道与类型：类型决定能落到哪些轨道，也决定空白处新建什么轨道。 */
  trackId: string;
  trackType: string;
  startX: number;
  startY: number;
  timelineStart: number;
  active: boolean;
  snapshot?: VideoEditorProject;
}

interface TimelineTrimGesture {
  id: string;
  edge: "start" | "end";
  startX: number;
  speed: number;
  /** 手势开始时的位置，拖动过程中每帧都基于它算绝对位置。 */
  origin: { timelineStart: number; trimStart: number; trimEnd: number };
  active: boolean;
  snapshot: VideoEditorProject;
}

interface TimelineScrubGesture {
  /** 时间原点（0 秒）在屏幕上的 x 坐标。 */
  originLeft: number;
  active: boolean;
}

export function useVideoEditorGestures({
  projectRef,
  setProject,
  monitorRef,
  timelineRef,
  runtimeRef,
  runtimeMutationRef,
  zoom,
  time,
  controller,
  createStudioProject,
  recordHistory,
  setSelectedId,
  seekPreview,
}: {
  projectRef: MutableRefObject<VideoEditorProject>;
  setProject: Dispatch<SetStateAction<VideoEditorProject>>;
  monitorRef: RefObject<HTMLDivElement | null>;
  timelineRef: RefObject<HTMLDivElement | null>;
  runtimeRef: VideoEditorRuntimeRef;
  runtimeMutationRef: MutableRefObject<boolean>;
  zoom: number;
  time: number;
  controller: { persist: (project: VideoEditorProject) => void };
  createStudioProject: (project: VideoEditorProject) => unknown;
  recordHistory: (snapshot: VideoEditorProject) => void;
  setSelectedId: Dispatch<SetStateAction<string>>;
  seekPreview: (time: number) => void;
}) {
  const visualTransformRef = useRef<VisualTransformGesture | null>(null);
  const timelineDragRef = useRef<TimelineDragGesture | null>(null);
  const timelineTrimRef = useRef<TimelineTrimGesture | null>(null);
  const timelineScrubRef = useRef<TimelineScrubGesture | null>(null);
  const scrubPointerRef = useRef<{ x: number } | null>(null);
  // 拖动的中间量全部走 ref：写入 ref 不触发渲染，因此拖动过程本身不需要 React 参与。
  const visualPointerRef = useRef<{ x: number; y: number } | null>(null);
  const timelinePointerRef = useRef<{ x: number; y: number } | null>(null);
  // 播放头吸附要读实时值；放进 effect 依赖会让每次播放重装监听器。
  const playheadRef = useRef(time);
  playheadRef.current = time;

  const beginVisualTransform = (
    event: ReactPointerEvent,
    clip: VideoEditorClip,
    mode: TransformMode,
    corner: TransformCorner = "se",
  ) => {
    const monitor = monitorRef.current?.getBoundingClientRect();
    const found = findEditorClip(projectRef.current, clip.id);
    if (
      !monitor || !monitor.width || !monitor.height ||
      found?.track.locked || clip.locked
    ) return;
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
      corner,
      startX: event.clientX,
      startY: event.clientY,
      transform,
      snapshot: cloneProject(projectRef.current),
      monitor,
      startPointerAngle: Math.atan2(event.clientY - centerY, event.clientX - centerX),
      clipType: clip.type,
      fontSize: Number(clip.style?.fontSize) || 72,
      lockRatio: event.shiftKey === true,
      moved: false,
    };
  };

  const beginTimelineDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
    clip: VideoEditorClip,
  ) => {
    event.stopPropagation();
    setSelectedId(clip.id);
    const clipEnd = clip.timelineStart + editorClipDuration(clip);
    if (time <= clip.timelineStart || time >= clipEnd) {
      seekPreview(clip.timelineStart + Math.min(.1, editorClipDuration(clip) / 2));
    }
    // 拖动过程中指针会离开片段本身，光标必须挂在 body 上才稳定。
    const found = findEditorClip(projectRef.current, clip.id);
    if (!found || found.track.locked || clip.locked) return;
    document.body.style.cursor = "grabbing";
    timelineDragRef.current = {
      id: clip.id,
      trackId: found.track.id,
      trackType: found.track.type,
      startX: event.clientX,
      startY: event.clientY,
      timelineStart: clip.timelineStart,
      active: false,
    };
  };

  const beginTimelineTrim = (
    event: ReactPointerEvent,
    clip: VideoEditorClip,
    edge: "start" | "end",
  ) => {
    // 手柄按下不能冒泡成片段拖动，否则会边裁边挪。
    event.preventDefault();
    event.stopPropagation();
    const found = findEditorClip(projectRef.current, clip.id);
    if (!found || found.track.locked || clip.locked) return;
    setSelectedId(clip.id);
    document.body.style.cursor = "ew-resize";
    timelineTrimRef.current = {
      id: clip.id,
      edge,
      startX: event.clientX,
      speed: Math.max(0.5, Math.min(2, Number(clip.speed) || 1)),
      origin: {
        timelineStart: Number(clip.timelineStart) || 0,
        trimStart: Number(clip.trimStart) || 0,
        trimEnd: Number(clip.trimEnd) || 0,
      },
      active: false,
      snapshot: cloneProject(projectRef.current),
    };
  };

  const beginTimelineScrub = (
    event: ReactPointerEvent,
    originLeft: number,
  ) => {
    // 标尺自有拖动，必须在按下时就落一次位置，否则会与内容区的单击跳转重复或互相吞掉。
    event.preventDefault();
    event.stopPropagation();
    document.body.style.cursor = "ew-resize";
    timelineScrubRef.current = { originLeft, active: true };
    scrubPointerRef.current = { x: event.clientX };
    seekPreview(Math.max(0, (event.clientX - originLeft) / zoom));
  };


  useEffect(() => {
    let frame = 0;

    const apply = () => {
      frame = 0;
      const gesture = visualTransformRef.current;
      const pointer = visualPointerRef.current;
      if (!gesture || !pointer) return;
      const canvasWidth = projectRef.current.settings.width;
      const canvasHeight = projectRef.current.settings.height;
      const dx = (pointer.x - gesture.startX) / gesture.monitor.width * canvasWidth;
      const dy = (pointer.y - gesture.startY) / gesture.monitor.height * canvasHeight;
      let transform: VideoEditorTransform = { ...gesture.transform };
      if (gesture.mode === "move") {
        transform.x = gesture.transform.x + dx;
        transform.y = gesture.transform.y + dy;
      } else if (gesture.mode === "resize") {
        // 默认自由调整宽高（"拖拽裁剪大小"的直觉操作），按住 Shift 才等比缩放。
        transform = resizeEditorTransform(
          gesture.transform,
          gesture.corner,
          dx,
          dy,
          { lockRatio: gesture.lockRatio },
        );
      } else {
        const centerX = gesture.monitor.left +
          (gesture.transform.x + gesture.transform.width / 2) /
            canvasWidth * gesture.monitor.width;
        const centerY = gesture.monitor.top +
          (gesture.transform.y + gesture.transform.height / 2) /
            canvasHeight * gesture.monitor.height;
        const pointerAngle = Math.atan2(pointer.y - centerY, pointer.x - centerX);
        transform.angle = (Number(gesture.transform.angle) || 0) +
          (pointerAngle - gesture.startPointerAngle) * 180 / Math.PI;
      }
      transform = constrainTransformToCanvas(transform, canvasWidth, canvasHeight);
      const currentClip = findEditorClip(projectRef.current, gesture.id)?.clip;
      const updates: Record<string, unknown> = { transform };
      if (gesture.mode === "resize" && gesture.clipType === "text" && currentClip) {
        updates.style = {
          ...currentClip.style,
          fontSize: Math.max(
            8,
            gesture.fontSize * transform.width / gesture.transform.width,
          ),
        };
      }
      const next = updateEditorClip(projectRef.current, gesture.id, updates);
      if (next === projectRef.current) return;
      gesture.moved = true;
      runtimeMutationRef.current = true;
      projectRef.current = next;
      setProject(next);
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(() => apply());
    };

    const move = (event: PointerEvent) => {
      const gesture = visualTransformRef.current;
      if (!gesture) return;
      // 拖动阈值：先判断位移是否超过阈值，再决定要不要重建工程。
      if (!gesture.moved
        && Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) < DRAG_THRESHOLD_PX) {
        return;
      }
      gesture.lockRatio = event.shiftKey === true;
      visualPointerRef.current = { x: event.clientX, y: event.clientY };
      schedule();
    };
    const up = () => {
      const gesture = visualTransformRef.current;
      if (!gesture) return;
      // 先把最后一帧落定，再结束手势，避免丢掉最后的位移。
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
        apply();
      }
      visualTransformRef.current = null;
      visualPointerRef.current = null;
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
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [controller, createStudioProject, projectRef, recordHistory, runtimeMutationRef, runtimeRef, setProject]);

  useEffect(() => {
    let frame = 0;

    /** 指针落在哪条轨道上；低于最后一条轨道视作「在空白处新建」。 */
    const laneAtPointer = (clientY: number) => {
      const scroll = timelineRef.current;
      if (!scroll) return null;
      const lanes = scroll.querySelectorAll<HTMLElement>(".ov-track-lane[data-track-id]");
      let last: HTMLElement | null = null;
      for (const lane of lanes) {
        const rect = lane.getBoundingClientRect();
        if (clientY >= rect.top && clientY <= rect.bottom) return { trackId: lane.dataset.trackId || "", below: false };
        last = lane;
      }
      if (last && clientY > last.getBoundingClientRect().bottom) return { trackId: "", below: true };
      return null;
    };

    const highlightLane = (trackId: string, create: boolean) => {
      const scroll = timelineRef.current;
      if (!scroll) return;
      const lanes = scroll.querySelectorAll<HTMLElement>(".ov-track-lane[data-track-id]");
      for (const lane of lanes) {
        lane.classList.toggle("drop-target", !create && lane.dataset.trackId === trackId);
      }
      if (create) lanes[lanes.length - 1]?.classList.add("drop-target", "drop-create");
    };

    const clearHighlight = () => {
      const scroll = timelineRef.current;
      if (!scroll) return;
      for (const lane of scroll.querySelectorAll(".ov-track-lane")) {
        lane.classList.remove("drop-target", "drop-create");
      }
    };

    const apply = (final = false) => {
      frame = 0;
      const drag = timelineDragRef.current;
      const pointer = timelinePointerRef.current;
      if (!drag?.active || !pointer) return;
      // 边缘自动滚动：指针停在滚动容器边缘时按固定步长持续滚动，不依赖新的指针事件。
      const scroll = timelineRef.current;
      if (scroll) {
        const rect = scroll.getBoundingClientRect();
        if (pointer.x - rect.left < AUTO_SCROLL_BAND_PX) scroll.scrollLeft -= AUTO_SCROLL_STEP_PX;
        else if (rect.right - pointer.x < AUTO_SCROLL_BAND_PX) scroll.scrollLeft += AUTO_SCROLL_STEP_PX;
      }
      const hit = laneAtPointer(pointer.y);
      // 类型不符的轨道不接：保持原轨道，只沿用时间轴位移。
      const compatible = hit?.trackId
        ? projectRef.current.tracks.find((item) => item.id === hit.trackId)?.type === drag.trackType
        : false;
      const creating = hit?.below === true;
      highlightLane(compatible ? hit!.trackId : drag.trackId, creating);
      let project = projectRef.current;
      let targetTrackId = compatible ? hit!.trackId : drag.trackId;
      // 新建轨道只在松手时做一次：拖动过程中每帧新建会留下一串空轨道。
      if (creating && final) {
        const created = addEditorTrack(project, drag.trackType, DEFAULT_TRACK_NAMES[drag.trackType] || drag.trackType);
        const createdTrack = created.tracks.at(-1);
        if (created !== project && createdTrack) {
          project = created;
          targetTrackId = createdTrack.id;
        }
      }
      const requestedStart = Math.max(
        0,
        drag.timelineStart + (pointer.x - drag.startX) / zoom,
      );
      const snappedStart = snapEditorClipStart(
        project,
        drag.id,
        requestedStart,
        SNAP_TOLERANCE_PX / zoom,
        { playhead: playheadRef.current, gridSize: SNAP_GRID_SECONDS },
      );
      const nextStart = Math.round(snappedStart * 100) / 100;
      const current = findEditorClip(project, drag.id)?.clip;
      // 吸附会把大量连续指针位置映射到同一个落点，值没变就不要再重建整份工程。
      if (project === projectRef.current && current?.timelineStart === nextStart) {
        if (!final) schedule();
        return;
      }
      const next = moveEditorClip(project, drag.id, targetTrackId, nextStart);
      projectRef.current = next;
      setProject(next);
      if (!final) schedule();
    };

    const schedule = () => {
      // 必须包一层：requestAnimationFrame 会把时间戳当第一个参数传入，
      // 直接传 apply 会让每帧都被当成"最终帧"。
      if (!frame) frame = requestAnimationFrame(() => apply());
    };

    const move = (event: PointerEvent) => {
      const drag = timelineDragRef.current;
      if (!drag) return;
      if (!drag.active) {
        if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < DRAG_THRESHOLD_PX) return;
        drag.active = true;
        drag.snapshot = cloneProject(projectRef.current);
      }
      timelinePointerRef.current = { x: event.clientX, y: event.clientY };
      schedule();
    };
    const up = () => {
      const drag = timelineDragRef.current;
      if (!drag) return;
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      // 松手时做最后一步：跨轨落位与「空白处新建轨道」都在这里一次性完成。
      if (drag.active) apply(true);
      timelineDragRef.current = null;
      timelinePointerRef.current = null;
      document.body.style.cursor = "";
      clearHighlight();
      if (!drag.active) return;
      if (drag.snapshot) recordHistory(drag.snapshot);
      controller.persist(projectRef.current);
      runtimeRef.current?.replaceProject(createStudioProject(projectRef.current));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      clearHighlight();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [controller, createStudioProject, projectRef, recordHistory, runtimeRef, setProject, timelineRef, zoom]);

  useEffect(() => {
    let frame = 0;

    const apply = () => {
      frame = 0;
      const trim = timelineTrimRef.current;
      const pointer = timelinePointerRef.current;
      if (!trim?.active || !pointer) return;
      // 屏幕像素 → 时间线秒 → 源秒：变速片段裁同样的源长度只占更短的时间轴。
      const deltaSource = (pointer.x - trim.startX) / zoom * trim.speed;
      const next = trimEditorClip(
        projectRef.current, trim.id, trim.edge, deltaSource, trim.origin,
      );
      if (next === projectRef.current) return;
      projectRef.current = next;
      setProject(next);
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(() => apply());
    };

    const move = (event: PointerEvent) => {
      const trim = timelineTrimRef.current;
      if (!trim) return;
      if (!trim.active) {
        if (Math.hypot(event.clientX - trim.startX, 0) < DRAG_THRESHOLD_PX) return;
        trim.active = true;
      }
      timelinePointerRef.current = { x: event.clientX, y: event.clientY };
      schedule();
    };
    const up = () => {
      const trim = timelineTrimRef.current;
      if (!trim) return;
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
        apply();
      }
      timelineTrimRef.current = null;
      timelinePointerRef.current = null;
      document.body.style.cursor = "";
      if (!trim.active) return;
      recordHistory(trim.snapshot);
      controller.persist(projectRef.current);
      runtimeRef.current?.replaceProject(createStudioProject(projectRef.current));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [controller, createStudioProject, projectRef, recordHistory, runtimeRef, setProject, zoom]);

  useEffect(() => {
    let frame = 0;

    const apply = () => {
      frame = 0;
      const scrub = timelineScrubRef.current;
      const pointer = scrubPointerRef.current;
      if (!scrub?.active || !pointer) return;
      // seekPreview 会写 React state 并驱动运行时与回退视频，逐帧一次就够。
      seekPreview(Math.max(0, (pointer.x - scrub.originLeft) / zoom));
    };

    const move = (event: PointerEvent) => {
      if (!timelineScrubRef.current?.active) return;
      scrubPointerRef.current = { x: event.clientX };
      if (!frame) frame = requestAnimationFrame(() => apply());
    };
    const up = () => {
      if (!timelineScrubRef.current) return;
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
        apply();
      }
      timelineScrubRef.current = null;
      scrubPointerRef.current = null;
      document.body.style.cursor = "";
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [seekPreview, zoom]);

  return {
    beginVisualTransform,
    beginTimelineDrag,
    beginTimelineTrim,
    beginTimelineScrub,
    visualTransformRef,
    timelineDragRef,
    timelineTrimRef,
  };
}

function cloneProject(project: VideoEditorProject) {
  return JSON.parse(JSON.stringify(project)) as VideoEditorProject;
}
