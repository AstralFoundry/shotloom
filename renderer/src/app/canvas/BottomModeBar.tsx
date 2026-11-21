import { t } from '@/i18n';
import { Dropdown, Modal, type MenuProps } from "antd";
import { useState } from "react";
import { IconSymbol } from "../components/IconSymbol";
import { nodeTypes } from "../constants/navigation";
import type { CanvasDockControls } from "./WorkflowCanvas";

interface BottomModeBarProps extends CanvasDockControls {
  materialOpen: boolean;
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
    panMode,
    setPanMode,
    createNode,
    materialOpen,
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
  const [openMenu, setOpenMenu] = useState<"add" | "more" | null>(null);
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
  const selectLabel = t('canvas.gesture.select');
  const panLabel = t('canvas.gesture.pan');
  const addLabel = t('ui.CanvasContextMenu.arialabel.a88f7dd2');
  const moreLabel = t('canvas.storyboard.more');
  const helpLabel = t("ui.BottomModeBar.title.31e33107");
  const moreItems: MenuProps['items'] = [
    onOpenPoseLibrary ? { key: 'pose', label: t('canvas.pose.title'), icon: <IconSymbol name="user" />, onClick: onOpenPoseLibrary } : null,
    { key: 'merge', label: t("ui.BottomModeBar.title.18ba6fed"), icon: <IconSymbol name="link" />, onClick: onMergeVideos },
    onOpenHistory ? { key: 'history', label: t('project.version.title'), icon: <IconSymbol name="clock" />, onClick: onOpenHistory } : null,
    { type: 'divider' },
    { key: 'help', label: helpLabel, icon: <IconSymbol name="help" />, onClick: () => setHelp(true) },
  ];
  return (
    <>
      <div className="bottom-mode-switch" role="group" aria-label={t('canvas.dock.label')}>
        <div className="bottom-mode-group">
          <button type="button" title={selectLabel} aria-label={selectLabel} aria-pressed={!panMode} onClick={() => setPanMode(false)}>
            <IconSymbol name="cursor" />
          </button>
          <button type="button" title={panLabel} aria-label={panLabel} aria-pressed={panMode} onClick={() => setPanMode(true)}>
            <IconSymbol name="hand" />
          </button>
        </div>
        <span className="bottom-mode-divider" aria-hidden="true" />
        <div className="bottom-mode-group">
          <Dropdown
            placement="top"
            autoFocus
            open={openMenu === "add"}
            onOpenChange={(open) => setOpenMenu(current => open ? "add" : current === "add" ? null : current)}
            trigger={['click']}
            overlayClassName="canvas-dock-menu"
            menu={{
              items: [
                { key: 'canvasSection', label: t('canvas.section.create'), icon: <IconSymbol name="layers" /> },
                { type: 'divider' },
                ...nodeTypes.map(item => ({ key: item.id, label: item.label, icon: <IconSymbol name={item.icon} /> })),
              ],
              onClick: ({ key }) => { setOpenMenu(null); createNode(key); },
            }}
          >
            <button type="button" title={addLabel} aria-label={addLabel} aria-haspopup="menu" aria-expanded={openMenu === "add"}>
              <IconSymbol name="plus" />
            </button>
          </Dropdown>
          <button
            type="button"
            className="bottom-material-trigger"
            title={t("ui.BottomModeBar.title.23678ecb")}
            aria-label={t("ui.BottomModeBar.title.23678ecb")}
            aria-expanded={materialOpen}
            onClick={onMaterialPicker}
          >
            <IconSymbol name="folder" />
          </button>
        </div>
        <span className="bottom-mode-divider" aria-hidden="true" />
        <div className="bottom-mode-group">
          <button type="button" title={t("ui.BottomModeBar.title.9fcefd8d")} disabled={!canUndo} onClick={onUndo}>
            <IconSymbol name="undo" />
          </button>
          <button type="button" title={t("ui.BottomModeBar.title.1238f0d3")} disabled={!canRedo} onClick={onRedo}>
            <IconSymbol name="redo" />
          </button>
          <Dropdown
            placement="topRight"
            autoFocus
            trigger={['click']}
            overlayClassName="canvas-dock-menu"
            open={openMenu === "more"}
            onOpenChange={(open) => setOpenMenu(current => open ? "more" : current === "more" ? null : current)}
            menu={{ items: moreItems, onClick: () => setOpenMenu(null) }}
          >
            <button type="button" title={moreLabel} aria-label={moreLabel} aria-haspopup="menu" aria-expanded={openMenu === "more"}>
              <IconSymbol name="more" />
            </button>
          </Dropdown>
        </div>
      </div>
      <Modal title={t("ui.BottomModeBar.text.ad1c63b4")} open={help} onCancel={() => setHelp(false)} footer={null} width={400}>
        <dl className="canvas-shortcut-help">
          {shortcuts.map((item) => (
            <div key={item.label}>
              <dt>{item.label}</dt>
              <dd>{item.keys}</dd>
            </div>
          ))}
        </dl>
      </Modal>
    </>
  );
}
