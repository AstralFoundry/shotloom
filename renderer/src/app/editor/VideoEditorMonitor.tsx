import type {
  PointerEvent as ReactPointerEvent,
  RefObject,
} from "react";
import { editorClipDuration } from "../../utils/videoEditorProject.mjs";
import { IconSymbol } from "../components/IconSymbol";
import { constrainTransformToCanvas } from "./videoEditorModel";
import { formatEditorTimecode } from "./videoEditorFormat";
import type {
  VideoEditorAsset,
  VideoEditorClip,
  VideoEditorProject,
} from "./videoEditorTypes";

type SourceState = "empty" | "loading" | "ready" | "error";
type TransformMode = "move" | "resize" | "rotate";

export function VideoEditorMonitor({
  project,
  canvasRef,
  monitorRef,
  fallbackRef,
  engineReady,
  engineError,
  sourceState,
  preferFallbackPreview,
  usesNativeSequencePreview,
  nativePreviewClip,
  nativePreviewAsset,
  primaryVideoAssetId,
  nativePreviewUrl,
  playbackUrl,
  previewAudio,
  time,
  duration,
  playing,
  sourceThumbnail,
  activeImageClips,
  activeTextClips,
  assets,
  selectedId,
  onSourceLoaded,
  onCaptureThumbnail,
  onPrimeSourcePreview,
  onSourceFailed,
  onSetEngineError,
  onSetPlaying,
  onSetTime,
  onContinueSequence,
  onBeginTransform,
  onFramePrevious,
  onFrameNext,
  onTogglePlayback,
  onSplit,
  onSeek,
  onResetView,
}: {
  project: VideoEditorProject;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  monitorRef: RefObject<HTMLDivElement | null>;
  fallbackRef: RefObject<HTMLVideoElement | null>;
  engineReady: boolean;
  engineError: string;
  sourceState: SourceState;
  preferFallbackPreview: boolean;
  usesNativeSequencePreview: boolean;
  nativePreviewClip?: VideoEditorClip | null;
  nativePreviewAsset?: VideoEditorAsset;
  primaryVideoAssetId?: string;
  nativePreviewUrl: string;
  playbackUrl: string;
  previewAudio: { muted: boolean; volume: number };
  time: number;
  duration: number;
  playing: boolean;
  sourceThumbnail: string;
  activeImageClips: VideoEditorClip[];
  activeTextClips: VideoEditorClip[];
  assets: VideoEditorAsset[];
  selectedId: string;
  onSourceLoaded: (video: HTMLVideoElement) => void;
  onCaptureThumbnail: (video: HTMLVideoElement) => void;
  onPrimeSourcePreview: (video: HTMLVideoElement) => void;
  onSourceFailed: () => void;
  onSetEngineError: (message: string) => void;
  onSetPlaying: (playing: boolean) => void;
  onSetTime: (time: number) => void;
  onContinueSequence: (clipId: string) => void;
  onBeginTransform: (
    event: ReactPointerEvent<Element>,
    clip: VideoEditorClip,
    mode: TransformMode,
  ) => void;
  onFramePrevious: () => void;
  onFrameNext: () => void;
  onTogglePlayback: () => void;
  onSplit: () => void;
  onSeek: (time: number) => void;
  onResetView: () => void;
}) {
  const settings = project.settings;
  return (
    <section className="ov-program">
      <div className="ov-monitor-head">
        <span>画面预览</span>
        <em>{settings.width} × {settings.height}</em>
        <em>{settings.fps} FPS</em>
        <i className={engineReady ? "online" : ""} title={engineError}>
          {engineReady ? "OpenVideo 已就绪" : sourceState === "loading"
            ? "正在载入"
            : "兼容预览"}
        </i>
      </div>
      <div
        ref={monitorRef}
        className="ov-monitor"
        style={{ aspectRatio: `${settings.width} / ${settings.height}` }}
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
              onSourceLoaded(video);
            }
            if (!usesNativeSequencePreview || !nativePreviewClip) return;
            video.playbackRate = nativePreviewClip.speed || 1;
            const mediaTime = Math.min(
              Number(nativePreviewClip.trimEnd) - .001,
              Number(nativePreviewClip.trimStart) +
                Math.max(0, time - nativePreviewClip.timelineStart) *
                  (nativePreviewClip.speed || 1),
            );
            if (Math.abs(video.currentTime - mediaTime) > .02) {
              video.currentTime = mediaTime;
            }
          }}
          onLoadedData={(event) => {
            const video = event.currentTarget;
            if (!usesNativeSequencePreview || nativePreviewAsset?.id === primaryVideoAssetId) {
              onCaptureThumbnail(video);
              onPrimeSourcePreview(video);
            }
            if (usesNativeSequencePreview && playing) {
              void video.play().catch(() => onSetPlaying(false));
            }
          }}
          onSeeked={(event) => {
            if (!sourceThumbnail) onCaptureThumbnail(event.currentTarget);
          }}
          onError={() => {
            if (usesNativeSequencePreview) {
              onSetEngineError(`片段“${nativePreviewAsset?.name || "视频"}”载入失败`);
              onSetPlaying(false);
              return;
            }
            onSourceFailed();
          }}
          onTimeUpdate={(event) => {
            if (engineReady && !preferFallbackPreview) return;
            const video = event.currentTarget;
            if (usesNativeSequencePreview && nativePreviewClip) {
              const speed = nativePreviewClip.speed || 1;
              const projectTime = nativePreviewClip.timelineStart +
                (video.currentTime - Number(nativePreviewClip.trimStart)) / speed;
              const clipEnd = nativePreviewClip.timelineStart +
                editorClipDuration(nativePreviewClip);
              onSetTime(Math.min(
                clipEnd,
                Math.max(nativePreviewClip.timelineStart, projectTime),
              ));
              if (
                playing &&
                video.currentTime >= Number(nativePreviewClip.trimEnd) - 1 / settings.fps
              ) {
                onContinueSequence(nativePreviewClip.id);
              }
              return;
            }
            onSetTime(video.currentTime);
          }}
          onEnded={() => {
            if (usesNativeSequencePreview && nativePreviewClip) {
              onContinueSequence(nativePreviewClip.id);
            } else {
              onSetPlaying(false);
            }
          }}
        />
        <ImagePreviewLayer
          clips={activeImageClips}
          assets={assets}
          selectedId={selectedId}
          project={project}
          onBeginTransform={onBeginTransform}
        />
        <TextPreviewLayer
          clips={activeTextClips}
          selectedId={selectedId}
          project={project}
          onBeginTransform={onBeginTransform}
        />
        <MonitorState state={sourceState} />
        <div className="ov-safe-frame" />
        <output>
          {formatEditorTimecode(time)} <i>/</i> {formatEditorTimecode(duration)}
        </output>
      </div>
      <div className="ov-transport">
        <button title="上一帧" onClick={onFramePrevious}>‹</button>
        <button className="play" onClick={onTogglePlayback}>
          <IconSymbol name={playing ? "pause" : "play"} />
        </button>
        <button onClick={onSplit}><IconSymbol name="scissors" /></button>
        <button title="下一帧" onClick={onFrameNext}>›</button>
        <input
          value={time}
          type="range"
          min="0"
          max={Math.max(.01, duration)}
          step=".01"
          onChange={(event) => onSeek(Number(event.target.value))}
        />
        <span>
          <b>{formatEditorTimecode(time)}</b>
          <i>/</i>
          {formatEditorTimecode(duration)}
        </span>
        <button className="ov-fit" onClick={onResetView}>
          适应 <IconSymbol name="maximize" />
        </button>
      </div>
    </section>
  );
}

function ImagePreviewLayer({
  clips,
  assets,
  selectedId,
  project,
  onBeginTransform,
}: {
  clips: VideoEditorClip[];
  assets: VideoEditorAsset[];
  selectedId: string;
  project: VideoEditorProject;
  onBeginTransform: (
    event: ReactPointerEvent<Element>,
    clip: VideoEditorClip,
    mode: TransformMode,
  ) => void;
}) {
  if (!clips.length) return null;
  return (
    <div className="ov-image-preview-layer">
      {clips.map((clip) => {
        const asset = assets.find((item) => item.id === clip.assetId);
        const source = String(clip.src || asset?.sourceUrl || "");
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
            onPointerDown={(event) => onBeginTransform(event, clip, "move")}
          >
            <img src={source} alt="" draggable={false} />
            {clip.id === selectedId && (
              <TransformHandles clip={clip} onBeginTransform={onBeginTransform} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function TextPreviewLayer({
  clips,
  selectedId,
  project,
  onBeginTransform,
}: {
  clips: VideoEditorClip[];
  selectedId: string;
  project: VideoEditorProject;
  onBeginTransform: (
    event: ReactPointerEvent<Element>,
    clip: VideoEditorClip,
    mode: TransformMode,
  ) => void;
}) {
  if (!clips.length) return null;
  return (
    <div className="ov-text-preview-layer">
      {clips.map((clip) => {
        const transform = constrainTransformToCanvas(
          clip.transform,
          project.settings.width,
          project.settings.height,
        );
        const style = clip.style || {};
        const stroke = style.stroke && typeof style.stroke === "object"
          ? style.stroke as Record<string, unknown>
          : {};
        return (
          <div
            key={clip.id}
            className={`ov-text-preview-item${clip.id === selectedId ? " selected" : ""}`}
            style={{
              left: `${(Number(transform.x) || 0) / project.settings.width * 100}%`,
              top: `${(Number(transform.y) || 0) / project.settings.height * 100}%`,
              width: `${(Number(transform.width) || project.settings.width) / project.settings.width * 100}%`,
              height: `${(Number(transform.height) || 1) / project.settings.height * 100}%`,
              color: String(style.color || "#fff"),
              background: "transparent",
              fontFamily: String(style.fontFamily || "PingFang SC"),
              fontSize: `clamp(12px, ${(Number(style.fontSize) || 64) / project.settings.height * 100}cqh, 96px)`,
              fontWeight: Number(style.fontWeight) || 700,
              textAlign: String(style.align || "center") as "left" | "center" | "right",
              opacity: Number(transform.opacity ?? 1),
              transform: `rotate(${Number(transform.angle) || 0}deg)`,
              WebkitTextStroke: stroke.width
                ? `${Math.max(1, Number(stroke.width) / project.settings.height * 100)}cqh ${String(stroke.color || "#111")}`
                : undefined,
            }}
            onPointerDown={(event) => onBeginTransform(event, clip, "move")}
          >
            <span className="ov-text-preview-content">{clip.text}</span>
            {clip.id === selectedId && (
              <TransformHandles
                clip={clip}
                resizeTitle="拖动缩放文字"
                onBeginTransform={onBeginTransform}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function TransformHandles({
  clip,
  resizeTitle = "拖动缩放",
  onBeginTransform,
}: {
  clip: VideoEditorClip;
  resizeTitle?: string;
  onBeginTransform: (
    event: ReactPointerEvent<Element>,
    clip: VideoEditorClip,
    mode: TransformMode,
  ) => void;
}) {
  return (
    <>
      <span
        className="ov-transform-rotate-handle"
        title="拖动旋转"
        onPointerDown={(event) => onBeginTransform(event, clip, "rotate")}
      />
      <span
        className="ov-transform-resize-handle"
        title={resizeTitle}
        onPointerDown={(event) => onBeginTransform(event, clip, "resize")}
      />
    </>
  );
}

function MonitorState({ state }: { state: SourceState }) {
  if (state === "loading") {
    return <div className="ov-monitor-state">正在读取视频…</div>;
  }
  if (state === "error") {
    return (
      <div className="ov-monitor-state is-error">
        <IconSymbol name="film" />
        <strong>视频载入失败</strong>
        <span>源文件可能已移动或格式不受支持</span>
      </div>
    );
  }
  if (state === "empty") {
    return (
      <div className="ov-monitor-state">
        <IconSymbol name="film" />
        <strong>空白剪辑工程</strong>
        <span>从左侧素材面板导入视频开始剪辑</span>
      </div>
    );
  }
  return null;
}
