import { t } from '@/i18n';
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
      aria-label={t("ui.CanvasContextMenu.arialabel.a88f7dd2")}
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="canvas-context-menu-section" role="group" aria-labelledby="canvas-menu-assets">
        <span id="canvas-menu-assets" className="canvas-context-menu-label">{t("ui.CanvasContextMenu.text.06614c23")}</span>
        <button type="button" role="menuitem" onClick={() => void onCreate("__upload__")}>
          <i><IconSymbol name="upload" /></i>
          <span>{t("ui.CanvasContextMenu.text.a977650d")}</span>
        </button>
      </div>
      <div className="canvas-context-menu-section" role="group" aria-labelledby="canvas-menu-nodes">
        <span id="canvas-menu-nodes" className="canvas-context-menu-label">{t("ui.CanvasContextMenu.text.7976e0d9")}</span>
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
