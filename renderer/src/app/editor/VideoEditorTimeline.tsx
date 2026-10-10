import { useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { editorClipDuration } from "../../utils/videoEditorProject.mjs";
import { IconSymbol } from "../components/IconSymbol";
import { EDITOR_ASSET_DRAG_TYPE, trackMeta } from "./videoEditorCatalog";
import { formatEditorTime } from "./videoEditorFormat";
import { TRACK_HEAD_WIDTH, VideoEditorRuler, VideoFilmstripThumbnail } from "./VideoEditorTimelineMedia";
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
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onAddSubtitle,
  onZoomChange,
  onViewportChange,
  onSeek,
  onToggleTrack,
  onDeleteTrack,
  onClipPointerDown,
  onClipTrimPointerDown,
  onScrubPointerDown,
  onAddTrack,
  onAssetDrop,
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
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onAddSubtitle: () => void;
  onZoomChange: (zoom: number) => void;
  onViewportChange: (viewport: { left: number; width: number }) => void;
  onSeek: (time: number) => void;
  onToggleTrack: (trackId: string, field: "muted" | "locked", value: boolean) => void;
  onDeleteTrack: (trackId: string) => void;
  onClipPointerDown: (event: ReactPointerEvent<HTMLButtonElement>, clip: VideoEditorClip) => void;
  onClipTrimPointerDown?: (
    event: ReactPointerEvent<HTMLSpanElement>,
    clip: VideoEditorClip,
    edge: "start" | "end",
  ) => void;
  onScrubPointerDown?: (
    event: ReactPointerEvent<HTMLDivElement>,
    originLeft: number,
  ) => void;
  onAddTrack: (kind: "video" | "audio" | "text") => void;
  onAssetDrop?: (assetId: string, timeSec: number) => void;
}) {
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const maximumZoom = Math.max(180, fps * 88);
  const zoomSliderValue = Math.log(zoom / 24) / Math.log(maximumZoom / 24) * 1000;
  return (
    <footer
      className={`ov-timeline${dragOver ? " is-drag-over" : ""}`}
      // 落点覆盖整条时间线（含工具栏与轨道下方空白），不再依赖内容区的高度或布局。
      onDragOver={(event) => {
        if (!onAssetDrop) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setDragOver(true);
      }}
      onDragLeave={(event) => {
        // 进入子元素也会触发 dragleave；只有真正离开时间线才取消高亮，否则会闪烁。
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setDragOver(false);
      }}
      onDrop={(event) => {
        setDragOver(false);
        if (!onAssetDrop) return;
        event.preventDefault();
        // 一律回调：拖进来的东西不是素材时也要给出反馈，不能静默无事发生。
        const assetId = event.dataTransfer.getData(EDITOR_ASSET_DRAG_TYPE)
          || event.dataTransfer.getData("text/plain");
        const scroll = timelineRef.current;
        // 时间按滚动容器的真实位置换算，因此拖到工具栏或轨道下方空白都能得到合理落点。
        const originLeft = (scroll?.getBoundingClientRect().left || 0)
          - (scroll?.scrollLeft || 0)
          + TRACK_HEAD_WIDTH;
        const timeSec = Math.max(0, Math.min(duration, (event.clientX - originLeft) / zoom));
        onAssetDrop(assetId, timeSec);
      }}
    >
      <div className="ov-timeline-toolbar">
        <div className="ov-edit-buttons">
          <button title="撤销" aria-label="撤销" disabled={!canUndo} onClick={onUndo}><IconSymbol name="undo" /></button>
          <button title="重做" aria-label="重做" disabled={!canRedo} onClick={onRedo}><IconSymbol name="redo" /></button>
          <button title="切分片段" aria-label="切分片段" onClick={onSplit}><IconSymbol name="scissors" />切分</button>
          <button title="复制片段" aria-label="复制片段" onClick={onDuplicate}><IconSymbol name="copy" />复制</button>
          <button title="删除片段" aria-label="删除片段" onClick={onDelete}><IconSymbol name="trash" />删除</button>
          <span className="ov-timeline-divider" />
          <button title="添加字幕" onClick={onAddSubtitle}><IconSymbol name="text" />字幕</button>
          <button title="查看快捷键" onClick={() => setShowShortcuts((value) => !value)}><IconSymbol name="help" />快捷键</button>
        </div>
        <div className="ov-sequence-title">
          <strong>主场景</strong><span>主时间线</span><em>{formatEditorTime(duration)}</em>
        </div>
        <div className="ov-timeline-zoom" role="group" aria-label="时间线缩放" onPointerDown={(event) => event.stopPropagation()}>
          <button type="button" title="缩小" onClick={() => onZoomChange(Math.max(24, zoom / 1.25))}><IconSymbol name="search" /></button>
          <input
            aria-label="时间线缩放比例"
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
          <button type="button" title="放大" onClick={() => onZoomChange(Math.min(maximumZoom, zoom * 1.25))}><IconSymbol name="plus" /></button>
        </div>
      </div>
      {showShortcuts && <div className="ov-shortcuts-popover" role="dialog" aria-label="剪辑快捷键">
        <strong>剪辑快捷键</strong>
        <span>空格　播放 / 暂停</span>
        <span>⌘Z　撤销 · ⇧⌘Z　重做</span>
        <span>Delete　删除选中片段</span>
        <span>拖动片段　左右移动 · 拖到别的轨道或轨道区下方</span>
        <span>拖片段两端　裁剪入点 / 出点</span>
        <span>拖角手柄　调整画面大小 · 按住 Shift 等比</span>
        <button onClick={() => setShowShortcuts(false)}>关闭</button>
      </div>}
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
            onSeek(Math.max(0, Math.min(duration, (event.clientX - rect.left - TRACK_HEAD_WIDTH) / zoom)));
          }}
        >
          <VideoEditorRuler duration={duration} zoom={zoom} onScrubPointerDown={onScrubPointerDown} />
          {tracks.map((track) => (
            <div className={`ov-track type-${track.type}${track.hidden ? " hidden" : ""}`} key={track.id}>
              <div className="ov-track-head">
                <b>{trackMeta[track.type]?.code || "?"}</b>
                <span>{track.name}</span>
                <button className={track.muted ? "active" : ""} onClick={() => onToggleTrack(track.id, "muted", !track.muted)}>M</button>
                <button className={track.locked ? "active" : ""} onClick={() => onToggleTrack(track.id, "locked", !track.locked)}>
                  <IconSymbol name="lock" />
                </button>
                {!track.clips.length && (
                  <button
                    type="button"
                    className="ov-track-delete"
                    title="删除空轨道"
                    aria-label={`删除空轨道 ${track.name}`}
                    onClick={() => onDeleteTrack(track.id)}
                  >
                    <IconSymbol name="trash" />
                  </button>
                )}
              </div>
              <div className="ov-track-lane" data-track-id={track.id}>
                {track.clips.map((clip) => {
                  const clipAsset = assets.find((asset) => asset.id === clip.assetId);
                  const mediaUrl = String(clip.src || clipAsset?.sourceUrl || "");
                  const hasMedia = Boolean(mediaUrl && ["video", "image"].includes(clip.type));
                  const displayWidth = Math.max(12, editorClipDuration(clip) * zoom);
                  // 只有带源入出点的媒体片段可以裁；锁定的轨道或片段不给手柄。
                  const editable = (clip.type === "video" || clip.type === "audio")
                    && !track.locked && !clip.locked;
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
                      <small>{formatEditorTime(editorClipDuration(clip))}</small>
                      {onClipTrimPointerDown && editable && (
                        // 裁剪手柄目前只有指针路径，对辅助技术隐藏，避免播报一个没有键盘操作的控件。
                        <>
                          <span
                            className="ov-clip-trim is-start"
                            aria-hidden="true"
                            onPointerDown={(event) => {
                              event.stopPropagation();
                              onClipTrimPointerDown(event, clip, "start");
                            }}
                          />
                          <span
                            className="ov-clip-trim is-end"
                            aria-hidden="true"
                            onPointerDown={(event) => {
                              event.stopPropagation();
                              onClipTrimPointerDown(event, clip, "end");
                            }}
                          />
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <div className="ov-playhead" style={{ left: TRACK_HEAD_WIDTH + time * zoom }}><i /></div>
        </div>
        {/* 添加轨道入口放在滚动容器内：它若作为 footer 的 grid 子元素会抢走 1fr 行，
            把时间线滚动区挤进隐式行、高度塌陷。 */}
        <div className="ov-track-add" role="group" aria-label="添加轨道">
          <button type="button" title="添加视频轨道" onClick={() => onAddTrack("video")}>
            <IconSymbol name="plus" />视频轨道
          </button>
          <button type="button" title="添加音频轨道" onClick={() => onAddTrack("audio")}>
            <IconSymbol name="plus" />音频轨道
          </button>
          <button type="button" title="添加文字轨道" onClick={() => onAddTrack("text")}>
            <IconSymbol name="plus" />文字轨道
          </button>
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
