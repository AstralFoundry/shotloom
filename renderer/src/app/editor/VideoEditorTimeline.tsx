import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import { editorClipDuration } from "../../utils/videoEditorProject.mjs";
import { IconSymbol } from "../components/IconSymbol";
import { trackMeta } from "./videoEditorCatalog";
import { Ruler, VideoFilmstripThumbnail } from "./VideoEditorWorkspaceParts";
import type { VideoEditorAsset, VideoEditorClip, VideoEditorTrack } from "./videoEditorTypes";

export function VideoEditorTimeline({
  timelineRef,
  duration,
  zoom,
  fps,
  time,
  tracks,
  assets,
  selectedId,
  viewport,
  runtimeMediaUrls,
  primaryVideoAssetId,
  playbackUrl,
  sourceThumbnail,
  onSplit,
  onDuplicate,
  onDelete,
  onZoomChange,
  onViewportChange,
  onSeek,
  onToggleTrack,
  onClipPointerDown,
}: {
  timelineRef: RefObject<HTMLDivElement | null>;
  duration: number;
  zoom: number;
  fps: number;
  time: number;
  tracks: VideoEditorTrack[];
  assets: VideoEditorAsset[];
  selectedId: string;
  viewport: { left: number; width: number };
  runtimeMediaUrls: Record<string, string>;
  primaryVideoAssetId?: string;
  playbackUrl: string;
  sourceThumbnail: string;
  onSplit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onZoomChange: (zoom: number) => void;
  onViewportChange: (viewport: { left: number; width: number }) => void;
  onSeek: (time: number) => void;
  onToggleTrack: (trackId: string, field: "muted" | "locked", value: boolean) => void;
  onClipPointerDown: (event: ReactPointerEvent<HTMLButtonElement>, clip: VideoEditorClip) => void;
}) {
  const maximumZoom = Math.max(180, fps * 88);
  const zoomSliderValue = Math.log(zoom / 24) / Math.log(maximumZoom / 24) * 1000;
  return (
    <footer className="ov-timeline">
      <div className="ov-timeline-toolbar">
        <div className="ov-edit-buttons">
          <button title="切分片段" aria-label="切分片段" onClick={onSplit}><IconSymbol name="scissors" />切分</button>
          <button title="复制片段" aria-label="复制片段" onClick={onDuplicate}><IconSymbol name="copy" />复制</button>
          <button title="删除片段" aria-label="删除片段" onClick={onDelete}><IconSymbol name="trash" />删除</button>
        </div>
        <div className="ov-sequence-title">
          <strong>主场景</strong><span>主时间线</span><em>{formatTime(duration)}</em>
        </div>
        <label>
          缩放
          <input
            value={zoomSliderValue}
            type="range"
            min="0"
            max="1000"
            step="1"
            onChange={(event) => {
              const ratio = Number(event.target.value) / 1000;
              onZoomChange(24 * Math.pow(maximumZoom / 24, ratio));
            }}
          />
          <output>{Math.round(zoom)}px/s</output>
        </label>
      </div>
      <div
        ref={timelineRef}
        className="ov-timeline-scroll"
        onScroll={(event) => onViewportChange({
          left: event.currentTarget.scrollLeft,
          width: event.currentTarget.clientWidth,
        })}
      >
        <div
          className="ov-timeline-content"
          style={{ width: Math.max(1100, 112 + duration * zoom + 24) }}
          onPointerDown={(event) => {
            if ((event.target as Element).closest(".ov-clip,.ov-track-head")) return;
            const rect = event.currentTarget.getBoundingClientRect();
            onSeek(Math.max(0, Math.min(duration, (event.clientX - rect.left - 112) / zoom)));
          }}
        >
          <Ruler duration={duration} zoom={zoom} />
          {tracks.map((track) => (
            <div className={`ov-track type-${track.type}${track.hidden ? " hidden" : ""}`} key={track.id}>
              <div className="ov-track-head">
                <b>{trackMeta[track.type]?.code || "?"}</b>
                <span>{track.name}</span>
                <button className={track.muted ? "active" : ""} onClick={() => onToggleTrack(track.id, "muted", !track.muted)}>M</button>
                <button className={track.locked ? "active" : ""} onClick={() => onToggleTrack(track.id, "locked", !track.locked)}>
                  <IconSymbol name="lock" />
                </button>
              </div>
              <div className="ov-track-lane">
                {track.clips.map((clip) => {
                  const clipAsset = assets.find((asset) => asset.id === clip.assetId);
                  const mediaUrl = String(clip.src || clipAsset?.sourceUrl || "");
                  const hasMedia = Boolean(mediaUrl && ["video", "image"].includes(clip.type));
                  const displayWidth = Math.max(12, editorClipDuration(clip) * zoom);
                  return (
                    <button
                      key={clip.id}
                      className={`ov-clip clip-${clip.type}${clip.id === selectedId ? " selected" : ""}${hasMedia ? " has-media has-thumbnail" : ""}`}
                      style={{ left: clip.timelineStart * zoom, width: displayWidth }}
                      onPointerDown={(event) => onClipPointerDown(event, clip)}
                      onDoubleClick={() => onSeek(clipFocusTime(clip))}
                    >
                      {hasMedia && (
                        <span className="ov-clip-media" aria-hidden="true">
                          {clip.type === "image" && <img src={mediaUrl} />}
                          {clip.type === "video" && (
                            <VideoFilmstripThumbnail
                              src={(clipAsset?.id ? runtimeMediaUrls[clipAsset.id] : "") || (clipAsset?.id === primaryVideoAssetId ? playbackUrl : mediaUrl)}
                              start={Math.max(0, Number(clip.trimStart) || 0)}
                              end={Math.max(0, Number(clip.trimEnd) || 0)}
                              displayWidth={displayWidth}
                              clipLeft={clip.timelineStart * zoom}
                              viewportLeft={Math.max(0, viewport.left - 112)}
                              viewportWidth={Math.max(0, viewport.width - 112)}
                              zoom={zoom}
                              fps={fps}
                              speed={Number(clip.speed) || 1}
                              fallback={clipAsset?.id === primaryVideoAssetId ? sourceThumbnail : ""}
                            />
                          )}
                        </span>
                      )}
                      <i>{clipLabel(clip, clipAsset)}</i>
                      <small>{formatTime(editorClipDuration(clip))}</small>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <div className="ov-playhead" style={{ left: 112 + time * zoom }}><i /></div>
        </div>
      </div>
    </footer>
  );
}

function clipFocusTime(clip: VideoEditorClip) {
  return clip.timelineStart + Math.min(.1, editorClipDuration(clip) / 2);
}

function clipLabel(clip: VideoEditorClip, asset?: VideoEditorAsset) {
  if (clip.type === "text") return clip.text;
  if (clip.type === "transition") return String(clip.transitionKey || "");
  if (clip.type === "effect") return String(clip.effectKey || "");
  if (clip.type === "image") return "贴图";
  return asset?.name || clip.type;
}

function formatTime(seconds: number) {
  const value = Math.max(0, Number(seconds) || 0);
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${(value % 60).toFixed(1).padStart(4, "0")}`;
}
