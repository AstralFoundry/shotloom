import { editorMessage } from "../../../shotloom-mode";
import React, { useState, useCallback, useMemo } from "react";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftClickableCard as ClickableCard } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { PropertySlider } from "./shell/PropertySlider";
import { Film, Camera, Moon, Palette, Wand2, Check } from "@/icons/lucide-compat";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { toast } from "../../../stores/notification-store";
import {
  FILTER_PRESETS,
  FILTER_CATEGORIES,
  getPresetsByCategory,
  type FilterPreset,
  type FilterCategory,
} from "@openreel/core";

const presetKeys = {
  "cinematic-teal-orange": ["editor.filterPresets.preset.cinematic-teal-orange.name", "editor.filterPresets.preset.cinematic-teal-orange.description"],
  "cinematic-noir": ["editor.filterPresets.preset.cinematic-noir.name", "editor.filterPresets.preset.cinematic-noir.description"],
  "cinematic-blockbuster": ["editor.filterPresets.preset.cinematic-blockbuster.name", "editor.filterPresets.preset.cinematic-blockbuster.description"],
  "vintage-70s": ["editor.filterPresets.preset.vintage-70s.name", "editor.filterPresets.preset.vintage-70s.description"],
  "vintage-polaroid": ["editor.filterPresets.preset.vintage-polaroid.name", "editor.filterPresets.preset.vintage-polaroid.description"],
  "vintage-vhs": ["editor.filterPresets.preset.vintage-vhs.name", "editor.filterPresets.preset.vintage-vhs.description"],
  "vintage-sepia": ["editor.filterPresets.preset.vintage-sepia.name", "editor.filterPresets.preset.vintage-sepia.description"],
  "mood-dreamy": ["editor.filterPresets.preset.mood-dreamy.name", "editor.filterPresets.preset.mood-dreamy.description"],
  "mood-moody": ["editor.filterPresets.preset.mood-moody.name", "editor.filterPresets.preset.mood-moody.description"],
  "mood-golden-hour": ["editor.filterPresets.preset.mood-golden-hour.name", "editor.filterPresets.preset.mood-golden-hour.description"],
  "mood-cold": ["editor.filterPresets.preset.mood-cold.name", "editor.filterPresets.preset.mood-cold.description"],
  "color-vibrant": ["editor.filterPresets.preset.color-vibrant.name", "editor.filterPresets.preset.color-vibrant.description"],
  "color-muted": ["editor.filterPresets.preset.color-muted.name", "editor.filterPresets.preset.color-muted.description"],
  "color-bw-classic": ["editor.filterPresets.preset.color-bw-classic.name", "editor.filterPresets.preset.color-bw-classic.description"],
  "color-bw-high-contrast": ["editor.filterPresets.preset.color-bw-high-contrast.name", "editor.filterPresets.preset.color-bw-high-contrast.description"],
  "stylized-cyberpunk": ["editor.filterPresets.preset.stylized-cyberpunk.name", "editor.filterPresets.preset.stylized-cyberpunk.description"],
  "stylized-comic": ["editor.filterPresets.preset.stylized-comic.name", "editor.filterPresets.preset.stylized-comic.description"],
  "stylized-soft-glow": ["editor.filterPresets.preset.stylized-soft-glow.name", "editor.filterPresets.preset.stylized-soft-glow.description"],
  "cinematic-bleach-bypass": ["editor.filterPresets.preset.cinematic-bleach-bypass.name", "editor.filterPresets.preset.cinematic-bleach-bypass.description"],
  "cinematic-day-for-night": ["editor.filterPresets.preset.cinematic-day-for-night.name", "editor.filterPresets.preset.cinematic-day-for-night.description"],
  "vintage-faded-film": ["editor.filterPresets.preset.vintage-faded-film.name", "editor.filterPresets.preset.vintage-faded-film.description"],
  "vintage-super8": ["editor.filterPresets.preset.vintage-super8.name", "editor.filterPresets.preset.vintage-super8.description"],
  "mood-sunset": ["editor.filterPresets.preset.mood-sunset.name", "editor.filterPresets.preset.mood-sunset.description"],
  "mood-winter-chill": ["editor.filterPresets.preset.mood-winter-chill.name", "editor.filterPresets.preset.mood-winter-chill.description"],
  "mood-dramatic": ["editor.filterPresets.preset.mood-dramatic.name", "editor.filterPresets.preset.mood-dramatic.description"],
  "color-pop": ["editor.filterPresets.preset.color-pop.name", "editor.filterPresets.preset.color-pop.description"],
  "color-pastel": ["editor.filterPresets.preset.color-pastel.name", "editor.filterPresets.preset.color-pastel.description"],
  "stylized-dreamscape": ["editor.filterPresets.preset.stylized-dreamscape.name", "editor.filterPresets.preset.stylized-dreamscape.description"],
  "stylized-hdr": ["editor.filterPresets.preset.stylized-hdr.name", "editor.filterPresets.preset.stylized-hdr.description"],
  "stylized-matrix": ["editor.filterPresets.preset.stylized-matrix.name", "editor.filterPresets.preset.stylized-matrix.description"],
} as const;
const categoryKeys = {
  cinematic: "editor.filterPresets.category.cinematic",
  vintage: "editor.filterPresets.category.vintage",
  mood: "editor.filterPresets.category.mood",
  color: "editor.filterPresets.category.color",
  stylized: "editor.filterPresets.category.stylized",
} as const;
const presetText = (preset: FilterPreset, field: "name" | "description") => {
  const keys = presetKeys[preset.id as keyof typeof presetKeys];
  return keys ? editorMessage(keys[field === "name" ? 0 : 1]) : preset[field];
};
const effectKeys = {
  blur: "editor.videoEffects.blur",
  brightness: "editor.videoEffects.brightness",
  contrast: "editor.videoEffects.contrast",
  grain: "editor.videoEffects.grain",
  hue: "editor.videoEffects.hue",
  saturation: "editor.videoEffects.saturation",
  sharpen: "editor.videoEffects.sharpen",
  vignette: "editor.videoEffects.vignette",
} as const;
const effectLabel = (type: string) => {
  const key = effectKeys[type as keyof typeof effectKeys];
  return key ? editorMessage(key) : type;
};

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  cinematic: Film,
  vintage: Camera,
  mood: Moon,
  color: Palette,
  stylized: Wand2,
};

interface PresetCardProps {
  preset: FilterPreset;
  isApplied: boolean;
  onApply: () => void;
}

const PresetCard: React.FC<PresetCardProps> = ({
  preset,
  isApplied,
  onApply,
}) => {
  return (
    <ClickableCard
      label={editorMessage("editor.filterPresets.apply", { name: presetText(preset, "name") })}
      onClick={onApply}
      className={`relative w-full p-3 rounded-lg border transition-all text-left ${
        isApplied
          ? "border-primary bg-primary/10"
          : "border-border bg-bg-2 hover:border-primary/50"
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <Text type="supporting" color="primary" weight="medium">
              {presetText(preset, "name")}
            </Text>
            {isApplied && <Check size={12} className="text-primary" />}
          </div>
          <Text type="supporting" color="secondary" display="block" className="mt-0.5 text-[9px]">
            {presetText(preset, "description")}
          </Text>
        </div>
      </div>
      <div className="mt-2 flex gap-1 flex-wrap">
        {preset.effects.slice(0, 3).map((effect, index) => (
          <Text
            key={index}
            type="supporting"
            color="secondary"
            className="px-1.5 py-0.5 text-[8px] bg-bg-1 rounded text-fg-3"
          >
            {effectLabel(effect.type)}
          </Text>
        ))}
        {preset.effects.length > 3 && (
          <Text
            type="supporting"
            color="secondary"
            className="px-1.5 py-0.5 text-[8px] bg-bg-1 rounded text-fg-3"
          >
            +{preset.effects.length - 3}
          </Text>
        )}
      </div>
    </ClickableCard>
  );
};

interface FilterPresetsPanelProps {
  clipId?: string;
}

export const FilterPresetsPanel: React.FC<FilterPresetsPanelProps> = ({
  clipId,
}) => {
  const selectedClipIds = useUIStore((state) => state.getSelectedClipIds());
  const addVideoEffect = useProjectStore((state) => state.addVideoEffect);
  const getVideoEffects = useProjectStore((state) => state.getVideoEffects);
  const removeVideoEffect = useProjectStore((state) => state.removeVideoEffect);

  const [selectedCategory, setSelectedCategory] =
    useState<FilterCategory>("cinematic");
  const [appliedPresetId, setAppliedPresetId] = useState<string | null>(null);
  const [intensityValue, setIntensityValue] = useState(100);

  const targetClipId = clipId || selectedClipIds[0];
  const presets = useMemo(
    () => getPresetsByCategory(selectedCategory),
    [selectedCategory],
  );

  const handleApplyPreset = useCallback(
    async (preset: FilterPreset) => {
      if (!targetClipId) return;

      const existingEffects = getVideoEffects(targetClipId);
      for (const effect of existingEffects) {
        await removeVideoEffect(targetClipId, effect.id);
      }

      for (const filterEffect of preset.effects) {
        await addVideoEffect(
          targetClipId,
          filterEffect.type,
          filterEffect.params,
        );
      }

      setAppliedPresetId(preset.id);
      toast.success(editorMessage("editor.filterPresets.applied"), editorMessage("editor.filterPresets.appliedDetail", { name: presetText(preset, "name") }));
    },
    [targetClipId, addVideoEffect, getVideoEffects, removeVideoEffect],
  );

  const handleClearEffects = useCallback(async () => {
    if (!targetClipId) return;

    const existingEffects = getVideoEffects(targetClipId);
    for (const effect of existingEffects) {
      await removeVideoEffect(targetClipId, effect.id);
    }

    setAppliedPresetId(null);
    toast.info(editorMessage("editor.filterPresets.cleared"));
  }, [targetClipId, getVideoEffects, removeVideoEffect]);

  if (!targetClipId) {
    return (
      <div className="p-4 text-center">
        <Palette size={24} className="mx-auto mb-2 text-fg-3" />
        <Text type="supporting" color="secondary">{editorMessage("editor.filterPresets.empty")}</Text>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 p-2 bg-primary/10 rounded-lg border border-primary/30">
        <Palette size={16} className="text-primary" />
        <div className="flex flex-col gap-0.5">
          <Text type="supporting" color="primary" weight="medium" display="block">{editorMessage("editor.filterPresets.title")}</Text>
          <Text type="supporting" color="secondary" display="block" className="text-[9px]">{editorMessage("editor.filterPresets.description")}</Text>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto pb-1">
        {FILTER_CATEGORIES.map((category) => {
          const Icon = CATEGORY_ICONS[category.id] || Palette;
          return (
            <Button
              key={category.id}
              label={editorMessage(categoryKeys[category.id])}
              size="sm"
              variant={selectedCategory === category.id ? "primary" : "secondary"}
              icon={<Icon size={12} aria-hidden />}
              onClick={() => setSelectedCategory(category.id as FilterCategory)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] whitespace-nowrap transition-colors ${
                selectedCategory === category.id
                  ? "bg-primary text-white font-medium"
                  : "bg-bg-2 text-fg-2 hover:text-fg"
              }`}
            />
          );
        })}
      </div>

      <div className="space-y-2 max-h-64 overflow-y-auto">
        {presets.map((preset) => (
          <PresetCard
            key={preset.id}
            preset={preset}
            isApplied={appliedPresetId === preset.id}
            onApply={() => handleApplyPreset(preset)}
          />
        ))}
      </div>

      {appliedPresetId && (
        <Card variant="muted" padding={3} className="space-y-3">
          <PropertySlider
            label={editorMessage("editor.filterPresets.intensity")}
            min={0}
            max={100}
            step={1}
            value={intensityValue}
            onChange={setIntensityValue}
            formatValue={(value) => `${value}%`}
          />
          <Button
            label={editorMessage("editor.filterPresets.remove")}
            size="sm"
            variant="destructive"
            onClick={handleClearEffects}
            className="w-full py-2 text-[10px] text-red-400 hover:text-red-300 bg-red-500/10 rounded-lg transition-colors"
          />
        </Card>
      )}

      <Text type="supporting" color="secondary" className="text-center text-[9px]">
        {editorMessage("editor.filters.summary", { presets: FILTER_PRESETS.length, categories: FILTER_CATEGORIES.length })}
      </Text>
    </div>
  );
};

export default FilterPresetsPanel;
