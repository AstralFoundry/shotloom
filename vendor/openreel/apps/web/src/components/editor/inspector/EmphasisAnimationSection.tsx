import { editorMessage } from "../../../shotloom-mode";
import React, { useCallback, useMemo } from "react";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftClickableCard as ClickableCard } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { RotateCcw, Target, Zap, Clock } from "@/icons/lucide-compat";
import { MockSlider, MockToggle } from "./shell/InspectorControls";
import { useProjectStore } from "../../../stores/project-store";
import { useEngineStore } from "../../../stores/engine-store";
import type { EmphasisAnimation, EmphasisAnimationType } from "@openreel/core";

const formatTime = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = (seconds % 60).toFixed(1);
  return mins > 0 ? `${mins}:${secs.padStart(4, "0")}` : editorMessage("editor.emphasis.seconds", { value: secs });
};

interface EmphasisAnimationSectionProps {
  clipId: string;
}

const EMPHASIS_ANIMATIONS = [
  {
    category: "editor.emphasis.category.attention",
    animations: [
      {
        type: "pulse",
        label: "editor.emphasis.preset.pulse.name",
        description: "editor.emphasis.preset.pulse.description",
      },
      {
        type: "heartbeat",
        label: "editor.emphasis.preset.heartbeat.name",
        description: "editor.emphasis.preset.heartbeat.description",
      },
      {
        type: "flash",
        label: "editor.emphasis.preset.flash.name",
        description: "editor.emphasis.preset.flash.description",
      },
      {
        type: "glow",
        label: "editor.emphasis.preset.glow.name",
        description: "editor.emphasis.preset.glow.description",
      },
      {
        type: "breathe",
        label: "editor.emphasis.preset.breathe.name",
        description: "editor.emphasis.preset.breathe.description",
      },
    ],
  },
  {
    category: "editor.emphasis.category.movement",
    animations: [
      {
        type: "shake",
        label: "editor.emphasis.preset.shake.name",
        description: "editor.emphasis.preset.shake.description",
      },
      {
        type: "bounce",
        label: "editor.emphasis.preset.bounce.name",
        description: "editor.emphasis.preset.bounce.description",
      },
      {
        type: "float",
        label: "editor.emphasis.preset.float.name",
        description: "editor.emphasis.preset.float.description",
      },
      {
        type: "vibrate",
        label: "editor.emphasis.preset.vibrate.name",
        description: "editor.emphasis.preset.vibrate.description",
      },
      {
        type: "wave",
        label: "editor.emphasis.preset.wave.name",
        description: "editor.emphasis.preset.wave.description",
      },
    ],
  },
  {
    category: "editor.emphasis.category.rotation",
    animations: [
      {
        type: "spin",
        label: "editor.emphasis.preset.spin.name",
        description: "editor.emphasis.preset.spin.description",
      },
      {
        type: "swing",
        label: "editor.emphasis.preset.swing.name",
        description: "editor.emphasis.preset.swing.description",
      },
      {
        type: "wobble",
        label: "editor.emphasis.preset.wobble.name",
        description: "editor.emphasis.preset.wobble.description",
      },
      {
        type: "tilt",
        label: "editor.emphasis.preset.tilt.name",
        description: "editor.emphasis.preset.tilt.description",
      },
      {
        type: "tada",
        label: "editor.emphasis.preset.tada.name",
        description: "editor.emphasis.preset.tada.description",
      },
    ],
  },
  {
    category: "editor.emphasis.category.distortion",
    animations: [
      {
        type: "jello",
        label: "editor.emphasis.preset.jello.name",
        description: "editor.emphasis.preset.jello.description",
      },
      {
        type: "rubber-band",
        label: "editor.emphasis.preset.rubber-band.name",
        description: "editor.emphasis.preset.rubber-band.description",
      },
      {
        type: "flicker",
        label: "editor.emphasis.preset.flicker.name",
        description: "editor.emphasis.preset.flicker.description",
      },
    ],
  },
  {
    category: "editor.emphasis.category.zoomPan",
    animations: [
      {
        type: "zoom-pulse",
        label: "editor.emphasis.preset.zoom-pulse.name",
        description: "editor.emphasis.preset.zoom-pulse.description",
      },
      {
        type: "focus-zoom",
        label: "editor.emphasis.preset.focus-zoom.name",
        description: "editor.emphasis.preset.focus-zoom.description",
      },
      {
        type: "ken-burns",
        label: "editor.emphasis.preset.ken-burns.name",
        description: "editor.emphasis.preset.ken-burns.description",
      },
      {
        type: "pan-left",
        label: "editor.emphasis.preset.pan-left.name",
        description: "editor.emphasis.preset.pan-left.description",
      },
      {
        type: "pan-right",
        label: "editor.emphasis.preset.pan-right.name",
        description: "editor.emphasis.preset.pan-right.description",
      },
      {
        type: "pan-up",
        label: "editor.emphasis.preset.pan-up.name",
        description: "editor.emphasis.preset.pan-up.description",
      },
      {
        type: "pan-down",
        label: "editor.emphasis.preset.pan-down.name",
        description: "editor.emphasis.preset.pan-down.description",
      },
    ],
  },
] as const satisfies readonly {
  category: string;
  animations: readonly {
    type: EmphasisAnimationType;
    label: string;
    description: string;
  }[];
}[];

const DEFAULT_EMPHASIS: EmphasisAnimation = {
  type: "none",
  speed: 1,
  intensity: 1,
  loop: true,
};

const Slider: React.FC<{
  ariaLabel: string;
  min: number;
  max: number;
  step?: number;
  value: number[];
  onValueChange: (value: number[]) => void;
}> = ({ ariaLabel, min, max, step = 1, value, onValueChange }) => (
  <MockSlider
    ariaLabel={ariaLabel}
    min={min}
    max={max}
    step={step}
    value={value[0]}
    onChange={(nextValue: number) => onValueChange([nextValue])}
  />
);

const ValueText: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Text
    type="supporting"
    color="primary"
    className="font-mono text-[10px] bg-bg-2 px-1.5 py-0.5 rounded border border-border"
  >
    {children as any}
  </Text>
);

export const EmphasisAnimationSection: React.FC<
  EmphasisAnimationSectionProps
> = ({ clipId }) => {
  const { project, updateClipEmphasisAnimation } = useProjectStore();
  const getTitleEngine = useEngineStore((state) => state.getTitleEngine);
  const getGraphicsEngine = useEngineStore((state) => state.getGraphicsEngine);

  const clipDuration = useMemo((): number => {
    const clip = project.timeline.tracks
      .flatMap((t) => t.clips)
      .find((c) => c.id === clipId);
    if (clip) return clip.duration;

    const titleEngine = getTitleEngine();
    const textClip = titleEngine?.getTextClip(clipId);
    if (textClip) return textClip.duration;

    const graphicsEngine = getGraphicsEngine();
    const shapeClip = graphicsEngine?.getShapeClip(clipId);
    if (shapeClip) return shapeClip.duration;

    const svgClip = graphicsEngine?.getSVGClip(clipId);
    if (svgClip) return svgClip.duration;

    const stickerClip = graphicsEngine?.getStickerClip(clipId);
    if (stickerClip) return stickerClip.duration;

    return 5;
  }, [
    clipId,
    project.timeline.tracks,
    getTitleEngine,
    getGraphicsEngine,
    project.modifiedAt,
  ]);

  const currentAnimation = useMemo((): EmphasisAnimation => {
    const clip = project.timeline.tracks
      .flatMap((t) => t.clips)
      .find((c) => c.id === clipId);

    if (clip?.emphasisAnimation) {
      return clip.emphasisAnimation;
    }

    const titleEngine = getTitleEngine();
    const textClip = titleEngine?.getTextClip(clipId);
    if (textClip?.emphasisAnimation) {
      return textClip.emphasisAnimation;
    }

    const graphicsEngine = getGraphicsEngine();
    const shapeClip = graphicsEngine?.getShapeClip(clipId);
    if (shapeClip?.emphasisAnimation) {
      return shapeClip.emphasisAnimation;
    }

    const svgClip = graphicsEngine?.getSVGClip(clipId);
    if (svgClip?.emphasisAnimation) {
      return svgClip.emphasisAnimation;
    }

    const stickerClip = graphicsEngine?.getStickerClip(clipId);
    if (stickerClip?.emphasisAnimation) {
      return stickerClip.emphasisAnimation;
    }

    return DEFAULT_EMPHASIS;
  }, [
    clipId,
    project.timeline.tracks,
    getTitleEngine,
    getGraphicsEngine,
    project.modifiedAt,
  ]);

  const handleAnimationChange = useCallback(
    (updates: Partial<EmphasisAnimation>) => {
      const newAnimation = { ...currentAnimation, ...updates };
      updateClipEmphasisAnimation(clipId, newAnimation);
    },
    [clipId, currentAnimation, updateClipEmphasisAnimation],
  );

  const handleTypeChange = useCallback(
    (type: EmphasisAnimationType) => {
      if (type === "focus-zoom") {
        handleAnimationChange({
          type,
          focusPoint: { x: 0.5, y: 0.5 },
          zoomScale: 1.5,
          holdDuration: 0.3,
          loop: false,
        });
      } else if (type === "ken-burns") {
        handleAnimationChange({ type, loop: false });
      } else {
        handleAnimationChange({ type });
      }
    },
    [handleAnimationChange],
  );

  const handleReset = useCallback(() => {
    handleAnimationChange(DEFAULT_EMPHASIS);
  }, [handleAnimationChange]);

  const selectedAnimation = EMPHASIS_ANIMATIONS.flatMap<(typeof EMPHASIS_ANIMATIONS)[number]["animations"][number]>(
    (cat) => cat.animations,
  ).find((a) => a.type === currentAnimation.type);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <Button
          label={editorMessage("editor.emphasis.none")}
          variant={currentAnimation.type === "none" ? "primary" : "secondary"}
          size="sm"
          onClick={() => handleTypeChange("none")}
          className={`py-2 rounded-lg text-[10px] font-medium transition-all ${
            currentAnimation.type === "none"
              ? "bg-primary text-white"
              : "bg-bg-2 border border-border text-fg-2 hover:text-fg"
          }`}
        />
        <Button
          label={editorMessage("editor.emphasis.reset")}
          icon={<RotateCcw size={10} />}
          variant="secondary"
          size="sm"
          onClick={handleReset}
          className="py-2 rounded-lg text-[10px] font-medium bg-bg-2 border border-border text-fg-2 hover:text-fg transition-all flex items-center justify-center gap-1"
        />
      </div>

      {EMPHASIS_ANIMATIONS.map((category) => (
        <div key={category.category}>
          <Text type="supporting" color="secondary" className="mb-2 block text-[10px] font-medium">
            {editorMessage(category.category)}
          </Text>
          <div className="grid grid-cols-2 gap-1.5">
            {category.animations.map((anim) => (
              <ClickableCard
                key={anim.type}
                label={editorMessage(anim.label)}
                onClick={() => handleTypeChange(anim.type)}
                className={`py-2 px-2 rounded-lg text-[10px] transition-all text-left ${
                  currentAnimation.type === anim.type
                    ? "bg-primary text-white"
                    : "bg-bg-2 border border-border text-fg-2 hover:text-fg hover:border-primary/50"
                  }`}
              >
                {editorMessage(anim.label)}
              </ClickableCard>
            ))}
          </div>
        </div>
      ))}

      {currentAnimation.type !== "none" && (
        <>
          <div className="pt-3 border-t border-border space-y-3">
            {selectedAnimation && (
              <Text type="supporting" color="secondary" className="text-[10px] italic">
                {editorMessage(selectedAnimation.description)}
              </Text>
            )}

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Text type="supporting" color="secondary" className="text-[10px]">
                  {editorMessage("editor.emphasis.speed")}
                </Text>
                <ValueText>
                  {currentAnimation.speed.toFixed(1)}x
                </ValueText>
              </div>
              <Slider ariaLabel={editorMessage("editor.emphasis.speed")}
                min={0.1}
                max={3}
                step={0.1}
                value={[currentAnimation.speed]}
                onValueChange={(value) =>
                  handleAnimationChange({ speed: value[0] })
                }
              />
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Text type="supporting" color="secondary" className="text-[10px]">
                  {editorMessage("editor.emphasis.intensity")}
                </Text>
                <ValueText>
                  {Math.round(currentAnimation.intensity * 100)}%
                </ValueText>
              </div>
              <Slider ariaLabel={editorMessage("editor.emphasis.intensity")}
                min={0.1}
                max={2}
                step={0.1}
                value={[currentAnimation.intensity]}
                onValueChange={(value) =>
                  handleAnimationChange({
                    intensity: value[0],
                  })
                }
              />
            </div>

            <div className="flex items-center justify-between">
              <Text type="supporting" color="secondary" className="text-[10px]">
                {editorMessage("editor.emphasis.loop")}
              </Text>
              <MockToggle
                ariaLabel={editorMessage("editor.emphasis.loop")}
                checked={currentAnimation.loop}
                onChange={() =>
                  handleAnimationChange({ loop: !currentAnimation.loop })
                }
              />
            </div>
          </div>

          <div className="pt-3 border-t border-border space-y-3">
            <div className="flex items-center gap-2 text-primary">
              <Clock size={12} />
              <Text type="supporting" className="text-[10px] font-medium text-primary">
                {editorMessage("editor.emphasis.timing")}
              </Text>
              <Text type="supporting" color="secondary" className="ml-auto text-[9px]">
                {editorMessage("editor.emphasis.clipTime", { time: formatTime(clipDuration) })}
              </Text>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Text type="supporting" color="secondary" className="text-[10px]">
                  {editorMessage("editor.emphasis.start")}
                </Text>
                <ValueText>
                  {formatTime(currentAnimation.startTime ?? 0)}
                </ValueText>
              </div>
              <Slider ariaLabel={editorMessage("editor.emphasis.start")}
                min={0}
                max={clipDuration}
                step={0.1}
                value={[currentAnimation.startTime ?? 0]}
                onValueChange={(value) =>
                  handleAnimationChange({
                    startTime: value[0],
                  })
                }
              />
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Text type="supporting" color="secondary" className="text-[10px]">
                  {editorMessage("editor.emphasis.duration")}
                </Text>
                <ValueText>
                  {currentAnimation.animationDuration
                    ? formatTime(currentAnimation.animationDuration)
                    : editorMessage("editor.emphasis.fullClip")}
                </ValueText>
              </div>
              <Slider ariaLabel={editorMessage("editor.emphasis.duration")}
                min={0}
                max={clipDuration - (currentAnimation.startTime ?? 0)}
                step={0.1}
                value={[
                  currentAnimation.animationDuration ??
                  clipDuration - (currentAnimation.startTime ?? 0)
                ]}
                onValueChange={(value) => {
                  const val = value[0];
                  handleAnimationChange({
                    animationDuration: val > 0 ? val : undefined,
                  });
                }}
              />
              <div className="flex justify-between text-[9px] text-fg-3">
                <Text as="span" type="supporting" color="secondary">
                  {formatTime(0)}
                </Text>
                <Button
                  label={editorMessage("editor.emphasis.resetTiming")}
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    handleAnimationChange({
                      startTime: 0,
                      animationDuration: undefined,
                    })
                  }
                  className="text-primary hover:underline"
                />
                <Text as="span" type="supporting" color="secondary">
                  {formatTime(clipDuration - (currentAnimation.startTime ?? 0))}
                </Text>
              </div>
            </div>
          </div>

          {currentAnimation.type === "focus-zoom" && (
            <div className="pt-3 border-t border-border space-y-3">
            <div className="flex items-center gap-2 text-primary">
              <Target size={12} />
              <Text type="supporting" className="text-[10px] font-medium text-primary">
                {editorMessage("editor.emphasis.focusSettings")}
              </Text>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                  <Text type="supporting" color="secondary" className="text-[10px]">
                    {editorMessage("editor.emphasis.zoomScale")}
                  </Text>
                  <ValueText>
                    {(currentAnimation.zoomScale || 1.5).toFixed(1)}x
                  </ValueText>
                </div>
                <Slider ariaLabel={editorMessage("editor.emphasis.zoomScale")}
                  min={1.1}
                  max={3}
                  step={0.1}
                  value={[currentAnimation.zoomScale || 1.5]}
                  onValueChange={(value) =>
                    handleAnimationChange({
                      zoomScale: value[0],
                    })
                  }
                />
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Text type="supporting" color="secondary" className="text-[10px]">
                    {editorMessage("editor.emphasis.hold")}
                  </Text>
                  <ValueText>
                    {((currentAnimation.holdDuration || 0.3) * 100).toFixed(0)}%
                  </ValueText>
                </div>
                <Slider ariaLabel={editorMessage("editor.emphasis.hold")}
                  min={0}
                  max={1}
                  step={0.05}
                  value={[currentAnimation.holdDuration || 0.3]}
                  onValueChange={(value) =>
                    handleAnimationChange({
                      holdDuration: value[0],
                    })
                  }
                />
              </div>

              <div className="space-y-2">
                <Text type="supporting" color="secondary" className="text-[10px]">
                  {editorMessage("editor.emphasis.focus")}
                </Text>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Text type="supporting" color="secondary" className="text-[9px]">
                      {editorMessage("editor.emphasis.focusX")}
                    </Text>
                    <Slider ariaLabel={editorMessage("editor.emphasis.focusX")}
                      min={0}
                      max={1}
                      step={0.05}
                      value={[currentAnimation.focusPoint?.x || 0.5]}
                      onValueChange={(value) =>
                        handleAnimationChange({
                          focusPoint: {
                            x: value[0],
                            y: currentAnimation.focusPoint?.y || 0.5,
                          },
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Text type="supporting" color="secondary" className="text-[9px]">
                      {editorMessage("editor.emphasis.focusY")}
                    </Text>
                    <Slider ariaLabel={editorMessage("editor.emphasis.focusY")}
                      min={0}
                      max={1}
                      step={0.05}
                      value={[currentAnimation.focusPoint?.y || 0.5]}
                      onValueChange={(value) =>
                        handleAnimationChange({
                          focusPoint: {
                            x: currentAnimation.focusPoint?.x || 0.5,
                            y: value[0],
                          },
                        })
                      }
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-1 mt-2">
                  {([
                    { x: 0, y: 0, label: "editor.emphasis.position.TL" },
                    { x: 0.5, y: 0, label: "editor.emphasis.position.TC" },
                    { x: 1, y: 0, label: "editor.emphasis.position.TR" },
                    { x: 0, y: 0.5, label: "editor.emphasis.position.ML" },
                    { x: 0.5, y: 0.5, label: "editor.emphasis.position.C" },
                    { x: 1, y: 0.5, label: "editor.emphasis.position.MR" },
                    { x: 0, y: 1, label: "editor.emphasis.position.BL" },
                    { x: 0.5, y: 1, label: "editor.emphasis.position.BC" },
                    { x: 1, y: 1, label: "editor.emphasis.position.BR" },
                  ] as const).map((preset) => (
                    <ClickableCard
                      key={preset.label}
                      label={editorMessage("editor.emphasis.setFocus", { position: editorMessage(preset.label) })}
                      onClick={() =>
                        handleAnimationChange({
                          focusPoint: { x: preset.x, y: preset.y },
                        })
                      }
                      className={`py-1.5 rounded text-[9px] transition-all ${
                        currentAnimation.focusPoint?.x === preset.x &&
                        currentAnimation.focusPoint?.y === preset.y
                          ? "bg-primary text-white"
                        : "bg-bg-2 border border-border text-fg-3 hover:text-fg"
                      }`}
                    >
                      {editorMessage(preset.label)}
                    </ClickableCard>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      <div className="pt-3 border-t border-border">
        <div className="flex items-center gap-2 text-fg-3">
          <Zap size={10} />
          <Text type="supporting" color="secondary" className="text-[9px]">
            {editorMessage("editor.emphasis.help")}
          </Text>
        </div>
      </div>
    </div>
  );
};

export default EmphasisAnimationSection;
