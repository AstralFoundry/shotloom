import { editorMessage } from "../../shotloom-mode";
import type { JSX } from "react";
import {
  Box,
  Diamond,
  GitBranch,
  ImagePlus,
  Library,
  LineChart,
  PackageCheck,
  Radar,
  Scissors,
  Shapes,
  Sparkles,
  Type,
  Wand2,
  Waves,
  Zap,
  type LucideIcon,
} from "@/icons/lucide-compat";
import { ToolcraftClickableCard, ToolcraftText } from "@openreel/ui";
import type { MotionComposition } from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import {
  createMotionLayerOfType,
  type CreatableMotionLayerType,
} from "../motion-layer-factory";
import {
  useMotionStore,
  type MotionLeftTab,
  type MotionRightTab,
} from "../stores/motion-store";
import { PanelHeader } from "./primitives";

interface MotionStartPanelProps {
  composition: MotionComposition;
}

interface StartAction {
  readonly label: Parameters<typeof editorMessage>[0];
  readonly detail: Parameters<typeof editorMessage>[0];
  readonly icon: LucideIcon;
  readonly run: () => void;
}

export function MotionStartPanel({
  composition,
}: MotionStartPanelProps): JSX.Element {
  const upsertMotionComposition = useProjectStore(
    (state) => state.upsertMotionComposition,
  );
  const selectLayer = useMotionStore((state) => state.selectLayer);
  const setLeftTab = useMotionStore((state) => state.setLeftTab);
  const setRightTab = useMotionStore((state) => state.setRightTab);

  const openLeft = (tab: MotionLeftTab) => {
    setLeftTab(tab);
  };

  const openRight = (tab: MotionRightTab) => {
    setRightTab(tab);
  };

  const addLayer = (
    type: CreatableMotionLayerType,
    rightTab: MotionRightTab = "properties",
  ) => {
    const layer = createMotionLayerOfType(composition, type);
    void upsertMotionComposition({
      ...composition,
      layers: [...composition.layers, layer],
      modifiedAt: Date.now(),
    });
    selectLayer(layer.id);
    setLeftTab("layers");
    setRightTab(rightTab);
  };

  const workflowSections: Array<{
    readonly title: Parameters<typeof editorMessage>[0];
    readonly actions: StartAction[];
  }> = [
    {
      title: "editor.motion.start.open",
      actions: [
        {
          label: "editor.motion.start.templates",
          detail: "editor.motion.start.templatesDescription",
          icon: Sparkles,
          run: () => openLeft("templates"),
        },
        {
          label: "editor.motion.start.assets",
          detail: "editor.motion.start.assetsDescription",
          icon: Library,
          run: () => openLeft("assets"),
        },
      ],
    },
    {
      title: "editor.motion.start.build",
      actions: [
        {
          label: "editor.motion.start.text",
          detail: "editor.motion.start.textDescription",
          icon: Type,
          run: () => addLayer("text", "properties"),
        },
        {
          label: "editor.motion.start.shape",
          detail: "editor.motion.start.shapeDescription",
          icon: Shapes,
          run: () => addLayer("shape", "properties"),
        },
        {
          label: "editor.motion.start.3dscene",
          detail: "editor.motion.start.scene3dDescription",
          icon: Box,
          run: () => addLayer("scene3d", "properties"),
        },
        {
          label: "editor.motion.start.particles",
          detail: "editor.motion.start.particlesDescription",
          icon: Zap,
          run: () => addLayer("particle", "properties"),
        },
      ],
    },
    {
      title: "editor.motion.start.animate",
      actions: [
        {
          label: "editor.motion.start.presets",
          detail: "editor.motion.start.presetsDescription",
          icon: Diamond,
          run: () => openRight("presets"),
        },
        {
          label: "editor.motion.start.graph",
          detail: "editor.motion.start.graphDescription",
          icon: LineChart,
          run: () => openRight("graph"),
        },
        {
          label: "editor.motion.start.effects",
          detail: "editor.motion.start.effectsDescription",
          icon: Wand2,
          run: () => openRight("effects"),
        },
        {
          label: "editor.motion.start.masks",
          detail: "editor.motion.start.masksDescription",
          icon: Scissors,
          run: () => openRight("masks"),
        },
      ],
    },
    {
      title: "editor.motion.start.finish",
      actions: [
        {
          label: "editor.motion.start.sync",
          detail: "editor.motion.start.syncDescription",
          icon: Waves,
          run: () => openRight("sync"),
        },
        {
          label: "editor.motion.start.track",
          detail: "editor.motion.start.trackDescription",
          icon: Radar,
          run: () => openRight("tracker"),
        },
        {
          label: "editor.motion.start.variables",
          detail: "editor.motion.start.variablesDescription",
          icon: GitBranch,
          run: () => openRight("variables"),
        },
        {
          label: "editor.motion.start.queue",
          detail: "editor.motion.start.queueDescription",
          icon: PackageCheck,
          run: () => openRight("queue"),
        },
      ],
    },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader title={editorMessage("editor.motion.start.start")} icon={ImagePlus} />
      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-3">
        {workflowSections.map((section) => (
          <section key={section.title} className="space-y-2">
            <div className="flex items-center justify-between">
              <ToolcraftText
                as="h2"
                type="label"
                color="primary"
                weight="semibold"
                className="text-[12px]"
              >
                {editorMessage(section.title)}
              </ToolcraftText>
              <span className="h-px flex-1 bg-border ml-2" aria-hidden />
            </div>
            <div className="grid grid-cols-2 gap-2">
              {section.actions.map((action) => {
                const Icon = action.icon;
                return (
                  <ToolcraftClickableCard
                    key={action.label}
                    label={editorMessage(action.label)}
                    onClick={action.run}
                    variant="muted"
                    padding={2}
                    className="min-h-[78px]"
                  >
                    <ToolcraftText
                      as="span"
                      type="label"
                      color="primary"
                      weight="semibold"
                      className="mb-1.5 flex items-center gap-1.5"
                    >
                      <Icon size={13} aria-hidden />
                      {editorMessage(action.label)}
                    </ToolcraftText>
                    <ToolcraftText type="supporting" color="secondary" maxLines={2}>
                      {editorMessage(action.detail)}
                    </ToolcraftText>
                  </ToolcraftClickableCard>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
