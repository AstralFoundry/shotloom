import { editorMessage } from "../../../shotloom-mode";
import React, { useState, useCallback, useMemo, useEffect } from "react";
import {
  Layers,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronRight,
  Palette,
  Droplet,
  Copy,
} from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftClickableCard as ClickableCard } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftPopover as Popover } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { PropertySlider } from "./shell/PropertySlider";
import { useEngineStore } from "../../../stores/engine-store";
import { useProjectStore } from "../../../stores/project-store";
import type { AdjustmentLayer, BlendMode, Effect } from "@openreel/core";

type MessageKey = Parameters<typeof editorMessage>[0];

interface AdjustmentLayerSectionProps {
  clipId: string;
}

const EFFECT_PRESETS: Array<{
  id: string;
  name: MessageKey;
  effect: Omit<Effect, "id">;
  controls: readonly {
    param: string;
    label: MessageKey;
    min: number;
    max: number;
    step: number;
    format?: "percent" | "percent-value" | "degrees" | "pixels";
  }[];
}> = [
  {
    id: "brightness",
    name: "editor.adjustment.label.brightness",
    effect: { type: "brightness", params: { value: 12 }, enabled: true },
    controls: [{ param: "value", label: "editor.adjustment.label.brightness", min: -100, max: 100, step: 1, format: "percent-value" }],
  },
  {
    id: "contrast",
    name: "editor.adjustment.label.contrast",
    effect: { type: "contrast", params: { value: 1.15 }, enabled: true },
    controls: [{ param: "value", label: "editor.adjustment.label.contrast", min: 0, max: 3, step: 0.01 }],
  },
  {
    id: "saturation",
    name: "editor.adjustment.label.saturation",
    effect: { type: "saturation", params: { value: 1.15 }, enabled: true },
    controls: [{ param: "value", label: "editor.adjustment.label.saturation", min: 0, max: 3, step: 0.01 }],
  },
  {
    id: "grayscale",
    name: "editor.adjustment.label.grayscale",
    effect: { type: "grayscale", params: { amount: 1 }, enabled: true },
    controls: [{ param: "amount", label: "editor.adjustment.label.amount", min: 0, max: 1, step: 0.01, format: "percent" }],
  },
  {
    id: "sepia",
    name: "editor.adjustment.label.sepia",
    effect: { type: "sepia", params: { amount: 1 }, enabled: true },
    controls: [{ param: "amount", label: "editor.adjustment.label.amount", min: 0, max: 1, step: 0.01, format: "percent" }],
  },
  {
    id: "invert",
    name: "editor.adjustment.label.invert",
    effect: { type: "invert", params: { amount: 1 }, enabled: true },
    controls: [{ param: "amount", label: "editor.adjustment.label.amount", min: 0, max: 1, step: 0.01, format: "percent" }],
  },
  {
    id: "hue",
    name: "editor.adjustment.label.hue-rotate",
    effect: { type: "hue", params: { rotation: 20 }, enabled: true },
    controls: [{ param: "rotation", label: "editor.adjustment.label.rotation", min: -180, max: 180, step: 1, format: "degrees" }],
  },
  {
    id: "blur",
    name: "editor.adjustment.label.blur",
    effect: { type: "blur", params: { radius: 6 }, enabled: true },
    controls: [{ param: "radius", label: "editor.adjustment.label.radius", min: 0, max: 40, step: 0.5, format: "pixels" }],
  },
  {
    id: "sharpen",
    name: "editor.adjustment.label.sharpen",
    effect: { type: "sharpen", params: { amount: 0.6 }, enabled: true },
    controls: [{ param: "amount", label: "editor.adjustment.label.amount", min: 0, max: 3, step: 0.05 }],
  },
  {
    id: "vignette",
    name: "editor.adjustment.label.vignette",
    effect: { type: "vignette", params: { amount: 0.45, midpoint: 0.55, feather: 0.35 }, enabled: true },
    controls: [
      { param: "amount", label: "editor.adjustment.label.amount", min: 0, max: 1, step: 0.01, format: "percent" },
      { param: "midpoint", label: "editor.adjustment.label.midpoint", min: 0, max: 1, step: 0.01, format: "percent" },
      { param: "feather", label: "editor.adjustment.label.feather", min: 0.01, max: 1, step: 0.01, format: "percent" },
    ],
  },
  {
    id: "temperature",
    name: "editor.adjustment.label.temperature",
    effect: { type: "temperature", params: { value: 20 }, enabled: true },
    controls: [{ param: "value", label: "editor.adjustment.label.warm-cool", min: -100, max: 100, step: 1 }],
  },
  {
    id: "tint",
    name: "editor.adjustment.label.tint",
    effect: { type: "tint", params: { value: 15 }, enabled: true },
    controls: [{ param: "value", label: "editor.adjustment.label.green-magenta", min: -100, max: 100, step: 1 }],
  },
  {
    id: "grain",
    name: "editor.adjustment.label.film-grain",
    effect: { type: "grain", params: { amount: 0.08, size: 1 }, enabled: true },
    controls: [
      { param: "amount", label: "editor.adjustment.label.amount", min: 0, max: 0.5, step: 0.01, format: "percent" },
      { param: "size", label: "editor.adjustment.label.size", min: 0.5, max: 4, step: 0.1 },
    ],
  },
];

const BLEND_MODES: Array<{ id: BlendMode; name: MessageKey; group: MessageKey }> = [
  { id: "normal", name: "editor.motion.layers.blend.normal", group: "editor.adjustment.label.basic" },
  { id: "multiply", name: "editor.motion.layers.blend.multiply", group: "editor.adjustment.label.darken" },
  { id: "screen", name: "editor.motion.layers.blend.screen", group: "editor.adjustment.label.lighten" },
  { id: "overlay", name: "editor.motion.layers.blend.overlay", group: "editor.adjustment.label.contrast" },
  { id: "darken", name: "editor.motion.layers.blend.darken", group: "editor.adjustment.label.darken" },
  { id: "lighten", name: "editor.motion.layers.blend.lighten", group: "editor.adjustment.label.lighten" },
  { id: "color-dodge", name: "editor.motion.layers.blend.color-dodge", group: "editor.adjustment.label.lighten" },
  { id: "color-burn", name: "editor.motion.layers.blend.color-burn", group: "editor.adjustment.label.darken" },
  { id: "hard-light", name: "editor.motion.layers.blend.hard-light", group: "editor.adjustment.label.contrast" },
  { id: "soft-light", name: "editor.motion.layers.blend.soft-light", group: "editor.adjustment.label.contrast" },
  { id: "difference", name: "editor.motion.layers.blend.difference", group: "editor.adjustment.label.inversion" },
  { id: "exclusion", name: "editor.motion.layers.blend.exclusion", group: "editor.adjustment.label.inversion" },
  { id: "hue", name: "editor.motion.layers.blend.hue", group: "editor.adjustment.label.component" },
  { id: "saturation", name: "editor.motion.layers.blend.saturation", group: "editor.adjustment.label.component" },
  { id: "color", name: "editor.motion.layers.blend.color", group: "editor.adjustment.label.component" },
  { id: "luminosity", name: "editor.motion.layers.blend.luminosity", group: "editor.adjustment.label.component" },
];

function adjustmentEffectPreviewStyle(type: string): React.CSSProperties {
  switch (type) {
    case "brightness": return { filter: "brightness(1.45)" };
    case "contrast": return { filter: "contrast(1.65)" };
    case "saturation": return { filter: "saturate(1.8)" };
    case "grayscale": return { filter: "grayscale(1)" };
    case "sepia": return { filter: "sepia(1)" };
    case "invert": return { filter: "invert(1)" };
    case "hue": return { filter: "hue-rotate(120deg)" };
    case "blur": return { filter: "blur(3px)" };
    case "sharpen": return { filter: "contrast(1.4) brightness(1.05)" };
    case "vignette": return { boxShadow: "inset 0 0 22px 8px rgba(0,0,0,.72)" };
    case "temperature": return { filter: "sepia(.5) saturate(1.35)" };
    case "tint": return { filter: "hue-rotate(45deg) saturate(1.25)" };
    case "grain": return { filter: "contrast(1.12)", opacity: 0.88 };
    default: return {};
  }
}

export const AdjustmentLayerSection: React.FC<AdjustmentLayerSectionProps> = ({
  clipId,
}) => {
  const getAdjustmentLayerEngine = useEngineStore(
    (state) => state.getAdjustmentLayerEngine,
  );
  const project = useProjectStore((state) => state.project);

  const [expandedLayer, setExpandedLayer] = useState<string | null>(null);
  const [showBlendModes, setShowBlendModes] = useState(false);
  const [adjustmentLayerEngine, setAdjustmentLayerEngine] =
    useState<import("@openreel/core").AdjustmentLayerEngine | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadEngine = async () => {
      const engine = await getAdjustmentLayerEngine();
      if (!cancelled) {
        setAdjustmentLayerEngine(engine);
      }
    };
    loadEngine();
    return () => {
      cancelled = true;
    };
  }, [getAdjustmentLayerEngine]);

  useEffect(() => {
    if (!adjustmentLayerEngine) return;
    adjustmentLayerEngine.loadLayers(project.adjustmentLayers ?? []);
  }, [adjustmentLayerEngine, project.adjustmentLayers]);

  const currentTrack = useMemo(() => {
    for (const track of project.timeline.tracks) {
      for (const clip of track.clips) {
        if (clip.id === clipId) {
          return track;
        }
      }
    }
    return null;
  }, [project.timeline.tracks, clipId]);

  const allLayers = project.adjustmentLayers ?? [];
  const trackLayers = useMemo(
    () => currentTrack
      ? allLayers.filter((layer) => layer.trackId === currentTrack.id)
      : [],
    [allLayers, currentTrack],
  );

  const persistLayers = useCallback(
    (engine: import("@openreel/core").AdjustmentLayerEngine) =>
      useProjectStore.getState().executeAction({
        type: "adjustment/setAll",
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        params: { layers: engine.getAllLayers() },
      }),
    [],
  );

  const handleCreateLayer = useCallback(() => {
    if (!adjustmentLayerEngine || !currentTrack) return;

    const currentClip = currentTrack.clips.find((c) => c.id === clipId);
    const startTime = currentClip?.startTime || 0;
    const duration = currentClip?.duration || 5;

    const layer = adjustmentLayerEngine.createAdjustmentLayer(
      currentTrack.id,
      startTime,
      { duration, name: editorMessage("editor.adjustment.defaultName", { count: allLayers.length + 1 }) },
    );

    setExpandedLayer(layer.id);
    void persistLayers(adjustmentLayerEngine);
  }, [adjustmentLayerEngine, currentTrack, clipId, allLayers.length, persistLayers]);

  const handleDeleteLayer = useCallback(
    (layerId: string) => {
      if (!adjustmentLayerEngine) return;

      adjustmentLayerEngine.deleteLayer(layerId);
      if (expandedLayer === layerId) {
        setExpandedLayer(null);
      }

      void useProjectStore.getState().executeAction({
        type: "adjustment/setAll",
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        params: { layers: adjustmentLayerEngine.getAllLayers() },
      });
    },
    [adjustmentLayerEngine, expandedLayer],
  );

  const handleToggleEnabled = useCallback(
    (layerId: string, enabled: boolean) => {
      if (!adjustmentLayerEngine) return;

      adjustmentLayerEngine.setEnabled(layerId, enabled);

      void useProjectStore.getState().executeAction({
        type: "adjustment/setAll",
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        params: { layers: adjustmentLayerEngine.getAllLayers() },
      });
    },
    [adjustmentLayerEngine],
  );

  const handleOpacityChange = useCallback(
    (layerId: string, opacity: number) => {
      if (!adjustmentLayerEngine) return;

      adjustmentLayerEngine.setOpacity(layerId, opacity);

      void useProjectStore.getState().executeAction({
        type: "adjustment/setAll",
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        params: { layers: adjustmentLayerEngine.getAllLayers() },
      });
    },
    [adjustmentLayerEngine],
  );

  const handleBlendModeChange = useCallback(
    (layerId: string, blendMode: BlendMode) => {
      if (!adjustmentLayerEngine) return;

      adjustmentLayerEngine.setBlendMode(layerId, blendMode);
      setShowBlendModes(false);

      void useProjectStore.getState().executeAction({
        type: "adjustment/setAll",
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        params: { layers: adjustmentLayerEngine.getAllLayers() },
      });
    },
    [adjustmentLayerEngine],
  );

  const handleAddEffect = useCallback(
    (layerId: string, effectType: string) => {
      if (!adjustmentLayerEngine) return;

      const preset = EFFECT_PRESETS.find((p) => p.id === effectType);
      if (!preset) return;

      adjustmentLayerEngine.addEffect(layerId, {
        id: `effect_${Date.now()}`,
        ...preset.effect,
      });

      void useProjectStore.getState().executeAction({
        type: "adjustment/setAll",
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        params: { layers: adjustmentLayerEngine.getAllLayers() },
      });
    },
    [adjustmentLayerEngine],
  );

  const handleRemoveEffect = useCallback(
    (layerId: string, effectId: string) => {
      if (!adjustmentLayerEngine) return;

      adjustmentLayerEngine.removeEffect(layerId, effectId);

      void useProjectStore.getState().executeAction({
        type: "adjustment/setAll",
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        params: { layers: adjustmentLayerEngine.getAllLayers() },
      });
    },
    [adjustmentLayerEngine],
  );

  const handleUpdateEffectParameter = useCallback(
    (layerId: string, effectId: string, param: string, value: number) => {
      if (!adjustmentLayerEngine) return;
      const layer = adjustmentLayerEngine.getLayer(layerId);
      const effect = layer?.effects.find((candidate) => candidate.id === effectId);
      if (!effect) return;
      adjustmentLayerEngine.updateEffect(layerId, effectId, {
        params: { ...effect.params, [param]: value },
      });
      void persistLayers(adjustmentLayerEngine);
    },
    [adjustmentLayerEngine, persistLayers],
  );

  const handleToggleEffect = useCallback(
    (layerId: string, effectId: string, enabled: boolean) => {
      if (!adjustmentLayerEngine) return;
      adjustmentLayerEngine.updateEffect(layerId, effectId, { enabled });
      void persistLayers(adjustmentLayerEngine);
    },
    [adjustmentLayerEngine, persistLayers],
  );

  const handleTimingChange = useCallback(
    (layerId: string, key: "startTime" | "duration", value: number) => {
      if (!adjustmentLayerEngine) return;
      adjustmentLayerEngine.updateLayer(layerId, {
        [key]: Math.max(key === "duration" ? 1 / project.settings.frameRate : 0, value),
      });
      void persistLayers(adjustmentLayerEngine);
    },
    [adjustmentLayerEngine, persistLayers, project.settings.frameRate],
  );

  const handleDuplicateLayer = useCallback(
    (layerId: string) => {
      if (!adjustmentLayerEngine) return;

      const duplicate = adjustmentLayerEngine.duplicateLayer(layerId);
      if (duplicate) {
        adjustmentLayerEngine.updateLayer(duplicate.id, { name: editorMessage("editor.adjustment.copyName", { name: adjustmentLayerEngine.getLayer(layerId)?.name ?? "" }) });
        setExpandedLayer(duplicate.id);
      }

      void useProjectStore.getState().executeAction({
        type: "adjustment/setAll",
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        params: { layers: adjustmentLayerEngine.getAllLayers() },
      });
    },
    [adjustmentLayerEngine],
  );

  const renderLayerItem = (layer: AdjustmentLayer) => {
    const isExpanded = expandedLayer === layer.id;
    const selectedBlendMode =
      editorMessage(BLEND_MODES.find((mode) => mode.id === layer.blendMode)?.name ?? "editor.motion.layers.blend.normal");

    return (
      <Card
        key={layer.id}
        variant="muted"
        padding={0}
        className="overflow-hidden"
      >
        <div className="flex items-center gap-1 p-1">
          <button
            type="button"
            aria-label={editorMessage(isExpanded ? "editor.adjustment.collapse" : "editor.adjustment.expand", { name: layer.name })}
            aria-expanded={isExpanded}
            onClick={() => setExpandedLayer(isExpanded ? null : layer.id)}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-md p-1 text-left outline-none transition-colors hover:bg-bg-2 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronRight
              size={12}
              className={`text-fg-3 transition-transform ${
                isExpanded ? "rotate-90" : ""
              }`}
              aria-hidden
            />
            <Layers size={12} className="text-emerald-500" aria-hidden />
            <Text
              type="supporting"
              color="primary"
              className="flex-1 truncate text-[10px]"
            >
              {layer.name}
            </Text>
          </button>
          <IconButton
            label={editorMessage(layer.enabled ? "editor.adjustment.hide" : "editor.adjustment.show")}
            icon={layer.enabled ? <Eye size={12} aria-hidden /> : <EyeOff size={12} aria-hidden />}
            variant="ghost"
            size="sm"
            onClick={() => handleToggleEnabled(layer.id, !layer.enabled)}
            className={layer.enabled ? "text-fg" : "text-fg-3 opacity-50"}
          />
        </div>

        {isExpanded && (
          <div className="px-2 pb-2 space-y-3">
            <PropertySlider
              label={editorMessage("editor.adjustment.opacity")}
              min={0}
              max={100}
              step={1}
              value={layer.opacity * 100}
              onChange={(value: number) =>
                handleOpacityChange(layer.id, value / 100)
              }
              formatValue={(value) => `${Math.round(value)}%`}
            />
            <div className="grid grid-cols-2 gap-2">
              <PropertySlider
                label={editorMessage("editor.adjustment.start")}
                min={0}
                max={Math.max(project.timeline.duration, layer.startTime + layer.duration)}
                step={1 / project.settings.frameRate}
                value={layer.startTime}
                onChange={(value) => handleTimingChange(layer.id, "startTime", value)}
                formatValue={(value) => `${value.toFixed(2)}s`}
              />
              <PropertySlider
                label={editorMessage("editor.adjustment.duration")}
                min={1 / project.settings.frameRate}
                max={Math.max(project.timeline.duration, layer.duration)}
                step={1 / project.settings.frameRate}
                value={layer.duration}
                onChange={(value) => handleTimingChange(layer.id, "duration", value)}
                formatValue={(value) => `${value.toFixed(2)}s`}
              />
            </div>

            <div className="space-y-1.5">
              <Text
                type="supporting"
                color="secondary"
                className="flex items-center gap-1 text-[10px]"
              >
                <Palette size={10} aria-hidden />
                {editorMessage("editor.adjustment.blend")}
              </Text>
              <Popover
                isOpen={showBlendModes}
                onOpenChange={setShowBlendModes}
                placement="below"
                alignment="start"
                width={220}
                label={editorMessage("editor.adjustment.blendLabel")}
                content={
                  <div className="max-h-48 overflow-y-auto p-1.5">
                    {BLEND_MODES.map((mode) => (
                      <ClickableCard
                        key={mode.id}
                        label={editorMessage("editor.adjustment.useBlend", { name: editorMessage(mode.name) })}
                        padding={2}
                        variant={layer.blendMode === mode.id ? "green" : "transparent"}
                        onClick={() => handleBlendModeChange(layer.id, mode.id)}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <Text type="supporting" color="primary">
                            {editorMessage(mode.name)}
                          </Text>
                          <Text
                            type="supporting"
                            color="secondary"
                            className="text-[9px]"
                          >
                            {editorMessage(mode.group)}
                          </Text>
                        </div>
                      </ClickableCard>
                    ))}
                  </div>
                }
              >
                <Button
                  label={selectedBlendMode}
                  variant="secondary"
                  size="sm"
                  endContent={<ChevronDown size={10} aria-hidden />}
                  className="w-full justify-between"
                />
              </Popover>
            </div>

            <div className="space-y-1.5">
              <Text
                type="supporting"
                color="secondary"
                className="flex items-center gap-1 text-[10px]"
              >
                <Droplet size={10} aria-hidden />
                {editorMessage("editor.layers.effects", { count: layer.effects.length })}
              </Text>
              {layer.effects.length > 0 && (
                <div className="space-y-1">
                  {layer.effects.map((effect) => {
                    const preset = EFFECT_PRESETS.find(
                      (candidate) => candidate.effect.type === effect.type,
                    );
                    return (
                      <Card key={effect.id} variant="transparent" padding={2} className="space-y-2 bg-bg-1">
                        <div className="flex items-center justify-between gap-2">
                          <Text type="supporting" color="primary" className="text-[9px] font-semibold">
                            {preset ? editorMessage(preset.name) : effect.type}
                          </Text>
                          <div className="flex items-center gap-0.5">
                            <IconButton
                              label={editorMessage(effect.enabled === false ? "editor.adjustment.enableEffect" : "editor.adjustment.disableEffect", { name: preset ? editorMessage(preset.name) : effect.type })}
                              icon={effect.enabled === false ? <EyeOff size={10} aria-hidden /> : <Eye size={10} aria-hidden />}
                              variant="ghost"
                              size="sm"
                              onClick={() => handleToggleEffect(layer.id, effect.id, effect.enabled === false)}
                              className={effect.enabled === false ? "text-fg-muted" : "text-fg"}
                            />
                            <IconButton
                              label={editorMessage("editor.adjustment.removeEffect", { name: preset ? editorMessage(preset.name) : effect.type })}
                              icon={<Trash2 size={10} aria-hidden />}
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRemoveEffect(layer.id, effect.id)}
                              className="text-red-400"
                            />
                          </div>
                        </div>
                        {preset?.controls.map((control) => {
                          const stored = effect.params?.[control.param];
                          const value = typeof stored === "number" ? stored : control.min;
                          return (
                            <PropertySlider
                              key={control.param}
                              label={editorMessage(control.label)}
                              min={control.min}
                              max={control.max}
                              step={control.step}
                              value={value}
                              onChange={(nextValue) =>
                                handleUpdateEffectParameter(layer.id, effect.id, control.param, nextValue)
                              }
                              formatValue={(nextValue) =>
                                control.format === "percent"
                                  ? `${Math.round(nextValue * 100)}%`
                                  : control.format === "percent-value"
                                    ? `${Math.round(nextValue)}%`
                                  : control.format === "degrees"
                                    ? `${Math.round(nextValue)}°`
                                    : control.format === "pixels"
                                      ? `${nextValue.toFixed(1)}px`
                                      : nextValue.toFixed(control.step < 0.1 ? 2 : 1)
                              }
                            />
                          );
                        })}
                      </Card>
                    );
                  })}
                </div>
              )}
              <div className="grid grid-cols-2 gap-1.5">
                {EFFECT_PRESETS.map((preset) => (
                  <ClickableCard
                    key={preset.id}
                    label={editorMessage("editor.adjustment.addEffect", { name: editorMessage(preset.name) })}
                    onClick={() => handleAddEffect(layer.id, preset.id)}
                    variant="muted"
                    padding={1}
                    className="min-w-0"
                  >
                    <span
                      data-testid={`adjustment-effect-preview-${preset.id}`}
                      className="relative mb-1 block h-8 overflow-hidden rounded-[5px] bg-[linear-gradient(135deg,#22d3ee,#8b5cf6_52%,#fb7185)]"
                    >
                      <span
                        className="absolute inset-y-0 left-1/2 right-0 bg-[linear-gradient(135deg,#22d3ee,#8b5cf6_52%,#fb7185)]"
                        style={{
                          ...adjustmentEffectPreviewStyle(preset.effect.type),
                          backgroundSize: "200% 100%",
                          backgroundPosition: "right center",
                        }}
                      />
                      <span className="absolute inset-y-0 left-1/2 w-px bg-white/70" />
                      <span className="absolute bottom-0.5 left-1 text-[7px] font-bold uppercase text-white/75">{editorMessage("editor.adjustment.before")}</span>
                      <span className="absolute bottom-0.5 right-1 text-[7px] font-bold uppercase text-white/90">{editorMessage("editor.adjustment.effect")}</span>
                    </span>
                    <Text type="supporting" color="primary" className="block truncate text-[9px] font-semibold">
                      {editorMessage(preset.name)}
                    </Text>
                  </ClickableCard>
                ))}
              </div>
            </div>

            <div className="flex gap-1 pt-2 border-t border-border">
              <Button
                label={editorMessage("editor.adjustment.duplicate")}
                icon={<Copy size={10} aria-hidden />}
                variant="secondary"
                size="sm"
                onClick={() => handleDuplicateLayer(layer.id)}
                className="flex-1"
              />
              <Button
                label={editorMessage("editor.adjustment.delete")}
                icon={<Trash2 size={10} aria-hidden />}
                variant="secondary"
                size="sm"
                onClick={() => handleDeleteLayer(layer.id)}
                className="flex-1 text-red-400"
              />
            </div>
          </div>
        )}
      </Card>
    );
  };

  return (
    <div className="space-y-3">
      <Card
        variant="green"
        padding={2}
        className="flex items-center gap-2 border border-primary/30"
      >
        <Layers size={16} className="text-primary" aria-hidden />
        <div className="flex flex-1 flex-col gap-0.5">
          <Text type="body" color="primary" weight="bold" className="block text-[11px]">
            {editorMessage("editor.adjustment.title")}
          </Text>
          <Text type="supporting" color="secondary" className="block text-[9px]">
            {editorMessage("editor.adjustment.description")}
          </Text>
        </div>
      </Card>

      <Button
        label={editorMessage("editor.adjustment.add")}
        icon={<Plus size={14} aria-hidden />}
        variant={currentTrack ? "primary" : "secondary"}
        size="md"
        onClick={handleCreateLayer}
        isDisabled={!currentTrack || !adjustmentLayerEngine}
        className="w-full"
      />

      {trackLayers.length > 0 && (
        <div className="space-y-2">
          <Text type="supporting" color="secondary" weight="bold">
            {editorMessage("editor.layers.tracks", { count: trackLayers.length })}
          </Text>
          <div className="space-y-1.5">{trackLayers.map(renderLayerItem)}</div>
        </div>
      )}

      {allLayers.length > trackLayers.length && (
        <div className="space-y-2 pt-2 border-t border-border">
          <Text type="supporting" color="secondary" weight="bold">
            {editorMessage("editor.adjustment.others")}
          </Text>
          <div className="space-y-1.5">
            {allLayers
              .filter((l) => !trackLayers.some((tl) => tl.id === l.id))
              .map(renderLayerItem)}
          </div>
        </div>
      )}

      <div className="pt-2 border-t border-border">
        <Text type="supporting" color="secondary" className="block text-[9px] text-center">
          {editorMessage("editor.adjustment.help")}
        </Text>
      </div>
    </div>
  );
};

export default AdjustmentLayerSection;
