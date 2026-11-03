import React, { useState, useRef, useEffect } from "react";
import { Eye, EyeOff, Volume2, VolumeX, Lock, MoreHorizontal, Trash2, Pencil, AlignLeft, Link2, Unlink } from "@/icons/lucide-compat";
import {
  ToolcraftContextMenu as ContextMenu,
  ToolcraftDropdownMenu as DropdownMenu,
  type ToolcraftContextMenuOption as ContextMenuOption,
} from "@openreel/ui";
import { ToolcraftTextInputControl } from "@openreel/ui";
import type { Track } from "@openreel/core";
import {
  getTrackItems,
  trackHasAudioItems,
  trackHasVisualItems,
} from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useCompactEditor } from "../../../hooks/useCompactEditor";
import { editorMessage, useShotloomPresentation } from "../../../shotloom-mode";
import { getTrackInfo } from "./utils";

interface TrackHeaderProps {
  track: Track;
  index: number;
  onDragStart: (e: React.DragEvent, trackId: string) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, targetTrackId: string) => void;
  onDragEnd: () => void;
  keyframeCount?: number;
}

export const TrackHeader: React.FC<TrackHeaderProps> = React.memo(function TrackHeader({
  track,
  index,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}) {
  const compact = useCompactEditor();
  const canvas = useShotloomPresentation() === "canvas";
  const {
    lockTrack,
    hideTrack,
    muteTrack,
    soloTrack,
    removeTrack,
    renameTrack,
    consolidateTrack,
    groupTracks,
    project,
  } = useProjectStore();
  const trackHeight = useTimelineStore((state) =>
    state.trackHeights[track.id] ?? state.trackHeight,
  );

  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(track.name);
  const inputRef = useRef<HTMLInputElement>(null);

  const trackInfo = getTrackInfo(track, index);
  const isVisual = trackHasVisualItems(project, track.id);
  const isAudio = trackHasAudioItems(project, track.id);
  const hasSoloedAudioTrack = project.timeline.tracks.some(
    (candidate) =>
      trackHasAudioItems(project, candidate.id) && candidate.solo,
  );
  const effectivelyMuted =
    isAudio && (track.muted || (hasSoloedAudioTrack && !track.solo));
  const groupCandidates = project.timeline.tracks.filter(
    (candidate) =>
      candidate.id !== track.id &&
      candidate.groupId !== track.groupId,
  );

  const handleRemoveTrack = async () => {
    await removeTrack(track.id);
  };

  const handleRemoveGaps = async () => {
    await consolidateTrack(track.id);
  };

  // Only enable editorMessage("editor.timeline.track.removeGaps") if there's actually a gap on this track.
  const hasGaps = React.useMemo(() => {
    const sorted = getTrackItems(project, track.id);
    if (sorted.length === 0) return false;
    if (sorted[0].startTime > 0.0001) return true;
    for (let i = 1; i < sorted.length; i++) {
      const prevEnd = sorted[i - 1].startTime + sorted[i - 1].duration;
      if (sorted[i].startTime - prevEnd > 0.0001) return true;
    }
    return false;
  }, [project, track.id]);

  const startRename = () => {
    setRenameValue(track.name);
    setIsRenaming(true);
  };

  const commitRename = () => {
    renameTrack(track.id, renameValue || track.name);
    setIsRenaming(false);
  };

  const cancelRename = () => {
    setRenameValue(track.name);
    setIsRenaming(false);
  };

  useEffect(() => {
    if (isRenaming) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isRenaming]);

  const menuItems: ContextMenuOption[] = [
    {
      label: editorMessage("editor.timeline.track.rename"),
      icon: <Pencil size={14} aria-hidden />,
      onClick: startRename,
    },
    {
      label: editorMessage("editor.timeline.track.removeGaps"),
      icon: <AlignLeft size={14} aria-hidden />,
      isDisabled: !hasGaps,
      onClick: handleRemoveGaps,
    },
    // 带画面的轨道头不再放独奏键，这里补回唯一的取消入口，否则被 Agent 独奏过的
    // 视频轨会让其他轨道一直停在 effectivelyMuted 的暗态而无处解除。
    ...(track.solo
      ? [
          {
            label: editorMessage("editor.timeline.track.clearSoloMenu"),
            icon: <Volume2 size={14} aria-hidden />,
            onClick: () => soloTrack(track.id, false),
          } satisfies ContextMenuOption,
        ]
      : []),
    ...(track.groupId
      ? [
          {
            label: editorMessage("editor.timeline.track.ungroup"),
            icon: <Unlink size={14} aria-hidden />,
            onClick: () => groupTracks(track.id),
          } satisfies ContextMenuOption,
        ]
      : []),
    ...(groupCandidates.length > 0
      ? [
          {
            type: "section" as const,
            title: editorMessage("editor.timeline.track.groupHeading"),
            items: groupCandidates.map((candidate) => ({
              label: editorMessage("editor.timeline.track.groupWith", { name: candidate.name }),
              icon: <Link2 size={14} aria-hidden />,
              onClick: () => groupTracks(track.id, candidate.id),
            })),
          } satisfies ContextMenuOption,
        ]
      : []),
    { type: "divider" },
    {
      label: editorMessage("editor.timeline.track.deleteMenu"),
      icon: <Trash2 size={14} aria-hidden />,
      onClick: handleRemoveTrack,
    },
  ];

  /* 画布模式的卡片在选中前后必须一模一样：轨道头只留一枚类型图标，
     名称、重命名、眼睛/喇叭/锁/删除那一整行都属于展开的剪辑台。 */
  if (canvas) {
    return (
      <div
        data-timeline-track-header
        data-canvas-track-header
        style={{ height: trackHeight }}
        className={`relative flex items-center justify-center border-b border-border px-1 ${
          track.hidden || effectivelyMuted ? "opacity-60" : ""
        } ${track.locked ? "bg-bg-2/50" : "bg-bg-1"}`}
      >
        <trackInfo.icon size={14} strokeWidth={1.7} aria-hidden className="shrink-0 text-fg-3" />
      </div>
    );
  }

  return (
    <ContextMenu items={menuItems} menuWidth={180} size="sm">
      <div
        data-timeline-track-header
        draggable={!compact && !isRenaming}
        onDragStart={(e) => onDragStart(e, track.id)}
        onDragOver={onDragOver}
        onDrop={(e) => onDrop(e, track.id)}
        onDragEnd={onDragEnd}
        style={{ height: trackHeight }}
        className={`border-b border-border flex flex-col justify-center gap-[3px] px-3 py-1.5 relative group transition-colors cursor-grab active:cursor-grabbing ${
          track.hidden || effectivelyMuted ? "opacity-60" : ""
        } ${
          track.locked ? "bg-bg-2/50" : "bg-bg-1"
        }`}
      >
          <div className="flex min-w-0 items-center gap-1.5">
            {!compact && (
              <trackInfo.icon
                size={14}
                strokeWidth={1.7}
                aria-hidden
                className="shrink-0 text-fg-3"
              />
            )}
            {isRenaming ? (
              <ToolcraftTextInputControl
                ref={inputRef}
                label={editorMessage("editor.timeline.track.name")}
                isLabelHidden
                size="sm"
                width="100%"
                value={renameValue}
                onChange={setRenameValue}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") cancelRename();
                  e.stopPropagation();
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span
                data-shotloom-user-content={track.name ? "" : undefined}
                className="block truncate text-[13px] font-medium tracking-[-0.4px] text-fg cursor-grab active:cursor-grabbing"
                onDoubleClick={startRename}
              >
                {track.name || trackInfo.label}
              </span>
            )}
          </div>

          {compact && <DropdownMenu
            menuWidth={220} placement="end" alignment="start" size="lg"
            button={{ label: editorMessage("editor.timeline.track.options", { name: track.name || trackInfo.label }), isIconOnly: true, variant: "ghost", icon: <MoreHorizontal size={18} aria-hidden /> }}
            items={[
              ...(isVisual ? [{ label: track.hidden ? editorMessage("editor.timeline.track.show") : editorMessage("editor.timeline.track.hide"), onClick: () => hideTrack(track.id, !track.hidden) }] : []),
              ...(isAudio ? [
                { label: track.muted ? editorMessage("editor.timeline.track.unmute") : editorMessage("editor.timeline.track.mute"), onClick: () => muteTrack(track.id, !track.muted) },
                { label: track.solo ? editorMessage("editor.timeline.track.clearSolo") : editorMessage("editor.timeline.track.solo"), onClick: () => soloTrack(track.id, !track.solo) },
              ] : []),
              { label: track.locked ? editorMessage("editor.timeline.track.unlockTrack") : editorMessage("editor.timeline.track.lockTrack"), onClick: () => lockTrack(track.id, !track.locked) },
              { type: "divider" }, ...menuItems,
            ]}
          />}
          {/* 参考实现把轨道控件放在名称下方的第二行：纯图标、铺满整个头部宽度。 */}
          <div
            hidden={compact}
            className="flex w-full min-w-0 items-center justify-between gap-2 pr-1 shrink-0"
          >
            {track.groupId && (
              <Link2
                size={13}
                className="text-brand-accent"
                aria-label={editorMessage("editor.timeline.track.grouped")}
              />
            )}
            {isVisual && (
              <button
                type="button"
                aria-label={track.hidden ? editorMessage("editor.timeline.track.show") : editorMessage("editor.timeline.track.hide")}
                className="text-fg-muted hover:text-fg-2 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  hideTrack(track.id, !track.hidden);
                }}
              >
                {track.hidden ? (
                  <EyeOff size={15} strokeWidth={1.7} aria-hidden />
                ) : (
                  <Eye size={15} strokeWidth={1.7} aria-hidden />
                )}
              </button>
            )}
            {isAudio && (
              <button
                type="button"
                aria-label={track.muted ? editorMessage("editor.timeline.track.unmuteNamed", { name: track.name }) : editorMessage("editor.timeline.track.muteNamed", { name: track.name })}
                aria-pressed={track.muted}
                title={track.muted ? editorMessage("editor.timeline.track.unmute") : editorMessage("editor.timeline.track.mute")}
                className={`transition-colors ${
                  track.muted ? "text-destructive" : "text-fg-muted hover:text-fg-2"
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  muteTrack(track.id, !track.muted);
                }}
              >
                {track.muted ? (
                  <VolumeX size={15} strokeWidth={1.7} aria-hidden />
                ) : (
                  <Volume2 size={15} strokeWidth={1.7} aria-hidden />
                )}
              </button>
            )}
            {/* 参考实现里带音频的视频轨只有 眼睛/喇叭/锁/删除 四枚，独奏键属于纯音频轨。 */}
            {isAudio && !isVisual && (
              <button
                type="button"
                aria-label={track.solo ? editorMessage("editor.timeline.track.clearSoloNamed", { name: track.name }) : editorMessage("editor.timeline.track.soloNamed", { name: track.name })}
                aria-pressed={track.solo}
                title={track.solo ? editorMessage("editor.timeline.track.clearSolo") : editorMessage("editor.timeline.track.solo")}
                className={`flex h-[18px] min-w-[18px] items-center justify-center rounded px-1 text-[9px] font-black transition-colors ${
                  track.solo
                    ? "bg-status-warning text-black"
                    : "text-fg-muted hover:bg-hover hover:text-fg-2"
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  soloTrack(track.id, !track.solo);
                }}
              >
                S
              </button>
            )}
            <button
              type="button"
              aria-label={track.locked ? editorMessage("editor.timeline.track.unlock") : editorMessage("editor.timeline.track.lock")}
              className={`transition-colors ${
                track.locked ? "text-fg-2" : "text-fg-muted hover:text-fg-2"
              }`}
              onClick={(e) => {
                e.stopPropagation();
                lockTrack(track.id, !track.locked);
              }}
            >
              <Lock size={13} strokeWidth={1.8} aria-hidden />
            </button>
            <button
              type="button"
              aria-label={editorMessage("editor.timeline.track.deleteNamed", { name: track.name || trackInfo.label })}
              title={editorMessage("editor.timeline.track.deleteHint")}
              className="text-fg-muted hover:text-destructive transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                void handleRemoveTrack();
              }}
            >
              <Trash2 size={13} strokeWidth={1.8} aria-hidden />
            </button>
          </div>
      </div>
    </ContextMenu>
  );
});
