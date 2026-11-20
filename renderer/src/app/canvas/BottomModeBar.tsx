import { t } from '@/i18n';
import { useState } from "react";
import { IconSymbol } from "../components/IconSymbol";

interface BottomModeBarProps {
  canUndo: boolean;
  canRedo: boolean;
  shortcutLabels: { fitView: string; autoLayout: string };
  onUndo: () => void;
  onRedo: () => void;
  onMaterialPicker: () => void;
  onMergeVideos: () => void;
  onOpenHistory?: () => void;
  onOpenPoseLibrary?: () => void;
}
export function BottomModeBar(
  {
    canUndo,
    canRedo,
    shortcutLabels,
    onUndo,
    onRedo,
    onMaterialPicker,
    onMergeVideos,
    onOpenHistory,
    onOpenPoseLibrary,
  }: BottomModeBarProps,
) {
  const [help, setHelp] = useState(false);
  const shortcuts = [
    { label: t('canvas.gesture.pan'), keys: t('canvas.gesture.panKeys') },
    { label: t('canvas.gesture.zoom'), keys: t('canvas.gesture.zoomKeys') },
    { label: t('canvas.gesture.select'), keys: t('canvas.gesture.selectKeys') },
    { label: t("ui.BottomModeBar.label.a187522f"), keys: shortcutLabels.fitView },
    { label: t("ui.canvasAdapter.text.7ea05931"), keys: shortcutLabels.autoLayout },
    { label: t("ui.BottomModeBar.label.d4e529ba"), keys: "⌘/Ctrl Z · ⇧⌘/Ctrl Z" },
    { label: t("ui.BottomModeBar.label.b3222c83"), keys: "⌘/Ctrl C · ⌘/Ctrl V" },
    { label: t("ui.BottomModeBar.label.97d81e5f"), keys: "⌘/Ctrl V" },
    { label: t("ui.BottomModeBar.label.49294c14"), keys: "⇧⌘/Ctrl C" },
    { label: t("ui.BottomModeBar.label.312a774f"), keys: t("ui.BottomModeBar.keys.dec115af") },
    { label: t("ui.BottomModeBar.label.602f4575"), keys: "⌘/Ctrl L" },
    { label: t("ui.BottomModeBar.label.156b0106"), keys: "⌘/Ctrl A · ⇧⌘/Ctrl A" },
    { label: t("ui.BottomModeBar.label.9649c108"), keys: "⌘/Ctrl Enter · ⇧⌘/Ctrl Enter" },
    { label: t("ui.BottomModeBar.label.96ae473a"), keys: t("ui.BottomModeBar.keys.8ce999e3") },
    { label: t("ui.BottomModeBar.label.600601f7"), keys: "Delete · Esc" },
  ];
  return (
    <div className="bottom-mode-switch">
      <div className="bottom-mode-group">
        <button title={t("ui.BottomModeBar.title.9fcefd8d")} disabled={!canUndo} onClick={onUndo}>
          <IconSymbol name="undo" />
        </button>
        <button title={t("ui.BottomModeBar.title.1238f0d3")} disabled={!canRedo} onClick={onRedo}>
          <IconSymbol name="redo" />
        </button>
      </div>
      <div className="bottom-mode-divider" />
      <div className="bottom-mode-group">
        <button
          className="bottom-material-trigger"
          title={t("ui.BottomModeBar.title.23678ecb")}
          aria-label={t("ui.BottomModeBar.title.23678ecb")}
          onClick={onMaterialPicker}
        >
          <IconSymbol name="folder" />
        </button>
      </div>
      <div className="bottom-mode-divider" />
      <div className="bottom-mode-group">
        {onOpenPoseLibrary ? (
          <button title={t("canvas.pose.title")} aria-label={t("canvas.pose.title")} onClick={onOpenPoseLibrary}>
            <IconSymbol name="user" />
          </button>
        ) : null}
        <button title={t("ui.BottomModeBar.title.18ba6fed")} onClick={onMergeVideos}>
          <IconSymbol name="link" />
        </button>
        {onOpenHistory && (
          <button
            title={t('project.version.title')}
            aria-label={t('project.version.title')}
            onClick={onOpenHistory}
          >
            <IconSymbol name="clock" />
          </button>
        )}
        <button
          title={t("ui.BottomModeBar.title.31e33107")}
          className={help ? "active" : ""}
          onClick={() => setHelp((value) => !value)}
        >
          <IconSymbol name="help" />
        </button>
      </div>
      {help && (
        <div
          className="canvas-shortcut-help"
          onClick={(e) => e.stopPropagation()}
        >
          <strong>{t("ui.BottomModeBar.text.ad1c63b4")}</strong>
          <dl>
            {shortcuts.map((item) => (
              <div key={item.label}>
                <dt>{item.label}</dt>
                <dd>{item.keys}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
