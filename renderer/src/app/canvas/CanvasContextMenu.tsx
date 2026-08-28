import { IconSymbol } from "../components/IconSymbol";
import { nodeTypes } from "../constants/navigation";

export function CanvasContextMenu(
  { x, y, onCreate }: {
    x: number;
    y: number;
    onCreate: (type: string) => void | Promise<void>;
  },
) {
  return (
    <div
      className="canvas-context-menu"
      role="menu"
      aria-label="添加到画布"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="canvas-context-menu-section" role="group" aria-labelledby="canvas-menu-assets">
        <span id="canvas-menu-assets" className="canvas-context-menu-label">素材与设定</span>
        <button type="button" role="menuitem" onClick={() => void onCreate("__upload__")}>
          <i><IconSymbol name="upload" /></i>
          <span>上传</span>
        </button>
        <button
          type="button"
          role="menuitem"
          className="character-workflow-entry"
          onClick={() => void onCreate("__character_multiview__")}
        >
          <i><IconSymbol name="user" /></i>
          <span>角色设定板</span>
        </button>
      </div>
      <div className="canvas-context-menu-section" role="group" aria-labelledby="canvas-menu-nodes">
        <span id="canvas-menu-nodes" className="canvas-context-menu-label">创作节点</span>
        {nodeTypes.map((item) => (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            onClick={() => void onCreate(item.id)}
          >
            <i><IconSymbol name={item.icon} /></i>
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
