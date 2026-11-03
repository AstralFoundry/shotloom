import { editorMessage, editorItemCount } from "../../../shotloom-mode";
import React, { useState, useCallback } from "react";
import {
  PARTICLE_PRESETS,
  type ParticlePreset,
  type ParticleEffect,
  type ParticleConfig,
  createEffectFromPreset,
} from "@openreel/core";
import {
  Sparkles,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Play,
} from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftCollapsible as Collapsible } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftNumberInputControl } from "@openreel/ui";
import { ToolcraftSelectControl as Selector } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { PropertySlider } from "./shell/PropertySlider";
import { ColorSelector } from "../../../motion/components/primitives";

const particleTypeKeys = {
  dissolve: "editor.particles.type.dissolve",
  explode: "editor.particles.type.explode",
  implode: "editor.particles.type.implode",
  confetti: "editor.particles.type.confetti",
  dust: "editor.particles.type.dust",
  sparkle: "editor.particles.type.sparkle",
  disintegrate: "editor.particles.type.disintegrate",
  pixelate: "editor.particles.type.pixelate",
  shatter: "editor.particles.type.shatter",
  morph: "editor.particles.type.morph",
} as const;
const particleTypeLabel = (type: ParticleEffect["type"]) => editorMessage(particleTypeKeys[type]);
const particlePresetKeys = {
  "dissolve-soft": "editor.particles.preset.dissolve-soft",
  "explode-burst": "editor.particles.preset.explode-burst",
  "implode-gather": "editor.particles.preset.implode-gather",
  "confetti-celebration": "editor.particles.preset.confetti-celebration",
  "dust-ambient": "editor.particles.preset.dust-ambient",
  "sparkle-magic": "editor.particles.preset.sparkle-magic",
  "disintegrate-thanos": "editor.particles.preset.disintegrate-thanos",
  "pixelate-retro": "editor.particles.preset.pixelate-retro",
  "shatter-glass": "editor.particles.preset.shatter-glass",
  "morph-transform": "editor.particles.preset.morph-transform",
  "fire-trail": "editor.particles.preset.fire-trail",
  "snow-fall": "editor.particles.preset.snow-fall",
} as const;
const particlePresetLabel = (preset: ParticlePreset) => Object.hasOwn(particlePresetKeys, preset.id)
  ? editorMessage(particlePresetKeys[preset.id as keyof typeof particlePresetKeys]) : preset.name;

interface ParticleEffectsSectionProps {
  clipId: string;
  clipDuration: number;
  clipStartTime: number;
  effects: ParticleEffect[];
  onAddEffect: (effect: ParticleEffect) => void;
  onUpdateEffect: (effectId: string, config: Partial<ParticleConfig>) => void;
  onRemoveEffect: (effectId: string) => void;
  onToggleEffect: (effectId: string, enabled: boolean) => void;
  onUpdateTiming: (effectId: string, startTime: number, duration: number) => void;
  onPreviewEffect?: (effectId: string) => void;
}

export const ParticleEffectsSection: React.FC<ParticleEffectsSectionProps> = ({
  clipId,
  clipDuration,
  clipStartTime,
  effects,
  onAddEffect,
  onUpdateEffect,
  onRemoveEffect,
  onToggleEffect,
  onUpdateTiming,
  onPreviewEffect,
}) => {
  const [expandedEffects, setExpandedEffects] = useState<Set<string>>(new Set());
  const [selectedPreset, setSelectedPreset] = useState<string>("");

  const toggleExpanded = useCallback((effectId: string) => {
    setExpandedEffects((prev) => {
      const next = new Set(prev);
      if (next.has(effectId)) {
        next.delete(effectId);
      } else {
        next.add(effectId);
      }
      return next;
    });
  }, []);

  const handleAddEffect = useCallback(() => {
    if (!selectedPreset) return;

    const effectId = `particle-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    const effect = createEffectFromPreset(selectedPreset, effectId, clipId, clipStartTime, clipDuration);

    if (effect) {
      onAddEffect(effect);
      setExpandedEffects((prev) => new Set(prev).add(effectId));
    }
  }, [selectedPreset, clipId, clipStartTime, clipDuration, onAddEffect]);

  const handleConfigChange = useCallback(
    (effectId: string, key: keyof ParticleConfig, value: unknown) => {
      onUpdateEffect(effectId, { [key]: value });
    },
    [onUpdateEffect]
  );

  const handleStartTimeChange = useCallback(
    (effectId: string, effect: ParticleEffect, newRelativeStartTime: number) => {
      const absoluteStartTime = clipStartTime + newRelativeStartTime;
      onUpdateTiming(effectId, absoluteStartTime, effect.duration);
    },
    [clipStartTime, onUpdateTiming]
  );

  const handleDurationChange = useCallback(
    (effectId: string, effect: ParticleEffect, newDuration: number) => {
      onUpdateTiming(effectId, effect.startTime, newDuration);
    },
    [onUpdateTiming]
  );

  const groupedPresets = PARTICLE_PRESETS.reduce(
    (acc, preset) => {
      if (!acc[preset.type]) {
        acc[preset.type] = [];
      }
      acc[preset.type].push(preset);
      return acc;
    },
    {} as Record<string, ParticlePreset[]>
  );

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Selector
          label={editorMessage("editor.particles.preset")}
          isLabelHidden
          size="sm"
          width="100%"
          value={selectedPreset}
          onChange={setSelectedPreset}
          placeholder={editorMessage("editor.particles.selectPreset")}
          options={Object.values(groupedPresets).flatMap((presets) =>
            presets.map((preset) => ({
              label: `${particleTypeLabel(preset.type)} / ${particlePresetLabel(preset)}`,
              value: preset.id,
            })),
          )}
        />
        <Button
          label={editorMessage("editor.particles.add")}
          variant="primary"
          size="sm"
          onClick={handleAddEffect}
          isDisabled={!selectedPreset}
          icon={<Plus size={14} aria-hidden />}
        />
      </div>

      <div className="grid grid-cols-2 gap-2" aria-label={editorMessage("editor.particles.previews")}>
        {PARTICLE_PRESETS.map((preset) => (
          <ParticlePresetCard
            key={preset.id}
            preset={preset}
            selected={selectedPreset === preset.id}
            onSelect={() => setSelectedPreset(preset.id)}
          />
        ))}
      </div>

      {effects.length === 0 ? (
        <div className="text-center py-6 text-fg-3 text-xs">
          <Sparkles size={24} className="mx-auto mb-2 opacity-50" />
          <Text type="supporting" color="secondary" className="block text-xs">
            {editorMessage("editor.particles.empty")}
          </Text>
          <Text type="supporting" color="secondary" className="block mt-1 text-[10px]">
            {editorMessage("editor.particles.emptyHint")}
          </Text>
        </div>
      ) : (
        <div className="max-h-[400px] overflow-y-auto">
          <div className="space-y-2 pr-2">
            {effects.map((effect) => {
              const relativeStartTime = effect.startTime - clipStartTime;
              return (
                <Card
                  key={effect.id}
                  variant="muted"
                  padding={0}
                  className="overflow-hidden border border-border bg-bg-2"
                >
                  <div className="flex items-center gap-2 px-3 py-2">
                    <IconButton
                      label={expandedEffects.has(effect.id) ? editorMessage("editor.particles.collapse") : editorMessage("editor.particles.expand")}
                      onClick={() => toggleExpanded(effect.id)}
                      variant="ghost"
                      size="sm"
                      icon={
                        expandedEffects.has(effect.id) ? (
                          <ChevronDown size={14} aria-hidden />
                        ) : (
                          <ChevronRight size={14} aria-hidden />
                        )
                      }
                    />

                    <Text
                      type="supporting"
                      color="primary"
                      className="flex-1 text-xs font-medium capitalize"
                    >
                      {particleTypeLabel(effect.type)}
                    </Text>

                    {onPreviewEffect && (
                      <IconButton
                        label={editorMessage("editor.particles.preview")}
                        onClick={() => onPreviewEffect(effect.id)}
                        variant="ghost"
                        size="sm"
                        icon={<Play size={12} aria-hidden />}
                        className="text-fg-3 hover:text-primary"
                      />
                    )}

                    <IconButton
                      label={effect.enabled ? editorMessage("editor.particles.disable") : editorMessage("editor.particles.enable")}
                      onClick={() => onToggleEffect(effect.id, !effect.enabled)}
                      variant="ghost"
                      size="sm"
                      icon={effect.enabled ? <Eye size={12} aria-hidden /> : <EyeOff size={12} aria-hidden />}
                      className={
                        effect.enabled
                          ? "text-primary hover:bg-primary/20"
                          : "text-fg-3 hover:bg-bg-elev"
                      }
                    />

                    <IconButton
                      label={editorMessage("editor.particles.remove")}
                      onClick={() => onRemoveEffect(effect.id)}
                      variant="ghost"
                      size="sm"
                      icon={<Trash2 size={12} aria-hidden />}
                      className="text-fg-3 hover:text-red-400"
                    />
                  </div>

                  {expandedEffects.has(effect.id) && (
                    <div className="px-3 pb-3 space-y-3 border-t border-border/50 pt-3">
                      <div className="grid grid-cols-2 gap-3">
                        <ToolcraftNumberInputControl
                          label={editorMessage("editor.particles.start")}
                          size="sm"
                          value={Number(relativeStartTime.toFixed(1))}
                          onChange={(val) => {
                            if (val >= 0 && val < clipDuration) {
                              handleStartTimeChange(effect.id, effect, val);
                            }
                          }}
                          step={0.1}
                          min={0}
                          max={clipDuration}
                          units="s"
                        />
                        <ToolcraftNumberInputControl
                          label={editorMessage("editor.particles.duration")}
                          size="sm"
                          value={Number(effect.duration.toFixed(1))}
                          onChange={(val) => {
                            if (val >= 0.1) {
                              handleDurationChange(effect.id, effect, val);
                            }
                          }}
                          step={0.1}
                          min={0.1}
                          units="s"
                        />
                      </div>

                      <Collapsible
                        defaultIsOpen={false}
                        trigger={
                          <Text type="supporting" color="secondary" className="text-[10px]">
                            {editorMessage("editor.particles.settings")}
                          </Text>
                        }
                      >
                        <div className="pt-2 space-y-3">
                          <PropertySlider
                            label={editorMessage("editor.particles.count")}
                            value={effect.config.particleCount}
                            onChange={(v: number) =>
                              handleConfigChange(effect.id, "particleCount", v)
                            }
                            min={10}
                            max={500}
                            step={10}
                            formatValue={(value) => String(value)}
                          />

                          <PropertySlider
                            label={editorMessage("editor.particles.speed")}
                            value={effect.config.speed}
                            onChange={(v: number) =>
                              handleConfigChange(effect.id, "speed", v)
                            }
                            min={10}
                            max={500}
                            step={10}
                            formatValue={(value) => String(value)}
                          />

                          <PropertySlider
                            label={editorMessage("editor.particles.gravity")}
                            value={effect.config.gravity}
                            onChange={(v: number) =>
                              handleConfigChange(effect.id, "gravity", v)
                            }
                            min={-500}
                            max={500}
                            step={10}
                            formatValue={(value) => String(value)}
                          />

                          <PropertySlider
                            label={editorMessage("editor.particles.emission")}
                            value={effect.config.emissionRate}
                            onChange={(v: number) =>
                              handleConfigChange(effect.id, "emissionRate", v)
                            }
                            min={1}
                            max={200}
                            step={1}
                            formatValue={(value) => String(value)}
                          />

                          <div className="grid grid-cols-2 gap-2">
                            <PropertySlider
                              label={editorMessage("editor.particles.minSize")}
                              value={effect.config.size.min}
                              onChange={(v: number) =>
                                handleConfigChange(effect.id, "size", {
                                  ...effect.config.size,
                                  min: v,
                                })
                              }
                              min={1}
                              max={20}
                              step={1}
                              formatValue={(value) => String(value)}
                            />
                            <PropertySlider
                              label={editorMessage("editor.particles.maxSize")}
                              value={effect.config.size.max}
                              onChange={(v: number) =>
                                handleConfigChange(effect.id, "size", {
                                  ...effect.config.size,
                                  max: v,
                                })
                              }
                              min={1}
                              max={30}
                              step={1}
                              formatValue={(value) => String(value)}
                            />
                          </div>

                          <PropertySlider
                            label={editorMessage("editor.particles.turbulence")}
                            value={effect.config.turbulence}
                            onChange={(v: number) =>
                              handleConfigChange(effect.id, "turbulence", v)
                            }
                            min={0}
                            max={100}
                            step={5}
                            formatValue={(value) => String(value)}
                          />

                          <Selector
                            label={editorMessage("editor.particles.blend")}
                            size="sm"
                            width="100%"
                            value={effect.config.blendMode}
                            onChange={(v) =>
                              handleConfigChange(effect.id, "blendMode", v)
                            }
                            options={[
                              { label: editorMessage("editor.particles.normal"), value: "normal" },
                              { label: editorMessage("editor.particles.additive"), value: "add" },
                              { label: editorMessage("editor.particles.multiply"), value: "multiply" },
                              { label: editorMessage("editor.particles.screen"), value: "screen" },
                            ]}
                          />
                        </div>
                      </Collapsible>

                      <Collapsible
                        defaultIsOpen={false}
                        trigger={
                          <Text type="supporting" color="secondary" className="text-[10px]">
                            {editorMessage("editor.particles.colors", { count: effect.config.colors.length })}
                          </Text>
                        }
                      >
                        <div className="pt-2">
                          <div className="flex flex-wrap gap-1">
                            {effect.config.colors.map((color, idx) => (
                              <ColorSwatch
                                key={idx}
                                color={color}
                                onChange={(newColor) => {
                                  const newColors = [...effect.config.colors];
                                  newColors[idx] = newColor;
                                  handleConfigChange(effect.id, "colors", newColors);
                                }}
                                onRemove={
                                  effect.config.colors.length > 1
                                    ? () => {
                                        const newColors = effect.config.colors.filter((_, i) => i !== idx);
                                        handleConfigChange(effect.id, "colors", newColors);
                                      }
                                    : undefined
                                }
                              />
                            ))}
                            <IconButton
                              label={editorMessage("editor.particles.addColor")}
                              onClick={() => {
                                const newColors = [...effect.config.colors, "#ffffff"];
                                handleConfigChange(effect.id, "colors", newColors);
                              }}
                              variant="ghost"
                              size="sm"
                              icon={<Plus size={12} aria-hidden />}
                              className="border border-dashed border-border text-fg-3 hover:border-primary hover:text-fg"
                            />
                          </div>
                        </div>
                      </Collapsible>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

const ParticlePresetCard: React.FC<{
  preset: ParticlePreset;
  selected: boolean;
  onSelect: () => void;
}> = ({ preset, selected, onSelect }) => {
  const [hovered, setHovered] = useState(false);
  const [progress, setProgress] = useState(0.58);

  React.useEffect(() => {
    if (!hovered) {
      setProgress(0.58);
      return;
    }
    let frame = 0;
    const startedAt = performance.now();
    const animate = (now: number) => {
      setProgress(((now - startedAt) % 1400) / 1400);
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [hovered]);

  return (
    <button
      type="button"
      aria-label={editorMessage("editor.particles.previewPreset", { preset: particlePresetLabel(preset) })}
      aria-pressed={selected}
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`overflow-hidden rounded-lg border p-1.5 text-left transition-colors ${
        selected
          ? "border-primary bg-primary/10"
          : "border-border bg-bg-2 hover:border-primary/60"
      }`}
    >
      <span
        data-testid="particle-preset-preview"
        data-preset-id={preset.id}
        aria-hidden="true"
        className="relative mb-1.5 block h-14 overflow-hidden rounded-md bg-[radial-gradient(circle_at_50%_50%,rgba(124,58,237,.18),transparent_60%),#0f1420]"
      >
        {Array.from({ length: 16 }, (_, index) => {
          const style = particlePreviewStyle(preset, index, progress);
          return (
            <span
              key={index}
              className="absolute block"
              style={style}
            />
          );
        })}
      </span>
      <span className="block truncate text-[9px] font-semibold text-fg">
        {particlePresetLabel(preset)}
      </span>
      <span className="block truncate text-[8px] capitalize text-fg-4">
        {particleTypeLabel(preset.type)} · {editorItemCount("particles", preset.config.particleCount)}
      </span>
    </button>
  );
};

function particlePreviewStyle(
  preset: ParticlePreset,
  index: number,
  progress: number,
): React.CSSProperties {
  const angle = (index / 16) * Math.PI * 2;
  const phase = (progress + index * 0.071) % 1;
  const outward = preset.type === "explode" || preset.type === "shatter";
  const inward = preset.type === "implode" || preset.type === "morph";
  const falling =
    preset.type === "confetti" ||
    preset.id === "snow-fall" ||
    preset.type === "pixelate";
  const radius = outward
    ? phase * 36
    : inward
      ? (1 - phase) * 34
      : 10 + ((index * 7) % 22);
  const x = falling
    ? 8 + ((index * 17) % 86)
    : 50 + Math.cos(angle) * radius;
  const y = falling
    ? -10 + phase * 76
    : 50 + Math.sin(angle) * radius + (preset.id === "fire-trail" ? phase * -22 : 0);
  const size = Math.max(
    2,
    Math.min(9, preset.config.size.min + (index % 4)),
  );
  const color = preset.config.colors[index % preset.config.colors.length] ?? "#ffffff";
  const square = preset.type === "pixelate" || preset.type === "confetti";
  return {
    left: `${x}%`,
    top: `${y}%`,
    width: size,
    height: square ? Math.max(2, size * 0.65) : size,
    borderRadius: square ? 1 : "50%",
    background: color,
    opacity: Math.max(0.18, 1 - phase * 0.72),
    boxShadow:
      preset.config.blendMode === "add" ? `0 0 ${size + 3}px ${color}` : undefined,
    transform: `translate(-50%, -50%) rotate(${phase * 240 + index * 13}deg)`,
  };
}

interface ColorSwatchProps {
  color: string;
  onChange: (color: string) => void;
  onRemove?: () => void;
}

const ColorSwatch: React.FC<ColorSwatchProps> = ({ color, onChange, onRemove }) => {
  return (
    <div className="flex items-center gap-1">
      <ColorSelector
        value={color}
        onChange={onChange}
        label={editorMessage("editor.particles.editColor", { color })}
        showValue={false}
      />
      {onRemove && (
        <IconButton
          label={editorMessage("editor.particles.removeColor")}
          onClick={onRemove}
          variant="ghost"
          size="sm"
          icon={<Trash2 size={12} aria-hidden />}
          className="text-fg-3 hover:text-red-400"
        />
      )}
    </div>
  );
};

export default ParticleEffectsSection;
