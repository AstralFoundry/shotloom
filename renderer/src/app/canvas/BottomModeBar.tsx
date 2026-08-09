import { useState } from "react";
import type { AgentLayoutMode } from "../../services/agentLayoutService";
import { IconSymbol } from "../components/IconSymbol";

interface BottomModeBarProps {
  canUndo: boolean;
  canRedo: boolean;
  shortcutLabels: { fitView: string; autoLayout: string };
  onUndo: () => void;
  onRedo: () => void;
  onFitView: () => void;
  onMaterialPicker: () => void;
  onAutoLayout: (options?: { mode?: AgentLayoutMode; includeConnected?: boolean }) => boolean;
  onExport: () => void;
  onMergeVideos: () => void;
}
export function BottomModeBar(
  {
    canUndo,
    canRedo,
    shortcutLabels,
    onUndo,
    onRedo,
    onFitView,
    onMaterialPicker,
    onAutoLayout,
    onExport,
    onMergeVideos,
  }: BottomModeBarProps,
) {
  const [help, setHelp] = useState(false);
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [includeConnected, setIncludeConnected] = useState(true);
  const [layoutConfirmation, setLayoutConfirmation] = useState(false);
  const shortcuts = [
    { label: "适应视窗", keys: shortcutLabels.fitView },
    { label: "自动整理", keys: shortcutLabels.autoLayout },
    { label: "撤销 / 重做", keys: "⌘/Ctrl Z · ⇧⌘/Ctrl Z" },
    { label: "复制 / 粘贴", keys: "⌘/Ctrl C · ⌘/Ctrl V" },
    { label: "粘贴截图或文件", keys: "⌘/Ctrl V" },
    { label: "复制并包含上游", keys: "⇧⌘/Ctrl C" },
    { label: "拖拽复制（含上游）", keys: "⌘/Ctrl 拖拽" },
    { label: "显示 / 隐藏连线", keys: "⌘/Ctrl L" },
    { label: "全选 / 同类全选", keys: "⌘/Ctrl A · ⇧⌘/Ctrl A" },
    { label: "运行 / 停止", keys: "⌘/Ctrl Enter · ⇧⌘/Ctrl Enter" },
    { label: "微调位置", keys: "方向键 · Shift 10px" },
    { label: "删除 / 取消选择", keys: "Delete · Esc" },
  ];
  return (
    <div className="bottom-mode-switch">
      <div className="bottom-mode-group">
        <button title="撤销" disabled={!canUndo} onClick={onUndo}>
          <IconSymbol name="undo" />
        </button>
        <button title="重做" disabled={!canRedo} onClick={onRedo}>
          <IconSymbol name="redo" />
        </button>
      </div>
      <div className="bottom-mode-divider" />
      <div className="bottom-mode-group">
        <button title="适应视窗" onClick={onFitView}>
          <IconSymbol name="maximize" />
        </button>
        <button title="选择素材" onClick={onMaterialPicker}>
          <IconSymbol name="image" />
        </button>
        <button
          title="整理节点"
          className={layoutOpen ? "active" : ""}
          onClick={() => {
            setHelp(false);
            setLayoutOpen((value) => !value);
          }}
        >
          <IconSymbol name="columns" />
        </button>
      </div>
      <div className="bottom-mode-divider" />
      <div className="bottom-mode-group">
        <button title="打包下载选中节点资源" onClick={onExport}>
          <IconSymbol name="download" />
        </button>
        <button title="拼接选中的视频节点" onClick={onMergeVideos}>
          <IconSymbol name="link" />
        </button>
        <button
          title="快捷键"
          className={help ? "active" : ""}
          onClick={() => setHelp((value) => !value)}
        >
          <IconSymbol name="help" />
        </button>
      </div>
      {layoutOpen && (
        <div className="canvas-layout-menu" onClick={(event) => event.stopPropagation()}>
          <strong>整理画布</strong>
          <span>有选区时只整理选中节点</span>
          <div className="canvas-layout-options">
            {([
              ["workflow", "按连接", "workflow"],
              ["horizontal", "横向", "columns"],
              ["vertical", "纵向", "list"],
              ["grid", "网格", "grid"],
            ] as const).map(([mode, label, icon]) => (
              <button
                key={mode}
                onClick={() => {
                  const changed = onAutoLayout({ mode, includeConnected });
                  setLayoutOpen(false);
                  setLayoutConfirmation(changed);
                }}
              >
                <IconSymbol name={icon} />
                {label}
              </button>
            ))}
          </div>
          <label>
            <input
              type="checkbox"
              checked={includeConnected}
              onChange={(event) => setIncludeConnected(event.target.checked)}
            />
            整理相连的上下游
          </label>
        </div>
      )}
      {layoutConfirmation && (
        <div className="canvas-layout-confirm" onClick={(event) => event.stopPropagation()}>
          <span>保留整理结果？</span>
          <button onClick={() => setLayoutConfirmation(false)}>保留</button>
          <button
            onClick={() => {
              onUndo();
              setLayoutConfirmation(false);
            }}
          >
            撤销
          </button>
        </div>
      )}
      {help && (
        <div
          className="canvas-shortcut-help"
          onClick={(e) => e.stopPropagation()}
        >
          <strong>画布快捷键</strong>
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
