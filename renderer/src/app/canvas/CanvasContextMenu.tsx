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
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      <button onClick={() => void onCreate("__upload__")}>
        <IconSymbol name="upload" />
        <span>上传</span>
      </button>
      <button
        className="character-workflow-entry"
        onClick={() => void onCreate("__character_multiview__")}
      >
        <IconSymbol name="user" />
        <span>角色设定板</span>
      </button>
      {nodeTypes.map((item) => (
        <button
          key={item.id}
          onClick={() => void onCreate(item.id)}
        >
          <IconSymbol name={item.icon} />
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}
