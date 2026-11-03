import { editorMessage } from "../../shotloom-mode";
import type { JSX } from "react";
import { useState } from "react";
import {
  Baseline,
  Box,
  Circle,
  Crosshair,
  Hand,
  Layers,
  MousePointer2,
  Move,
  PenTool,
  RotateCw,
  SlidersHorizontal,
  Sparkles,
  Square,
  SquarePlus,
  Type,
  ZoomIn,
  type LucideIcon,
} from "@/icons/lucide-compat";
import { useProjectStore } from "../../stores/project-store";
import {
  createMotionLayerOfType,
  type CreatableMotionLayerType,
} from "../motion-layer-factory";
import { useMotionStore, type MotionToolId } from "../stores/motion-store";
import { Button, IconButton } from "./primitives";

interface ToolDef {
  id: MotionToolId;
  icon: LucideIcon;
  label: Parameters<typeof editorMessage>[0];
  shortcut?: string;
}

const TOOL_GROUPS: ReadonlyArray<ReadonlyArray<ToolDef>> = [
  [
    { id: "select", icon: MousePointer2, label: "editor.motion.tools.select", shortcut: "V" },
    { id: "hand", icon: Hand, label: "editor.motion.tools.hand", shortcut: "H" },
    { id: "zoom", icon: ZoomIn, label: "editor.motion.tools.zoom", shortcut: "Z" },
  ],
  [
    { id: "move", icon: Move, label: "editor.motion.tools.move" },
    { id: "rotate", icon: RotateCw, label: "editor.motion.tools.rotate" },
    { id: "anchor", icon: Crosshair, label: "editor.motion.tools.anchor" },
  ],
  [
    { id: "rectangle", icon: Square, label: "editor.motion.tools.rectangle", shortcut: "Q" },
    { id: "ellipse", icon: Circle, label: "editor.motion.tools.ellipse" },
    { id: "pen", icon: PenTool, label: "editor.motion.tools.pen", shortcut: "G" },
    { id: "text", icon: Type, label: "editor.motion.tools.text", shortcut: "⌘T" },
    { id: "character", icon: Baseline, label: "editor.motion.tools.character" },
  ],
];

const ADD_MENU: ReadonlyArray<{
  type: CreatableMotionLayerType;
  icon: LucideIcon;
  label: Parameters<typeof editorMessage>[0];
}> = [
  { type: "text", icon: Type, label: "editor.motion.tools.add.text" },
  { type: "shape", icon: Square, label: "editor.motion.tools.add.shape" },
  { type: "scene3d", icon: Box, label: "editor.motion.tools.add.scene3d" },
  { type: "particle", icon: Sparkles, label: "editor.motion.tools.add.particle" },
  { type: "adjustment", icon: SlidersHorizontal, label: "editor.motion.tools.add.adjustment" },
  { type: "group", icon: Layers, label: "editor.motion.tools.add.group" },
  { type: "null", icon: Crosshair, label: "editor.motion.tools.add.null" },
];

export function MotionToolRail(): JSX.Element {
  const activeTool = useMotionStore((state) => state.activeTool);
  const setActiveTool = useMotionStore((state) => state.setActiveTool);
  const activeCompositionId = useMotionStore((state) => state.activeCompositionId);
  const selectLayer = useMotionStore((state) => state.selectLayer);
  const setRightTab = useMotionStore((state) => state.setRightTab);
  const composition = useProjectStore((state) =>
    (state.project.motionCompositions ?? []).find(
      (item) => item.id === activeCompositionId,
    ),
  );
  const upsertMotionComposition = useProjectStore(
    (state) => state.upsertMotionComposition,
  );
  const [addOpen, setAddOpen] = useState(false);

  const addLayer = (type: CreatableMotionLayerType) => {
    if (!composition) return;
    const layer = createMotionLayerOfType(composition, type);
    void upsertMotionComposition({
      ...composition,
      layers: [...composition.layers, layer],
      modifiedAt: Date.now(),
    });
    selectLayer(layer.id);
    if (type === "text") setRightTab("properties");
    setAddOpen(false);
  };

  return (
    <nav
      aria-label={editorMessage("editor.motion.tools.navigation")}
      className="flex w-14 shrink-0 flex-col items-center gap-1.5 border-r border-border bg-bg-1 py-3.5"
    >
      {TOOL_GROUPS.map((group, groupIndex) => (
        <div key={groupIndex} className="flex flex-col items-center gap-1">
          {group.map((tool) => (
            <ToolButton
              key={tool.id}
              tool={tool}
              active={activeTool === tool.id}
              onClick={() => {
                setActiveTool(tool.id);
                if (tool.id === "character") setRightTab("properties");
              }}
            />
          ))}
          {groupIndex < TOOL_GROUPS.length - 1 ? (
            <span className="my-1 h-px w-6 bg-border" />
          ) : null}
        </div>
      ))}
      <div className="relative mt-auto flex flex-col items-center gap-1">
        <span className="mb-1 h-px w-6 bg-border" />
        <IconButton
          label={editorMessage("editor.motion.tools.addLayer")}
          icon={SquarePlus}
          iconSize={17}
          size="md"
          active={addOpen}
          variant="ghost"
          aria-expanded={addOpen}
          isDisabled={!composition}
          onClick={() => setAddOpen((value) => !value)}
        />
        {addOpen ? (
          <>
            <div
              aria-hidden="true"
              className="fixed inset-0 z-40 cursor-default"
              onClick={() => setAddOpen(false)}
            />
            <div className="absolute bottom-0 left-[calc(100%+6px)] z-50 w-48 overflow-hidden rounded-lg border border-border bg-bg-elev p-1.5 shadow-lg">
              {ADD_MENU.map((item) => {
                const Icon = item.icon;
                return (
                  <Button
                    key={item.type}
                    label={editorMessage(item.label)}
                    variant="ghost"
                    size="sm"
                    icon={Icon}
                    onClick={() => addLayer(item.type)}
                    className="w-full justify-start"
                  />
                );
              })}
            </div>
          </>
        ) : null}
      </div>
    </nav>
  );
}

function ToolButton({
  tool,
  active,
  onClick,
}: {
  tool: ToolDef;
  active: boolean;
  onClick: () => void;
}): JSX.Element {
  const Icon = tool.icon;
  const label = editorMessage(tool.label);
  const tip = tool.shortcut ? editorMessage("editor.motion.tools.shortcut", { label, shortcut: tool.shortcut }) : label;
  return (
    <IconButton
      label={tip}
      icon={Icon}
      iconSize={17}
      size="md"
      active={active}
      variant="ghost"
      aria-pressed={active}
      onClick={onClick}
    />
  );
}
