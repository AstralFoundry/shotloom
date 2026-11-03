import { editorMessage } from "../../../shotloom-mode";
import React, { useCallback, useMemo } from "react";
import { ToolcraftClickableCard as ClickableCard } from "@openreel/ui";
import { ToolcraftSelectControl as Selector } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { PropertySlider } from "./shell/PropertySlider";
import { useProjectStore } from "../../../stores/project-store";
import type { GraphicAnimation, GraphicAnimationType } from "@openreel/core";
import { SVG_ANIMATION_PRESETS } from "@openreel/core";
import { ColorSelector } from "../../../motion/components/primitives";

const ColorField: React.FC<{
  label: string;
  value: string;
  onChange: (color: string) => void;
}> = ({ label, value, onChange }) => (
  <div className="flex items-center justify-between gap-2">
    <Text type="supporting" color="secondary" className="text-[10px]">
      {label}
    </Text>
    <div className="max-w-[170px]">
      <ColorSelector
        label={editorMessage("editor.svgControls.selectColor", { label })}
        value={value}
        onChange={onChange}
      />
    </div>
  </div>
);

const ANIMATION_LABELS = {
  "none": "editor.svgControls.preset.none",
  "fade": "editor.svgControls.preset.fade",
  "slide-left": "editor.svgControls.preset.slide-left",
  "slide-right": "editor.svgControls.preset.slide-right",
  "slide-up": "editor.svgControls.preset.slide-up",
  "slide-down": "editor.svgControls.preset.slide-down",
  "scale": "editor.svgControls.preset.scale",
  "rotate": "editor.svgControls.preset.rotate",
  "bounce": "editor.svgControls.preset.bounce",
  "pop": "editor.svgControls.preset.pop",
  "draw": "editor.svgControls.preset.draw",
  "wipe-left": "editor.svgControls.preset.wipe-left",
  "wipe-right": "editor.svgControls.preset.wipe-right",
  "wipe-up": "editor.svgControls.preset.wipe-up",
  "wipe-down": "editor.svgControls.preset.wipe-down",
  "reveal-center": "editor.svgControls.preset.reveal-center",
  "reveal-edges": "editor.svgControls.preset.reveal-edges",
  "elastic": "editor.svgControls.preset.elastic",
  "flip-horizontal": "editor.svgControls.preset.flip-horizontal",
  "flip-vertical": "editor.svgControls.preset.flip-vertical",
} as const satisfies Record<GraphicAnimationType, string>;

const COLOR_MODE_LABELS = {
  none: "editor.svgControls.mode.none",
  tint: "editor.svgControls.mode.tint",
  replace: "editor.svgControls.mode.replace",
} as const;

interface SVGSectionProps {
  clipId: string;
}

export const SVGSection: React.FC<SVGSectionProps> = ({ clipId }) => {
  const { getSVGClipById, updateSVGClip, project } = useProjectStore();

  const svgClip = useMemo(
    () => getSVGClipById(clipId),
    [clipId, getSVGClipById, project.modifiedAt],
  );

  const colorStyle = svgClip?.colorStyle || {
    colorMode: "none" as const,
    tintColor: "#ffffff",
    tintOpacity: 1,
  };

  const entryAnimation = svgClip?.entryAnimation;
  const exitAnimation = svgClip?.exitAnimation;

  const handleColorModeChange = useCallback(
    (mode: "none" | "tint" | "replace") => {
      if (!svgClip) {
        console.warn(`[SVGSection] No SVG clip found for ${clipId}`);
        return;
      }
      const newColorStyle = {
        ...colorStyle,
        colorMode: mode,
      };
      updateSVGClip(clipId, {
        colorStyle: newColorStyle,
      });
    },
    [clipId, svgClip, colorStyle, updateSVGClip],
  );

  const handleTintColorChange = useCallback(
    (color: string) => {
      if (!svgClip) return;
      updateSVGClip(clipId, {
        colorStyle: {
          ...colorStyle,
          tintColor: color,
        },
      });
    },
    [clipId, svgClip, colorStyle, updateSVGClip],
  );

  const handleTintOpacityChange = useCallback(
    (opacity: number) => {
      if (!svgClip) return;
      updateSVGClip(clipId, {
        colorStyle: {
          ...colorStyle,
          tintOpacity: opacity,
        },
      });
    },
    [clipId, svgClip, colorStyle, updateSVGClip],
  );

  const handleEntryAnimationChange = useCallback(
    (type: GraphicAnimationType) => {
      if (!svgClip) {
        console.warn(`[SVGSection] No SVG clip found for ${clipId}`);
        return;
      }
      const animation: GraphicAnimation = {
        type,
        duration: entryAnimation?.duration || 0.5,
        easing: entryAnimation?.easing || "ease-out",
      };
      updateSVGClip(clipId, { entryAnimation: animation });
    },
    [clipId, svgClip, entryAnimation, updateSVGClip],
  );

  const handleExitAnimationChange = useCallback(
    (type: GraphicAnimationType) => {
      if (!svgClip) return;
      const animation: GraphicAnimation = {
        type,
        duration: exitAnimation?.duration || 0.5,
        easing: exitAnimation?.easing || "ease-out",
      };
      updateSVGClip(clipId, { exitAnimation: animation });
    },
    [clipId, svgClip, exitAnimation, updateSVGClip],
  );

  const handleEntryDurationChange = useCallback(
    (duration: number) => {
      if (!svgClip || !entryAnimation) return;
      updateSVGClip(clipId, {
        entryAnimation: { ...entryAnimation, duration },
      });
    },
    [clipId, svgClip, entryAnimation, updateSVGClip],
  );

  const handleExitDurationChange = useCallback(
    (duration: number) => {
      if (!svgClip || !exitAnimation) return;
      updateSVGClip(clipId, {
        exitAnimation: { ...exitAnimation, duration },
      });
    },
    [clipId, svgClip, exitAnimation, updateSVGClip],
  );

  if (!svgClip) {
    return (
      <Text type="supporting" color="secondary" className="py-8 text-center text-xs">
        {editorMessage("editor.svgControls.empty")}
      </Text>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Text type="supporting" color="secondary" className="text-[10px]">
            {editorMessage("editor.svgControls.mode")}
          </Text>
          <div className="flex gap-1">
            {(["none", "tint", "replace"] as const).map((mode) => (
              <ClickableCard
                key={mode}
                label={editorMessage("editor.svgControls.setMode", { mode: editorMessage(COLOR_MODE_LABELS[mode]) })}
                onClick={() => handleColorModeChange(mode)}
                className={`px-2 py-1 text-[9px] rounded capitalize transition-colors ${
                  colorStyle.colorMode === mode
                    ? "bg-primary text-white"
                    : "bg-bg-2 border border-border text-fg-2 hover:text-fg"
                }`}
              >
                {editorMessage(COLOR_MODE_LABELS[mode])}
              </ClickableCard>
            ))}
          </div>
        </div>

        {colorStyle.colorMode !== "none" && (
          <>
            <ColorField
              label={editorMessage("editor.svgControls.color")}
              value={colorStyle.tintColor || "#ffffff"}
              onChange={handleTintColorChange}
            />
            <PropertySlider
              label={editorMessage("editor.svgControls.opacity")}
              value={colorStyle.tintOpacity || 1}
              onChange={handleTintOpacityChange}
              min={0}
              max={1}
              step={0.1}
              formatValue={(value) => `${Math.round(value * 100)}%`}
            />
          </>
        )}
      </div>

      <div className="space-y-3">
        <Selector
          label={editorMessage("editor.svgControls.entry")}
          size="sm"
          width="100%"
          value={entryAnimation?.type || "none"}
          options={SVG_ANIMATION_PRESETS.map((preset) => ({
            label: editorMessage(ANIMATION_LABELS[preset.id]),
            value: preset.id,
          }))}
          onChange={(value) =>
            handleEntryAnimationChange(value as GraphicAnimationType)
          }
        />

        {entryAnimation && entryAnimation.type !== "none" && (
          <PropertySlider
            label={editorMessage("editor.svgControls.duration")}
            value={entryAnimation.duration}
            onChange={handleEntryDurationChange}
            min={0.1}
            max={3}
            step={0.1}
            formatValue={(value) => `${value.toFixed(1)}s`}
          />
        )}
      </div>

      <div className="space-y-4">
        <Selector
          label={editorMessage("editor.svgControls.exit")}
          size="sm"
          width="100%"
          value={exitAnimation?.type || "none"}
          options={SVG_ANIMATION_PRESETS.map((preset) => ({
            label: editorMessage(ANIMATION_LABELS[preset.id]),
            value: preset.id,
          }))}
          onChange={(value) =>
            handleExitAnimationChange(value as GraphicAnimationType)
          }
        />

        {exitAnimation && exitAnimation.type !== "none" && (
          <PropertySlider
            label={editorMessage("editor.svgControls.duration")}
            value={exitAnimation.duration}
            onChange={handleExitDurationChange}
            min={0.1}
            max={3}
            step={0.1}
            formatValue={(value) => `${value.toFixed(1)}s`}
          />
        )}
      </div>
    </div>
  );
};
