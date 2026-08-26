import { useEffect } from "react";

export function useVideoEditorShortcuts({
  exporting,
  onClose,
  onTogglePlayback,
  onSplit,
  onDelete,
  onUndo,
  onRedo,
}: {
  exporting: boolean;
  onClose: () => void;
  onTogglePlayback: () => void;
  onSplit: () => void;
  onDelete: () => void;
  onUndo: () => void;
  onRedo: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const editingText = event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement;
      if (event.key === "Escape" && !exporting) {
        onClose();
      } else if (event.code === "Space" && !editingText) {
        event.preventDefault();
        onTogglePlayback();
      } else if (
        event.key.toLowerCase() === "s" && !event.metaKey && !event.ctrlKey
      ) {
        onSplit();
      } else if (
        (event.key === "Delete" || event.key === "Backspace") && !editingText
      ) {
        onDelete();
      } else if (
        (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z"
      ) {
        event.shiftKey ? onRedo() : onUndo();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });
}
