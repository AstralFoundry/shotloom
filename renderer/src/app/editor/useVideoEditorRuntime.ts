import {
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  createOpenVideoRuntime,
  getOpenVideoRuntimeSupport,
} from "../../services/openVideoRuntime.js";
import { videoEditorDuration } from "../../utils/videoEditorProject.mjs";
import type { VideoEditorRuntimeRef } from "./videoEditorRuntimeTypes";
import type {
  VideoEditorProject,
  VideoEditorTransform,
} from "./videoEditorTypes";

type SourceState = "empty" | "loading" | "ready" | "error";

export function useVideoEditorRuntime({
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
  onTransformStart,
  onTransformEnd,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  project: VideoEditorProject;
  projectRef: MutableRefObject<VideoEditorProject>;
  selectedId: string;
  time: number;
  playbackUrl: string;
  sourceState: SourceState;
  preferFallbackPreview: boolean;
  runtimeRef: VideoEditorRuntimeRef;
  runtimeMutationRef: MutableRefObject<boolean>;
  timelineDragRef: MutableRefObject<unknown>;
  visualTransformRef: MutableRefObject<unknown>;
  createStudioProject: (project: VideoEditorProject) => unknown;
  setTime: Dispatch<SetStateAction<number>>;
  setPlaying: Dispatch<SetStateAction<boolean>>;
  setSelectedId: Dispatch<SetStateAction<string>>;
  onTransformStart: () => void;
  onTransformEnd: (event: { id: string; transform: VideoEditorTransform }) => void;
}) {
  const [engineReady, setEngineReady] = useState(false);
  const [engineError, setEngineError] = useState("");
  const playbackStructureSignature = useMemo(() => JSON.stringify({
    settings: {
      width: project.settings.width,
      height: project.settings.height,
      fps: project.settings.fps,
    },
    tracks: project.tracks.map((track) => ({
      id: track.id,
      type: track.type,
      hidden: track.hidden,
      clips: track.clips.map((clip) => ({
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
        if (!active) return;
        const duration = videoEditorDuration(projectRef.current);
        setTime(Math.min(duration, value));
        if (value >= duration - .02) setPlaying(false);
      },
      onSelection: (ids: string[]) => setSelectedId(ids.at(-1) || ""),
      onTransformStart,
      onTransformEnd,
      onPlayingChange: setPlaying,
    }).then(async (runtime) => {
      if (!active) return runtime.destroy();
      runtimeRef.current = runtime;
      if (selectedId) runtime.selectClip(selectedId);
      await runtime.seek(Math.min(
        time,
        videoEditorDuration(projectRef.current),
      ));
      if (!active) return runtime.destroy();
      setEngineReady(true);
    }).catch((cause) => {
      setEngineReady(false);
      setEngineError(cause instanceof Error ? cause.message : "预览引擎启动失败");
    });
    return () => {
      active = false;
      runtimeRef.current?.destroy();
      runtimeRef.current = null;
    };
  }, [
    createStudioProject,
    onTransformEnd,
    onTransformStart,
    playbackStructureSignature,
    playbackUrl,
    preferFallbackPreview,
    sourceState,
  ]);

  useEffect(() => {
    if (
      !runtimeRef.current || timelineDragRef.current || visualTransformRef.current
    ) return;
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

  return {
    engineReady,
    engineError,
    setEngineError,
  };
}
