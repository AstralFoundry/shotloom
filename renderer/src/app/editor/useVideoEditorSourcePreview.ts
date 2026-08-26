import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { desktopApi } from "../../services/desktopApi.js";
import {
  activeEditorClip,
  editorClipDuration,
} from "../../utils/videoEditorProject.mjs";
import { editorMediaMimeType } from "../../utils/editorMediaImport.mjs";
import { hydrateSourceProject } from "./videoEditorModel";
import type { VideoEditorRuntimeRef } from "./videoEditorRuntimeTypes";
import type {
  VideoEditorAsset,
  VideoEditorClip,
  VideoEditorProject,
} from "./videoEditorTypes";

export type VideoEditorSourceState = "empty" | "loading" | "ready" | "error";

interface SourceMetadata {
  duration?: number;
  width?: number;
  height?: number;
  videoWidth?: number;
  videoHeight?: number;
}

export function useVideoEditorSourcePreview({
  initialProject,
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
}: {
  initialProject: VideoEditorProject;
  project: VideoEditorProject;
  projectRef: MutableRefObject<VideoEditorProject>;
  setProject: Dispatch<SetStateAction<VideoEditorProject>>;
  runtimeRef: VideoEditorRuntimeRef;
  runtimeMediaUrls: Record<string, string>;
  sourceFile: string;
  sourceUrl: string;
  sourceName: string;
  metadata?: SourceMetadata;
  duration: number;
  time: number;
  playing: boolean;
  setTime: Dispatch<SetStateAction<number>>;
  setPlaying: Dispatch<SetStateAction<boolean>>;
  controller: { persist: (project: VideoEditorProject) => void };
}) {
  const initialVideoClip = initialProject.tracks
    .find((track) => track.type === "video")?.clips
    .find((clip) => clip.type === "video");
  const initialPlaybackAsset = initialProject.assets.find((asset) =>
    asset.id === initialVideoClip?.assetId
  ) || initialProject.assets.find((asset) => asset.type === "video");
  const [playbackUrl, setPlaybackUrl] = useState(
    initialPlaybackAsset?.sourceUrl || sourceUrl,
  );
  const [sourceThumbnail, setSourceThumbnail] = useState("");
  const [sourceState, setSourceState] = useState<VideoEditorSourceState>(
    initialPlaybackAsset?.sourceUrl || sourceUrl ? "loading" : "empty",
  );
  const fallbackRef = useRef<HTMLVideoElement>(null);
  const blobUrlRef = useRef("");
  const sourceFallbackPendingRef = useRef(false);
  const sourcePreviewPrimedRef = useRef(false);

  const directPreviewClips = project.tracks
    .filter((track) => track.type === "video" && !track.hidden)
    .flatMap((track) => track.clips)
    .filter((clip) => clip.type === "video")
    .sort((left, right) => left.timelineStart - right.timelineStart);
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
      !project.tracks.some((track) =>
        ["overlay", "effect", "transition"].includes(track.type) &&
        track.clips.length > 0
      )
    ));
  const primaryVideoAssetId = project.tracks
    .find((track) => track.type === "video")?.clips
    .find((clip) => clip.type === "video")?.assetId ||
    project.assets.find((asset) => asset.type === "video")?.id;
  const primaryVideoAsset = project.assets.find((asset) =>
    asset.id === primaryVideoAssetId
  );
  const nativePreviewClip = usesNativeSequencePreview
    ? activeEditorClip(directPreviewClips, time) ||
      (time >= duration - .001 ? directPreviewClips.at(-1) : null)
    : directPreviewClip;
  const nativePreviewAsset = project.assets.find((asset) =>
    asset.id === nativePreviewClip?.assetId
  );
  const nativePreviewUrl = nativePreviewAsset
    ? runtimeMediaUrls[nativePreviewAsset.id] || nativePreviewAsset.sourceUrl
    : playbackUrl;
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

  const seekPreview = (seconds: number) => {
    const value = Math.max(0, Math.min(duration, seconds));
    setTime(value);
    if (runtimeRef.current) void runtimeRef.current.seek(value);
    const video = fallbackRef.current;
    if (!video) return;
    const clip = activeEditorClip(directPreviewClips, value) ||
      (value >= duration - .001 ? directPreviewClips.at(-1) : null);
    const mediaTime = usesNativeSequencePreview && clip
      ? Math.min(
        Number(clip.trimEnd) - .001,
        Number(clip.trimStart) +
          Math.max(0, value - clip.timelineStart) * Number(clip.speed),
      )
      : value;
    if (Math.abs(video.currentTime - mediaTime) > .02) {
      video.currentTime = mediaTime;
    }
  };

  const togglePlayback = async () => {
    const runtime = runtimeRef.current;
    if (!runtime || preferFallbackPreview) {
      const video = fallbackRef.current;
      if (!video) return;
      if (!playing) {
        const start = time >= duration - .02 ? 0 : time;
        if (start !== time) setTime(start);
        const clip = activeEditorClip(directPreviewClips, start) ||
          directPreviewClips.find((item) => item.timelineStart > start);
        if (usesNativeSequencePreview && clip) {
          if (clip.timelineStart > start) setTime(clip.timelineStart);
          video.currentTime = Math.min(
            Number(clip.trimEnd) - .001,
            Number(clip.trimStart) +
              Math.max(0, start - clip.timelineStart) * Number(clip.speed),
          );
          video.playbackRate = Number(clip.speed);
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
  };

  const continueNativeSequence = (clipId: string) => {
    if (!usesNativeSequencePreview) {
      setPlaying(false);
      return;
    }
    const index = directPreviewClips.findIndex((clip) => clip.id === clipId);
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
  };

  const captureSourceThumbnail = (video: HTMLVideoElement) => {
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
      // Custom protocols may disallow canvas reads; live video remains the fallback.
    }
  };

  const primeSourcePreview = (video: HTMLVideoElement) => {
    if (sourcePreviewPrimedRef.current || !video.duration || video.readyState < 2) return;
    sourcePreviewPrimedRef.current = true;
    const frameTime = Math.min(
      Math.max(time, 0),
      Math.max(0, video.duration - .04),
    );
    video.pause();
    video.currentTime = frameTime;
  };

  const sourceLoaded = (video: HTMLVideoElement) => {
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
  };

  const sourceFailed = async () => {
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
  };

  useEffect(() => () => {
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
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

  return {
    fallbackRef,
    playbackUrl,
    sourceThumbnail,
    sourceState,
    directPreviewClips,
    usesNativeSequencePreview,
    preferFallbackPreview,
    primaryVideoAssetId,
    nativePreviewClip: nativePreviewClip as VideoEditorClip | null | undefined,
    nativePreviewAsset: nativePreviewAsset as VideoEditorAsset | undefined,
    nativePreviewUrl,
    previewAudio,
    togglePlayback,
    seekPreview,
    continueNativeSequence,
    captureSourceThumbnail,
    primeSourcePreview,
    sourceLoaded,
    sourceFailed,
  };
}
