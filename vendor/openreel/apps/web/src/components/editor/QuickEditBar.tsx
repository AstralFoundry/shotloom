import { editorMessage } from "../../shotloom-mode";
import React, { useRef, useState } from "react";
import { Captions, Download, Scissors, Volume2, Proportions, Loader2 } from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { getMediaItemCapabilities } from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useInspectorNavigationStore } from "../../stores/inspector-navigation-store";
import { toast } from "../../stores/notification-store";
import { splitTimelineItem, trimTimelineItemToPlayhead } from "../../utils/timeline-item-actions";
import { canQuickEditAtPlayhead } from "./quick-edit";

interface QuickEditBarProps {
  clipId: string;
  onCleanAudio: () => Promise<void>;
  isCleaningAudio: boolean;
}

export const QuickEditBar: React.FC<QuickEditBarProps> = ({
  clipId, onCleanAudio, isCleaningAudio,
}) => {
  const project = useProjectStore((state) => state.project);
  const track = project.timeline.tracks.find((candidate) => candidate.clips.some((clip) => clip.id === clipId));
  const clip = track?.clips.find((candidate) => candidate.id === clipId);
  const media = project.mediaLibrary.items.find((candidate) => candidate.id === clip?.mediaId);
  const capabilities = getMediaItemCapabilities(media);
  const canEditHere = useTimelineStore((state) => Boolean(clip &&
    canQuickEditAtPlayhead(clip, state.playheadPosition, project.settings.frameRate)));
  const playbackLocked = useTimelineStore((state) => Boolean(state.playbackLockedReason));
  const exporting = useUIStore((state) => state.exportState.isExporting);
  const applyingEffect = useUIStore((state) => state.effectApplicationClipId !== null);
  const [busy, setBusy] = useState(false);
  const editingRef = useRef(false);

  if (!clip || !track) return null;

  const disabled = track.locked || busy || exporting || playbackLocked || applyingEffect;
  const unavailableSource = media?.isPlaceholder || (!media?.blob && !media?.fileHandle);
  const openSection = (sectionId: string) => {
    useInspectorNavigationStore.getState().requestSection(sectionId, clipId);
  };
  const runEdit = async (operation: "split" | "trimStart" | "trimEnd") => {
    const store = useProjectStore.getState();
    const selectedIds = useUIStore.getState().getSelectedClipIds();
    const currentTrack = store.project.timeline.tracks.find((candidate) => candidate.clips.some((item) => item.id === clipId));
    const currentClip = currentTrack?.clips.find((item) => item.id === clipId);
    const timeline = useTimelineStore.getState();
    if (editingRef.current || !currentClip || currentTrack?.locked ||
      selectedIds.length !== 1 || selectedIds[0] !== clipId ||
      useUIStore.getState().exportState.isExporting ||
      useUIStore.getState().effectApplicationClipId !== null || timeline.playbackLockedReason ||
      !canQuickEditAtPlayhead(currentClip, timeline.playheadPosition, store.project.settings.frameRate)) return;
    const projectId = store.project.id;
    const time = timeline.playheadPosition;
    const label = editorMessage(({ split: "editor.quickEdit.split", trimStart: "editor.quickEdit.trimStart", trimEnd: "editor.quickEdit.trimEnd" } as const)[operation]);
    editingRef.current = true;
    setBusy(true);
    timeline.pause();
    store.beginHistoryGroup(label);
    try {
      const success = operation === "split"
        ? await splitTimelineItem(store, clipId, time)
        : await trimTimelineItemToPlayhead(store, clipId, time, operation === "trimStart");
      if (!success) throw new Error(editorMessage("editor.quickEdit.cannotApply"));
    } catch (error) {
      toast.error(editorMessage("editor.quickEdit.failed", { operation: label }), error instanceof Error ? error.message : editorMessage("editor.quickEdit.retry"));
    } finally {
      if (useProjectStore.getState().project.id === projectId) store.endHistoryGroup();
      editingRef.current = false;
      setBusy(false);
    }
  };

  return (
    <section aria-label={editorMessage("editor.quickEdit.heading")} className="mb-5 rounded-lg border border-accent/25 bg-accent/5 p-3">
      <h3 className="text-sm font-semibold text-fg">{editorMessage("editor.quickEdit.heading")}</h3>
      <p className="mt-1 mb-3 text-xs leading-relaxed text-fg-3">
        {track.locked ? editorMessage("editor.quickEdit.unlock") : canEditHere
          ? editorMessage("editor.quickEdit.ready")
          : editorMessage("editor.quickEdit.movePlayhead")}
      </p>
      <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 145px), 1fr))" }}>
        <Button label={editorMessage("editor.quickEdit.splitHere")} icon={<Scissors size={14} aria-hidden />} variant="secondary"
          onClick={() => void runEdit("split")} isDisabled={disabled || !canEditHere}
          className="min-h-11 w-full justify-center text-xs" />
        <Button label={editorMessage("editor.quickEdit.trimStartButton")} title={editorMessage("editor.quickEdit.trimStartHint")} variant="secondary"
          onClick={() => void runEdit("trimStart")} isDisabled={disabled || !canEditHere}
          className="min-h-11 w-full justify-center text-xs" />
        <Button label={editorMessage("editor.quickEdit.trimEndButton")} title={editorMessage("editor.quickEdit.trimEndHint")} variant="secondary"
          onClick={() => void runEdit("trimEnd")} isDisabled={disabled || !canEditHere}
          className="min-h-11 w-full justify-center text-xs" />
        {capabilities.audio && <Button label={editorMessage("editor.quickEdit.captions")} icon={<Captions size={14} aria-hidden />} variant="secondary"
          onClick={() => openSection("auto-captions")} isDisabled={disabled || unavailableSource}
          className="min-h-11 w-full justify-center text-xs" />}
        {capabilities.audio && <Button label={isCleaningAudio ? editorMessage("editor.quickEdit.cleaning") : editorMessage("editor.quickEdit.cleanAudio")}
          icon={isCleaningAudio ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Volume2 size={14} aria-hidden />}
          variant="secondary" onClick={() => { if (!disabled) void onCleanAudio(); }}
          isDisabled={disabled || isCleaningAudio || unavailableSource}
          className="min-h-11 w-full justify-center text-xs" />}
        {media?.type === "video" && <Button label={editorMessage("editor.quickEdit.reframe")} icon={<Proportions size={14} aria-hidden />} variant="secondary"
          onClick={() => openSection("auto-reframe")} isDisabled={disabled || unavailableSource}
          className="min-h-11 w-full justify-center text-xs" />}
        <Button label={editorMessage("editor.quickEdit.export")} icon={<Download size={14} aria-hidden />} variant="primary"
          onClick={() => useUIStore.getState().openModal("export")} isDisabled={exporting || playbackLocked}
          className="min-h-11 w-full justify-center text-xs" />
      </div>
      {busy && <p role="status" className="mt-2 text-xs text-fg-3">{editorMessage("editor.quickEdit.applying")}</p>}
    </section>
  );
};
