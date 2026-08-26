import {
  type Dispatch,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
} from "react";
import {
  editorClipDuration,
  findEditorClip,
  snapEditorClipStart,
  updateEditorClip,
} from "../../utils/videoEditorProject.mjs";
import { constrainTransformToCanvas } from "./videoEditorModel";
import type { VideoEditorRuntimeRef } from "./videoEditorRuntimeTypes";
import type {
  VideoEditorClip,
  VideoEditorProject,
  VideoEditorTransform,
} from "./videoEditorTypes";

type TransformMode = "move" | "resize" | "rotate";

interface VisualTransformGesture {
  id: string;
  mode: TransformMode;
  startX: number;
  startY: number;
  transform: VideoEditorTransform;
  snapshot: VideoEditorProject;
  monitor: DOMRect;
  startPointerAngle: number;
  clipType: string;
  fontSize: number;
  moved: boolean;
}

interface TimelineDragGesture {
  id: string;
  startX: number;
  timelineStart: number;
  snapshot?: VideoEditorProject;
}

export function useVideoEditorGestures({
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
}: {
  projectRef: MutableRefObject<VideoEditorProject>;
  setProject: Dispatch<SetStateAction<VideoEditorProject>>;
  monitorRef: RefObject<HTMLDivElement | null>;
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
  const canvasTransformSnapshotRef = useRef<VideoEditorProject | null>(null);
  const visualTransformRef = useRef<VisualTransformGesture | null>(null);
  const timelineDragRef = useRef<TimelineDragGesture | null>(null);

  const beginVisualTransform = (
    event: ReactPointerEvent,
    clip: VideoEditorClip,
    mode: TransformMode,
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
      startX: event.clientX,
      startY: event.clientY,
      transform,
      snapshot: cloneProject(projectRef.current),
      monitor,
      startPointerAngle: Math.atan2(event.clientY - centerY, event.clientX - centerX),
      clipType: clip.type,
      fontSize: Number(clip.style?.fontSize) || 72,
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
    timelineDragRef.current = {
      id: clip.id,
      startX: event.clientX,
      timelineStart: clip.timelineStart,
    };
  };

  const onRuntimeTransformStart = useCallback(() => {
    canvasTransformSnapshotRef.current = cloneProject(projectRef.current);
  }, [projectRef]);

  const onRuntimeTransformEnd = useCallback(({
    id,
    transform,
  }: {
    id: string;
    transform: VideoEditorTransform;
  }) => {
    const snapshot = canvasTransformSnapshotRef.current;
    canvasTransformSnapshotRef.current = null;
    const next = updateEditorClip(projectRef.current, id, { transform });
    if (next === projectRef.current) return;
    runtimeMutationRef.current = true;
    if (snapshot) recordHistory(snapshot);
    projectRef.current = next;
    setProject(next);
    controller.persist(next);
  }, [controller, projectRef, recordHistory, runtimeMutationRef, setProject]);

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
        transform.width = Math.min(
          maxWidth,
          Math.max(48, gesture.transform.width + widthDelta),
        );
        transform.height = transform.width / ratio;
      } else {
        const centerX = gesture.monitor.left +
          (gesture.transform.x + gesture.transform.width / 2) /
            canvasWidth * gesture.monitor.width;
        const centerY = gesture.monitor.top +
          (gesture.transform.y + gesture.transform.height / 2) /
            canvasHeight * gesture.monitor.height;
        const pointerAngle = Math.atan2(
          event.clientY - centerY,
          event.clientX - centerX,
        );
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
  }, [controller, createStudioProject, projectRef, recordHistory, runtimeMutationRef, runtimeRef, setProject]);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const drag = timelineDragRef.current;
      if (!drag) return;
      if (!drag.snapshot) drag.snapshot = cloneProject(projectRef.current);
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
      const drag = timelineDragRef.current;
      if (!drag) return;
      timelineDragRef.current = null;
      if (drag.snapshot) recordHistory(drag.snapshot);
      controller.persist(projectRef.current);
      runtimeRef.current?.replaceProject(createStudioProject(projectRef.current));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [controller, createStudioProject, projectRef, recordHistory, runtimeRef, setProject, zoom]);

  return {
    beginVisualTransform,
    beginTimelineDrag,
    onRuntimeTransformStart,
    onRuntimeTransformEnd,
    visualTransformRef,
    timelineDragRef,
  };
}

function cloneProject(project: VideoEditorProject) {
  return JSON.parse(JSON.stringify(project)) as VideoEditorProject;
}
