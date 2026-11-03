import { editorMessage, editorItemCount, getEditorLocale } from "../../../shotloom-mode";
import React, { useState, useEffect, useCallback } from "react";
import {
  History,
  Undo2,
  Redo2,
  Bookmark,
  BookmarkPlus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Type,
  Shapes,
  FileCode,
  Smile,
} from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftClickableCard as ClickableCard } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { ToolcraftTextInputControl } from "@openreel/ui";
import { useProjectStore } from "../../../stores/project-store";
import type { Action, HistorySnapshot } from "@openreel/core";

const historyActionKeys = {
  "clip/add": "editor.historyAction.clip.add",
  "clip/remove": "editor.historyAction.clip.remove",
  "clip/move": "editor.historyAction.clip.move",
  "clip/trim": "editor.historyAction.clip.trim",
  "clip/split": "editor.historyAction.clip.split",
  "clip/rippleDelete": "editor.historyAction.clip.rippleDelete",
  "clip/duplicate": "editor.historyAction.clip.duplicate",
  "clip/setBlendMode": "editor.historyAction.clip.setBlendMode",
  "clip/setBlendOpacity": "editor.historyAction.clip.setBlendOpacity",
  "clip/setEmphasisAnimation": "editor.historyAction.clip.setEmphasisAnimation",
  "clip/setColorGrading": "editor.historyAction.clip.setColorGrading",
  "track/duplicate": "editor.historyAction.track.duplicate",
  "track/remove": "editor.historyAction.track.remove",
  "track/rename": "editor.historyAction.track.rename",
  "effect/remove": "editor.historyAction.effect.remove",
  "effect/update": "editor.historyAction.effect.update",
  "effect/toggle": "editor.historyAction.effect.toggle",
  "effect/setStack": "editor.historyAction.effect.setStack",
  "transform/update": "editor.historyAction.transform.update",
  "keyframe/remove": "editor.historyAction.keyframe.remove",
  "keyframe/setAll": "editor.historyAction.keyframe.setAll",
  "transition/set": "editor.historyAction.transition.set",
  "transition/update": "editor.historyAction.transition.update",
  "transition/remove": "editor.historyAction.transition.remove",
  "audio/setVolume": "editor.historyAction.audio.setVolume",
  "audio/setFade": "editor.historyAction.audio.setFade",
  "audio/addEffect": "editor.historyAction.audio.addEffect",
  "audio/removeEffect": "editor.historyAction.audio.removeEffect",
  "audio/updateEffect": "editor.historyAction.audio.updateEffect",
  "audio/toggleEffect": "editor.historyAction.audio.toggleEffect",
  "subtitle/add": "editor.historyAction.subtitle.add",
  "subtitle/remove": "editor.historyAction.subtitle.remove",
  "marker/add": "editor.historyAction.marker.add",
  "marker/remove": "editor.historyAction.marker.remove",
  "marker/update": "editor.historyAction.marker.update",
  "project/rename": "editor.historyAction.project.rename",
  "project/updateSettings": "editor.historyAction.project.updateSettings",
  "project/setCanvasBackground": "editor.historyAction.project.setCanvasBackground",
  "project/registerGeneratedShader": "editor.historyAction.project.registerGeneratedShader",
  "project/removeGeneratedShader": "editor.historyAction.project.removeGeneratedShader",
  "media/import": "editor.historyAction.media.import",
  "media/delete": "editor.historyAction.media.delete",
  "clip/closeGapBefore": "editor.historyAction.clip.closeGapBefore",
  "track/consolidate": "editor.historyAction.track.consolidate",
  "track/restorePositions": "editor.historyAction.track.restorePositions"
} as const;

function historyActionDescription(action: Action, fallback: string): string {
  const params = action.params as Record<string, unknown>;
  switch (action.type) {
    case "track/add": return editorMessage("editor.historyAction.addTrack", { type: String(params.trackType ?? "") });
    case "effect/add": return editorMessage("editor.historyAction.addEffect", { type: String(params.effectType ?? "") });
    case "keyframe/add": return editorMessage("editor.historyAction.addKeyframe", { property: String(params.property ?? "") });
    case "transition/add": return editorMessage("editor.historyAction.addTransition", { type: String(params.transitionType ?? "") });
    default: return Object.hasOwn(historyActionKeys, action.type)
      ? editorMessage(historyActionKeys[action.type as keyof typeof historyActionKeys])
      : fallback;
  }
}

interface DisplayEntry {
  id: string;
  description: string;
  timestamp: number;
  isCurrent: boolean;
  isClipEntry: boolean;
  clipType?: "shape" | "text" | "svg" | "sticker";
  groupId?: string;
}

export const HistoryPanel: React.FC = () => {
  const { actionHistory, undo, redo, canUndo, canRedo, clipUndoStack, clipRedoStack } = useProjectStore();
  const [combinedHistory, setCombinedHistory] = useState<DisplayEntry[]>([]);
  const [snapshots, setSnapshots] = useState<HistorySnapshot[]>([]);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [newSnapshotName, setNewSnapshotName] = useState("");
  const [isCreatingSnapshot, setIsCreatingSnapshot] = useState(false);

  const getClipDescription = (type: "shape" | "text" | "svg" | "sticker"): string => {
    switch (type) {
      case "text": return editorMessage("editor.historyPanel.createText");
      case "shape": return editorMessage("editor.historyPanel.createShape");
      case "svg": return editorMessage("editor.historyPanel.importSvg");
      case "sticker": return editorMessage("editor.historyPanel.addSticker");
      default: return editorMessage("editor.historyPanel.createClip");
    }
  };

  useEffect(() => {
    const updateHistory = () => {
      const actionEntries = actionHistory.getDisplayHistory();
      setSnapshots(actionHistory.getSnapshots());

      const displayEntries: DisplayEntry[] = actionEntries.map((item, idx) => ({
        id: `action-${item.entry.action.id}-${idx}`,
        description: historyActionDescription(item.entry.action, item.entry.description),
        timestamp: item.entry.timestamp,
        isCurrent: item.isCurrent,
        isClipEntry: false,
        groupId: item.entry.groupId,
      }));

      clipUndoStack.forEach((entry, idx) => {
        displayEntries.push({
          id: `clip-${entry.clipId}-${idx}`,
          description: getClipDescription(entry.type),
          timestamp: Date.now() - (clipUndoStack.length - idx) * 1000,
          isCurrent: idx === clipUndoStack.length - 1 && clipRedoStack.length === 0,
          isClipEntry: true,
          clipType: entry.type,
        });
      });

      displayEntries.sort((a, b) => a.timestamp - b.timestamp);
      setCombinedHistory(displayEntries);
    };

    updateHistory();
    const unsubscribe = actionHistory.subscribe(updateHistory);
    return () => unsubscribe();
  }, [actionHistory, clipUndoStack, clipRedoStack]);

  const handleUndo = useCallback(async () => {
    if (canUndo()) {
      await undo();
    }
  }, [undo, canUndo]);

  const handleRedo = useCallback(async () => {
    if (canRedo()) {
      await redo();
    }
  }, [redo, canRedo]);

  const handleCreateSnapshot = useCallback(() => {
    if (newSnapshotName.trim()) {
      actionHistory.createSnapshot(newSnapshotName.trim());
      setNewSnapshotName("");
      setIsCreatingSnapshot(false);
    }
  }, [actionHistory, newSnapshotName]);

  const handleDeleteSnapshot = useCallback(
    (id: string) => {
      actionHistory.deleteSnapshot(id);
    },
    [actionHistory],
  );

  const formatTime = (timestamp: number): string => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString(getEditorLocale(), { hour: "2-digit", minute: "2-digit" });
  };

  const undoCount = actionHistory.getUndoStackSize() + clipUndoStack.length;
  const redoCount = actionHistory.getRedoStackSize() + clipRedoStack.length;

  const getClipIcon = (type?: "shape" | "text" | "svg" | "sticker") => {
    switch (type) {
      case "text": return Type;
      case "shape": return Shapes;
      case "svg": return FileCode;
      case "sticker": return Smile;
      default: return History;
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-3 border-b border-border">
        <div className="flex items-center gap-2">
          <History size={14} className="text-primary" aria-hidden />
          <Text type="body" color="primary" weight="bold" className="text-sm">{editorMessage("editor.historyPanel.title")}</Text>
        </div>
        <div className="flex items-center gap-1">
          <IconButton
            label={editorMessage("editor.historyPanel.undo", { count: undoCount })}
            icon={<Undo2 size={14} aria-hidden />}
            variant="ghost"
            size="sm"
            onClick={handleUndo}
            isDisabled={!canUndo()}
          />
          <IconButton
            label={editorMessage("editor.historyPanel.redo", { count: redoCount })}
            icon={<Redo2 size={14} aria-hidden />}
            variant="ghost"
            size="sm"
            onClick={handleRedo}
            isDisabled={!canRedo()}
          />
        </div>
      </div>

      <div className="border-b border-border">
        <ClickableCard
          label={editorMessage(showSnapshots ? "editor.historyPanel.hideSnapshots" : "editor.historyPanel.showSnapshots")}
          onClick={() => setShowSnapshots(!showSnapshots)}
          padding={2}
          variant="transparent"
          className="w-full"
        >
          <div className="flex items-center gap-2">
            {showSnapshots ? (
              <ChevronDown size={12} aria-hidden />
            ) : (
              <ChevronRight size={12} aria-hidden />
            )}
            <Bookmark size={12} className="text-yellow-500" aria-hidden />
            <Text type="supporting" color="secondary" className="text-xs">
              {editorMessage("editor.history.snapshots", { count: snapshots.length })}
            </Text>
          </div>
        </ClickableCard>

        {showSnapshots && (
          <div className="px-2 pb-2">
            {snapshots.length === 0 && !isCreatingSnapshot && (
              <Text type="supporting" color="secondary" className="block text-[10px] py-2 text-center">{editorMessage("editor.historyPanel.emptySnapshots")}</Text>
            )}

            {snapshots.map((snapshot) => (
              <Card
                key={snapshot.id}
                variant="transparent"
                padding={2}
                className="group flex items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2">
                  <Bookmark size={10} className="text-yellow-500" aria-hidden />
                  <div className="flex flex-col gap-0.5">
                    <Text type="supporting" color="primary" display="block" className="text-xs">
                      {snapshot.name}
                    </Text>
                    <Text type="supporting" color="secondary" display="block" className="text-[10px]">
                      {formatTime(snapshot.timestamp)}
                    </Text>
                  </div>
                </div>
                <IconButton
                  label={editorMessage("editor.historyPanel.deleteSnapshot", { name: snapshot.name })}
                  icon={<Trash2 size={10} aria-hidden />}
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDeleteSnapshot(snapshot.id)}
                  className="text-fg-3 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                />
              </Card>
            ))}

            {isCreatingSnapshot ? (
              <div className="flex items-center gap-2 p-2">
                <ToolcraftTextInputControl
                  label={editorMessage("editor.historyPanel.snapshotName")}
                  isLabelHidden
                  size="sm"
                  width="100%"
                  value={newSnapshotName}
                  onChange={setNewSnapshotName}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreateSnapshot();
                    if (e.key === "Escape") setIsCreatingSnapshot(false);
                  }}
                  placeholder={editorMessage("editor.historyPanel.snapshotPlaceholder")}
                  hasAutoFocus
                />
                <Button
                  label={editorMessage("editor.historyPanel.save")}
                  variant="primary"
                  size="sm"
                  onClick={handleCreateSnapshot}
                />
              </div>
            ) : (
              <Button
                label={editorMessage("editor.historyPanel.createSnapshot")}
                icon={<BookmarkPlus size={12} aria-hidden />}
                variant="secondary"
                size="sm"
                onClick={() => setIsCreatingSnapshot(true)}
                className="w-full border border-dashed border-border"
              />
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {combinedHistory.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-fg-3">
            <History size={24} className="mb-2 opacity-30" aria-hidden />
            <Text type="supporting" color="secondary" className="text-xs">{editorMessage("editor.historyPanel.empty")}</Text>
          </div>
        ) : (
          <div className="p-2 space-y-0.5">
            {combinedHistory.map((item) => {
              const ClipIcon = item.isClipEntry ? getClipIcon(item.clipType) : null;
              return (
                <Card
                  key={item.id}
                  variant={item.isCurrent ? "green" : "transparent"}
                  padding={2}
                  className={`flex items-center gap-2 p-2 rounded transition-colors ${
                    item.isCurrent
                      ? "bg-primary/20 border border-primary/30"
                      : "hover:bg-bg-2"
                  }`}
                >
                  {item.isClipEntry && ClipIcon ? (
                    <ClipIcon
                      size={12}
                      className={item.isCurrent ? "text-primary" : "text-fg-3"}
                      aria-hidden
                    />
                  ) : (
                    <div
                      className={`w-1.5 h-1.5 rounded-full ${
                        item.isCurrent ? "bg-primary" : "bg-text-muted"
                      }`}
                    />
                  )}
                  <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                    <Text
                      type="supporting"
                      color={item.isCurrent ? "primary" : "secondary"}
                      display="block"
                      className={`text-xs truncate ${
                        item.isCurrent
                          ? "text-fg"
                          : "text-fg-2"
                      }`}
                    >
                      {item.description}
                    </Text>
                    <Text type="supporting" color="secondary" display="block" className="text-[10px]">
                      {formatTime(item.timestamp)}
                    </Text>
                  </div>
                  {item.groupId && (
                    <Text type="supporting" color="secondary" className="px-1 py-0.5 bg-bg-2 rounded text-[8px]">
                      {editorMessage("editor.history.grouped")}
                    </Text>
                  )}
                  {item.isClipEntry && (
                    <Text type="supporting" className="px-1 py-0.5 bg-amber-500/20 rounded text-[8px] text-amber-400">
                      {editorMessage("editor.history.clip")}
                    </Text>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <div className="p-2 border-t border-border bg-bg-2">
        <div className="flex items-center justify-between text-[10px] text-fg-3">
          <Text type="supporting" color="secondary" className="text-[10px]">
            {editorItemCount("actions", undoCount)}
          </Text>
          <Text type="supporting" color="secondary" className="text-[10px]">
            {editorItemCount("redo", redoCount)}
          </Text>
        </div>
      </div>
    </div>
  );
};

export default HistoryPanel;
