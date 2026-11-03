import { t } from '@/i18n';
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { IconSymbol } from "../components/IconSymbol";
import { useWorkbenchSurfaceRoot } from "../layout/workbenchSurface";
import { saveAppSettings } from "../../store/settingsStore.ts";
import {
  NODE_TOOLBAR_TOOLS,
  defaultCanvasToolbarCustomization,
  nodeToolbarScopes,
  type CanvasToolbarCustomization,
  type NodeToolDefinition,
  type NodeToolbarScope,
} from "../../utils/canvasNodeToolbar.ts";

const SCOPE_TAB_LABELS: Record<NodeToolbarScope, string> = {
  image: t("ui.CanvasToolbarCustomizeDialog.image.167e8c64"),
  video: t("ui.CanvasToolbarCustomizeDialog.video.1a4fa42b"),
};

/**
 * 编辑的是全局偏好而不是当前节点，所以每一项改动立刻落盘：
 * 节点上的工具条就在弹窗背后，所见即所得比"取消/确定"更能说明排布结果。
 */
async function writeCustomization(next: CanvasToolbarCustomization) {
  await saveAppSettings({ canvasToolbarCustomization: next });
}

function PinnedToolTile({ tool, onToggle }: {
  tool: NodeToolDefinition;
  onToggle: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tool.id });
  return (
    <button
      ref={setNodeRef}
      type="button"
      className={`canvas-toolbar-tile is-pinned${isDragging ? " is-dragging" : ""}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      onClick={onToggle}
      aria-label={t("ui.CanvasToolbarCustomizeDialog.text.b4e60e51", { value0: tool.label })}
      {...attributes}
      {...listeners}
    >
      <IconSymbol name={tool.icon} />
      <span>{tool.label}</span>
      <IconSymbol className="canvas-toolbar-tile-mark" name="check" />
    </button>
  );
}

function AvailableToolTile({ tool, onToggle }: {
  tool: NodeToolDefinition;
  onToggle: () => void;
}) {
  return (
    <button type="button" className="canvas-toolbar-tile" onClick={onToggle} aria-label={t("ui.CanvasToolbarCustomizeDialog.text.c08eca90", { value0: tool.label })}>
      <IconSymbol name={tool.icon} />
      <span>{tool.label}</span>
      <IconSymbol className="canvas-toolbar-tile-mark" name="plus" />
    </button>
  );
}

export function CanvasToolbarCustomizeDialog({ open, onClose, customization }: {
  open: boolean;
  onClose: () => void;
  /**
   * 由工具条把订阅到的同一份排布传进来：弹窗背后就是工具条，
   * 两者必须读同一个快照，弹窗自己不再维护第二份状态源。
   */
  customization: CanvasToolbarCustomization;
}) {
  const surface = useWorkbenchSurfaceRoot();
  const [scope, setScope] = useState<NodeToolbarScope>("image");
  const sensors = useSensors(
    // 4px 激活距离：否则一次点击就被 dnd-kit 当成一次拖拽，加/减按钮点不动。
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open || !surface) return null;

  const tools = NODE_TOOLBAR_TOOLS[scope];
  const pinned = customization.pinned[scope];
  const pinnedSet = new Set(pinned);
  const pinnedTools = pinned
    .map((id) => tools.find((tool) => tool.id === id))
    .filter((tool): tool is NodeToolDefinition => Boolean(tool));
  const availableTools = tools.filter((tool) => !pinnedSet.has(tool.id));

  function toggle(toolId: string) {
    const next: CanvasToolbarCustomization = {
      ...customization,
      pinned: {
        ...customization.pinned,
        [scope]: pinnedSet.has(toolId)
          ? pinned.filter((id) => id !== toolId)
          : [...pinned, toolId],
      },
    };
    void writeCustomization(next);
  }

  function onDragEnd(event: DragEndEvent) {
    const overId = event.over ? String(event.over.id) : "";
    const activeId = String(event.active.id);
    const from = pinned.indexOf(activeId);
    const to = overId ? pinned.indexOf(overId) : -1;
    if (from < 0 || to < 0 || from === to) return;
    const nextPinned = pinned.filter((id) => id !== activeId);
    nextPinned.splice(to, 0, activeId);
    void writeCustomization({
      ...customization,
      pinned: { ...customization.pinned, [scope]: nextPinned },
    });
  }

  return createPortal(
    <div
      className="canvas-toolbar-customize-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t("ui.CanvasToolbarCustomizeDialog.arialabel.4e2c69f0")}
      tabIndex={-1}
      onPointerDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section className="canvas-toolbar-customize">
        <header className="canvas-toolbar-customize-head">
          <strong>{t("ui.CanvasNodeToolbar.label.17e589f3")}</strong>
          <button type="button" aria-label={t("ui.CanvasToolbarCustomizeDialog.arialabel.6c14bd7f")} onClick={onClose}><IconSymbol name="x" /></button>
        </header>
        <div className="canvas-toolbar-customize-body">
          <div className="canvas-toolbar-scopes" role="tablist">
            {nodeToolbarScopes().map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={scope === item}
                className={scope === item ? "active" : ""}
                onClick={() => setScope(item)}
              >
                {SCOPE_TAB_LABELS[item]}
              </button>
            ))}
          </div>
          <p className="canvas-toolbar-hint">{t("ui.CanvasToolbarCustomizeDialog.text.9d69ed28")}</p>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={pinned} strategy={rectSortingStrategy}>
              <div className="canvas-toolbar-zone">
                <h3>{t("ui.CanvasToolbarCustomizeDialog.text.6bf018da")}</h3>
                <div className="canvas-toolbar-tiles">
                  {pinnedTools.map((tool) => (
                    <PinnedToolTile key={tool.id} tool={tool} onToggle={() => toggle(tool.id)} />
                  ))}
                  {!pinnedTools.length && <span className="canvas-toolbar-empty">{t("ui.CanvasToolbarCustomizeDialog.text.3376c519")}</span>}
                </div>
              </div>
            </SortableContext>
            <div className="canvas-toolbar-zone">
              <h3>{t("ui.CanvasToolbarCustomizeDialog.text.7c4be2e3")}</h3>
              <div className="canvas-toolbar-tiles">
                {availableTools.map((tool) => (
                  <AvailableToolTile key={tool.id} tool={tool} onToggle={() => toggle(tool.id)} />
                ))}
                {!availableTools.length && <span className="canvas-toolbar-empty">{t("ui.CanvasToolbarCustomizeDialog.text.14dba8a9")}</span>}
              </div>
            </div>
          </DndContext>
          <label className="canvas-toolbar-option">
            <input
              type="checkbox"
              checked={customization.showLabels}
              onChange={(event) => void writeCustomization({
                ...customization,
                showLabels: event.target.checked,
              })}
            />
            <span>{t("ui.CanvasToolbarCustomizeDialog.text.430f2fcf")}</span>
          </label>
        </div>
        <footer className="canvas-toolbar-customize-foot">
          <button
            type="button"
            className="button ghost"
            onClick={() => void writeCustomization({
              ...customization,
              pinned: {
                ...customization.pinned,
                [scope]: defaultCanvasToolbarCustomization().pinned[scope],
              },
            })}
          >
            {t("ui.CameraControlPanel.text.a191935b")}</button>
          <button type="button" className="button primary" onClick={onClose}>{t("ui.ReactWorkbench.text.33246f6a")}</button>
        </footer>
      </section>
    </div>,
    surface,
  );
}
