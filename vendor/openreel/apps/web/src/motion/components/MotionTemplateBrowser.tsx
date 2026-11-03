import { editorMessage } from "../../shotloom-mode";
import type { JSX } from "react";
import { useMemo, useState } from "react";
import { Clapperboard, Sparkles } from "@/icons/lucide-compat";
import { ToolcraftClickableCard, ToolcraftText } from "@openreel/ui";
import { MOTION_PRESETS, getMotionPresetCategories } from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import { useMotionStore } from "../stores/motion-store";
import { PanelHeader, SegmentedControl } from "./primitives";

const CATEGORY_LABELS = {
  "ads": "editor.motion.templates.category.ads",
  "app-ui-demos": "editor.motion.templates.category.app-ui-demos",
  "lower-thirds": "editor.motion.templates.category.lower-thirds",
  "product-shots": "editor.motion.templates.category.product-shots",
  "social-hooks": "editor.motion.templates.category.social-hooks",
  "kinetic-typography": "editor.motion.templates.category.kinetic-typography",
  "logo-reveals": "editor.motion.templates.category.logo-reveals",
  "end-screens": "editor.motion.templates.category.end-screens",
} as const;
function categoryLabel(category: string): string {
  return Object.hasOwn(CATEGORY_LABELS, category) ? editorMessage(CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS]) : category;
}
const PRESET_KEYS = {
  "motion-ad-card": { name: "editor.motion.templates.motion-ad-card", description: "editor.motion.templates.motion-ad-card.description" },
  "motion-app-ui-demo": { name: "editor.motion.templates.motion-app-ui-demo", description: "editor.motion.templates.motion-app-ui-demo.description" },
  "motion-lower-third": { name: "editor.motion.templates.motion-lower-third", description: "editor.motion.templates.motion-lower-third.description" },
  "motion-product-shot": { name: "editor.motion.templates.motion-product-shot", description: "editor.motion.templates.motion-product-shot.description" },
  "motion-social-hook": { name: "editor.motion.templates.motion-social-hook", description: "editor.motion.templates.motion-social-hook.description" },
  "motion-kinetic-title": { name: "editor.motion.templates.motion-kinetic-title", description: "editor.motion.templates.motion-kinetic-title.description" },
  "motion-logo-reveal": { name: "editor.motion.templates.motion-logo-reveal", description: "editor.motion.templates.motion-logo-reveal.description" },
  "motion-end-screen": { name: "editor.motion.templates.motion-end-screen", description: "editor.motion.templates.motion-end-screen.description" },
} as const;
function presetLabel(preset: (typeof MOTION_PRESETS)[number], field: "name" | "description"): string {
  return Object.hasOwn(PRESET_KEYS, preset.id) ? editorMessage(PRESET_KEYS[preset.id as keyof typeof PRESET_KEYS][field]) : preset[field];
}

const CATEGORY_GRADIENTS: Record<string, string> = {
  ads: "from-emerald-500/30 via-teal-500/20 to-green-500/30",
  "lower-thirds": "from-emerald-500/30 via-teal-500/20 to-cyan-500/30",
  "logo-reveals": "from-amber-500/30 via-orange-500/20 to-rose-500/30",
  "social-hooks": "from-emerald-500/30 via-lime-500/20 to-orange-500/30",
  "kinetic-typography": "from-sky-500/30 via-teal-500/20 to-emerald-500/30",
  "end-screens": "from-slate-500/30 via-zinc-500/20 to-stone-500/30",
};

const DEFAULT_GRADIENT = "from-accent-soft via-bg-3 to-accent-soft";

export function MotionTemplateBrowser(): JSX.Element {
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const createMotionComposition = useProjectStore(
    (state) => state.createMotionComposition,
  );
  const setActiveCompositionId = useMotionStore(
    (state) => state.setActiveCompositionId,
  );

  const categories = useMemo(() => {
    return ["all", ...getMotionPresetCategories()];
  }, []);

  const presets = useMemo(
    () =>
      activeCategory === "all"
        ? MOTION_PRESETS
        : MOTION_PRESETS.filter((preset) => preset.category === activeCategory),
    [activeCategory],
  );

  const applyPreset = async (presetId: string, name: string) => {
    const composition = await createMotionComposition(name, presetId);
    if (composition) setActiveCompositionId(composition.id);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader title={editorMessage("editor.motion.templates.title")} icon={Sparkles} />

      <div className="shrink-0 border-b border-border px-3 py-2.5">
        <SegmentedControl
          value={activeCategory}
          options={categories.map((category) => ({
            value: category,
            label: category === "all" ? editorMessage("editor.motion.templates.all") : categoryLabel(category),
          }))}
          onChange={setActiveCategory}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        <div className="grid grid-cols-1 gap-3">
          {presets.map((preset) => (
            <ToolcraftClickableCard
              key={preset.id}
              label={editorMessage("editor.motion.templates.apply", { name: presetLabel(preset, "name") })}
              onClick={() => void applyPreset(preset.id, presetLabel(preset, "name"))}
              variant="muted"
              padding={0}
              className="overflow-hidden"
            >
              <div
                className={`relative flex aspect-video items-center justify-center bg-gradient-to-br ${
                  CATEGORY_GRADIENTS[preset.category] ?? DEFAULT_GRADIENT
                }`}
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm transition-transform group-hover:scale-110">
                  <Clapperboard size={20} aria-hidden />
                </div>
                <span className="absolute left-2.5 top-2.5 rounded-md bg-black/55 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/90 backdrop-blur-sm">
                  {categoryLabel(preset.category)}
                </span>
                {preset.variables.length > 0 ? (
                  <span className="absolute bottom-2.5 right-2.5 rounded-md bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-white/90 backdrop-blur-sm">
                    {editorMessage("editor.motion.templates.variables", { count: preset.variables.length })}
                  </span>
                ) : null}
              </div>
              <div className="p-3">
                <ToolcraftText type="body" color="primary" weight="semibold" className="mb-1 block">
                  {presetLabel(preset, "name")}
                </ToolcraftText>
                <ToolcraftText type="supporting" color="secondary" maxLines={2}>
                  {presetLabel(preset, "description")}
                </ToolcraftText>
              </div>
            </ToolcraftClickableCard>
          ))}
        </div>
      </div>
    </div>
  );
}
