import { editorMessage } from "../../../shotloom-mode";
import React, { useCallback, useMemo, useState } from "react";
import { Search } from "@/icons/lucide-compat";
import { ToolcraftClickableCard as ClickableCard } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { ToolcraftTextInputControl } from "@openreel/ui";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { toast } from "../../../stores/notification-store";
import type {
  VideoEffectType,
} from "../../../bridges/effects-bridge";
import type { Clip, TransitionType } from "@openreel/core";
import { getTransitionBridge } from "../../../bridges/transition-bridge";
import { serializeEditorEffectDropPayload } from "../timeline/effect-drop";

// ─── Effect & Transition catalogs ──────────────────────────────────
// Each item ships with a small CSS recipe used to animate the live
// preview thumbnail. The thumbnail itself comes from the user's
// currently-selected clip when available, falling back to a gradient.

export type EffectCategory =
  | "Basic"
  | "Color"
  | "Blur"
  | "Creative"
  | "Stylize";
const effectCategoryKeys = { "All": "editor.effectCategory.All", "Basic": "editor.effectCategory.Basic", "Color": "editor.effectCategory.Color", "Blur": "editor.effectCategory.Blur", "Creative": "editor.effectCategory.Creative", "Stylize": "editor.effectCategory.Stylize" } as const;
export function editorEffectCategoryLabel(category: EffectCategory | "All"): string {
  return editorMessage(effectCategoryKeys[category]);
}

type EffectCategoryFilter = "All" | EffectCategory;

export interface EditorEffectPreviewDef {
  id?: string;
  type: VideoEffectType;
  label: string;
  description: string;
  category: EffectCategory;
  params?: Record<string, unknown>;
  /** Returns a CSS filter / transform / opacity string for the preview
   *  given an animation progress p in [0, 1] (or a paused 0.5 hover state). */
  previewStyle: (p: number) => React.CSSProperties;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const EDITOR_EFFECT_PREVIEWS: EditorEffectPreviewDef[] = [
  {
    type: "brightness",
    get label() { return editorMessage("editor.effectCatalog.brightness.name"); },
    get description() { return editorMessage("editor.effectCatalog.brightness.description"); },
    category: "Basic",
    previewStyle: (p) => ({ filter: `brightness(${lerp(0.9, 1.6, p)})` }),
  },
  {
    type: "contrast",
    get label() { return editorMessage("editor.effectCatalog.contrast.name"); },
    get description() { return editorMessage("editor.effectCatalog.contrast.description"); },
    category: "Basic",
    previewStyle: (p) => ({ filter: `contrast(${lerp(0.8, 1.8, p)})` }),
  },
  {
    type: "saturation",
    get label() { return editorMessage("editor.effectCatalog.saturation.name"); },
    get description() { return editorMessage("editor.effectCatalog.saturation.description"); },
    category: "Basic",
    previewStyle: (p) => ({ filter: `saturate(${lerp(0.5, 2.0, p)})` }),
  },
  {
    type: "grayscale",
    get label() { return editorMessage("editor.effectCatalog.grayscale.name"); },
    get description() { return editorMessage("editor.effectCatalog.grayscale.description"); },
    category: "Color",
    previewStyle: (p) => ({ filter: `grayscale(${p})` }),
  },
  {
    type: "sepia",
    get label() { return editorMessage("editor.effectCatalog.sepia.name"); },
    get description() { return editorMessage("editor.effectCatalog.sepia.description"); },
    category: "Color",
    previewStyle: (p) => ({ filter: `sepia(${p})` }),
  },
  {
    type: "invert",
    get label() { return editorMessage("editor.effectCatalog.invert.name"); },
    get description() { return editorMessage("editor.effectCatalog.invert.description"); },
    category: "Creative",
    previewStyle: (p) => ({ filter: `invert(${p})` }),
  },
  {
    type: "tonal",
    get label() { return editorMessage("editor.effectCatalog.tonal-balance.name"); },
    get description() { return editorMessage("editor.effectCatalog.tonal-balance.description"); },
    category: "Basic",
    previewStyle: (p) => ({
      filter: `brightness(${lerp(0.92, 1.14, p)}) contrast(${lerp(0.9, 1.35, p)})`,
    }),
  },
  {
    type: "temperature",
    get label() { return editorMessage("editor.effectCatalog.temperature.name"); },
    get description() { return editorMessage("editor.effectCatalog.temperature.description"); },
    category: "Color",
    previewStyle: (p) => ({
      filter: `sepia(${lerp(0, 0.6, p)}) hue-rotate(${lerp(-12, 12, p)}deg)`,
    }),
  },
  {
    type: "tint",
    get label() { return editorMessage("editor.effectCatalog.tint.name"); },
    get description() { return editorMessage("editor.effectCatalog.tint.description"); },
    category: "Color",
    previewStyle: (p) => ({
      filter: `hue-rotate(${lerp(0, 60, p)}deg)`,
    }),
  },
  {
    type: "hue",
    get label() { return editorMessage("editor.effectCatalog.hue.name"); },
    get description() { return editorMessage("editor.effectCatalog.hue.description"); },
    category: "Color",
    previewStyle: (p) => ({
      filter: `hue-rotate(${lerp(0, 360, p)}deg)`,
    }),
  },
  {
    type: "blur",
    get label() { return editorMessage("editor.effectCatalog.blur.name"); },
    get description() { return editorMessage("editor.effectCatalog.blur.description"); },
    category: "Blur",
    previewStyle: (p) => ({ filter: `blur(${lerp(0, 6, p)}px)` }),
  },
  {
    type: "motion-blur",
    get label() { return editorMessage("editor.effectCatalog.motion-blur.name"); },
    get description() { return editorMessage("editor.effectCatalog.motion-blur.description"); },
    category: "Blur",
    previewStyle: (p) => ({
      filter: `blur(${lerp(0, 3, p)}px)`,
      transform: `translateX(${lerp(0, 6, p)}px)`,
    }),
  },
  {
    type: "radial-blur",
    get label() { return editorMessage("editor.effectCatalog.radial-blur.name"); },
    get description() { return editorMessage("editor.effectCatalog.radial-blur.description"); },
    category: "Blur",
    previewStyle: (p) => ({
      filter: `blur(${lerp(0, 4, p)}px)`,
      transform: `scale(${lerp(1, 1.12, p)})`,
    }),
  },
  {
    type: "sharpen",
    get label() { return editorMessage("editor.effectCatalog.sharpen.name"); },
    get description() { return editorMessage("editor.effectCatalog.sharpen.description"); },
    category: "Creative",
    previewStyle: (p) => ({
      filter: `contrast(${lerp(1, 1.4, p)}) brightness(${lerp(1, 1.05, p)})`,
    }),
  },
  {
    type: "vignette",
    get label() { return editorMessage("editor.effectCatalog.vignette.name"); },
    get description() { return editorMessage("editor.effectCatalog.vignette.description"); },
    category: "Creative",
    previewStyle: (p) => ({
      boxShadow: `inset 0 0 ${lerp(0, 50, p)}px ${lerp(0, 25, p)}px rgba(0,0,0,0.65)`,
    }),
  },
  {
    type: "grain",
    get label() { return editorMessage("editor.effectCatalog.film-grain.name"); },
    get description() { return editorMessage("editor.effectCatalog.film-grain.description"); },
    category: "Creative",
    previewStyle: (p) => ({
      filter: `contrast(${lerp(1, 1.1, p)})`,
      opacity: lerp(1, 0.92, p),
    }),
  },
  {
    type: "shadow",
    get label() { return editorMessage("editor.effectCatalog.drop-shadow.name"); },
    get description() { return editorMessage("editor.effectCatalog.drop-shadow.description"); },
    category: "Stylize",
    previewStyle: (p) => ({
      filter: `drop-shadow(${lerp(0, 4, p)}px ${lerp(0, 4, p)}px ${lerp(0, 8, p)}px rgba(0,0,0,0.6))`,
    }),
  },
  {
    type: "glow",
    get label() { return editorMessage("editor.effectCatalog.glow.name"); },
    get description() { return editorMessage("editor.effectCatalog.glow.description"); },
    category: "Stylize",
    previewStyle: (p) => ({
      filter: `brightness(${lerp(1, 1.15, p)}) drop-shadow(0 0 ${lerp(0, 12, p)}px var(--accent))`,
    }),
  },
  {
    type: "chromatic-aberration",
    get label() { return editorMessage("editor.effectCatalog.chromatic-aberration.name"); },
    get description() { return editorMessage("editor.effectCatalog.chromatic-aberration.description"); },
    category: "Stylize",
    previewStyle: (p) => ({
      filter: `hue-rotate(${lerp(0, 6, p)}deg)`,
      textShadow: `${lerp(0, 2, p)}px 0 red, ${lerp(0, -2, p)}px 0 cyan`,
    }),
  },
  {
    type: "chromaKey",
    get label() { return editorMessage("editor.effectCatalog.chroma-key.name"); },
    get description() { return editorMessage("editor.effectCatalog.chroma-key.description"); },
    category: "Stylize",
    previewStyle: (p) => ({
      filter: `hue-rotate(${lerp(0, 18, p)}deg) saturate(${lerp(1, 1.35, p)})`,
      boxShadow: `inset 0 0 0 ${lerp(0, 5, p)}px rgba(34,197,94,.75)`,
    }),
  },
  {
    id: "cinematic-punch",
    type: "contrast",
    get label() { return editorMessage("editor.effectCatalog.cinematic-punch.name"); },
    get description() { return editorMessage("editor.effectCatalog.cinematic-punch.description"); },
    category: "Basic",
    params: { value: 1.35 },
    previewStyle: (p) => ({ filter: `contrast(${lerp(1, 1.35, p)})` }),
  },
  {
    id: "golden-hour",
    type: "temperature",
    get label() { return editorMessage("editor.effectCatalog.golden-hour.name"); },
    get description() { return editorMessage("editor.effectCatalog.golden-hour.description"); },
    category: "Color",
    params: { value: 35 },
    previewStyle: (p) => ({
      filter: `sepia(${lerp(0, 0.48, p)}) saturate(${lerp(1, 1.22, p)})`,
    }),
  },
  {
    id: "soft-focus",
    type: "blur",
    get label() { return editorMessage("editor.effectCatalog.soft-focus.name"); },
    get description() { return editorMessage("editor.effectCatalog.soft-focus.description"); },
    category: "Blur",
    params: { radius: 12, type: "gaussian" },
    previewStyle: (p) => ({ filter: `blur(${lerp(0, 4, p)}px)` }),
  },
  {
    id: "dream-bloom",
    type: "glow",
    get label() { return editorMessage("editor.effectCatalog.dream-bloom.name"); },
    get description() { return editorMessage("editor.effectCatalog.dream-bloom.description"); },
    category: "Stylize",
    params: { radius: 28, intensity: 1.25, color: "#c4b5fd" },
    previewStyle: (p) => ({
      filter: `brightness(${lerp(1, 1.15, p)}) drop-shadow(0 0 ${lerp(0, 16, p)}px #c4b5fd)`,
    }),
  },
  {
    id: "retro-grain",
    type: "grain",
    get label() { return editorMessage("editor.effectCatalog.retro-grain.name"); },
    get description() { return editorMessage("editor.effectCatalog.retro-grain.description"); },
    category: "Creative",
    params: { amount: 0.18, size: 0.7, roughness: 0.65, colored: false },
    previewStyle: (p) => ({
      filter: `contrast(${lerp(1, 1.12, p)}) grayscale(${lerp(0, 0.15, p)})`,
    }),
  },
  {
    id: "rgb-split",
    type: "chromatic-aberration",
    get label() { return editorMessage("editor.effectCatalog.rgb-split.name"); },
    get description() { return editorMessage("editor.effectCatalog.rgb-split.description"); },
    category: "Stylize",
    params: { amount: 12, angle: 0 },
    previewStyle: (p) => ({
      textShadow: `${lerp(0, 4, p)}px 0 red, ${lerp(0, -4, p)}px 0 cyan`,
    }),
  },
  {
    id: "shader-vhs",
    type: "shader",
    get label() { return editorMessage("editor.effectCatalog.vhs.name"); },
    get description() { return editorMessage("editor.effectCatalog.vhs.description"); },
    category: "Stylize",
    params: { shaderId: "vhs", intensity: 0.75, scanlines: 0.4, jitter: 0.45 },
    previewStyle: (p) => ({
      filter: `contrast(${lerp(1, 1.2, p)}) saturate(${lerp(1, 0.82, p)})`,
      transform: `translateX(${Math.sin(p * Math.PI * 8) * 2}px)`,
      boxShadow: `inset ${lerp(0, 3, p)}px 0 rgba(255,0,80,.35), inset ${lerp(0, -3, p)}px 0 rgba(0,220,255,.35)`,
    }),
  },
  {
    id: "shader-posterize",
    type: "shader",
    get label() { return editorMessage("editor.effectCatalog.posterize.name"); },
    get description() { return editorMessage("editor.effectCatalog.posterize.description"); },
    category: "Creative",
    params: { shaderId: "posterize", levels: 5, mix: 1 },
    previewStyle: (p) => ({
      filter: `contrast(${lerp(1, 1.65, p)}) saturate(${lerp(1, 1.35, p)})`,
    }),
  },
  {
    id: "shader-duotone",
    type: "shader",
    get label() { return editorMessage("editor.effectCatalog.duotone.name"); },
    get description() { return editorMessage("editor.effectCatalog.duotone.description"); },
    category: "Color",
    params: {
      shaderId: "duotone",
      shadowColor: "#11133f",
      highlightColor: "#ffca6b",
      mix: 0.9,
      contrast: 1.15,
    },
    previewStyle: (p) => ({
      filter: `grayscale(${p}) sepia(${p}) hue-rotate(${lerp(0, 330, p)}deg) saturate(${lerp(1, 2.2, p)})`,
    }),
  },
  {
    id: "shader-prism",
    type: "shader",
    get label() { return editorMessage("editor.effectCatalog.prism-split.name"); },
    get description() { return editorMessage("editor.effectCatalog.prism-split.description"); },
    category: "Stylize",
    params: { shaderId: "prism", amount: 8, angle: 0, mix: 1 },
    previewStyle: (p) => ({
      filter: `hue-rotate(${lerp(0, 10, p)}deg)`,
      boxShadow: `inset ${lerp(0, 5, p)}px 0 rgba(255,40,90,.5), inset ${lerp(0, -5, p)}px 0 rgba(0,220,255,.5)`,
    }),
  },
  {
    id: "shader-fisheye",
    type: "shader",
    get label() { return editorMessage("editor.effectCatalog.fisheye.name"); },
    get description() { return editorMessage("editor.effectCatalog.fisheye.description"); },
    category: "Creative",
    params: { shaderId: "fisheye", strength: 0.55, radius: 0.8 },
    previewStyle: (p) => ({
      transform: `scale(${lerp(1, 1.12, p)})`,
      borderRadius: `${lerp(0, 24, p)}%`,
    }),
  },
  {
    id: "shader-wave-warp",
    type: "shader",
    get label() { return editorMessage("editor.effectCatalog.wave-warp.name"); },
    get description() { return editorMessage("editor.effectCatalog.wave-warp.description"); },
    category: "Creative",
    params: { shaderId: "wave-warp", amplitude: 0.025, frequency: 5, speed: 1.5 },
    previewStyle: (p) => ({
      transform: `translateX(${Math.sin(p * Math.PI * 2) * 5}px) skewY(${Math.sin(p * Math.PI * 2) * 1.5}deg)`,
    }),
  },
  {
    id: "shader-scanlines",
    type: "shader",
    get label() { return editorMessage("editor.effectCatalog.scanlines.name"); },
    get description() { return editorMessage("editor.effectCatalog.scanlines.description"); },
    category: "Stylize",
    params: { shaderId: "scanlines", density: 360, intensity: 0.3, speed: 0.2 },
    previewStyle: (p) => ({
      filter: `brightness(${lerp(1, 0.82, p)}) contrast(${lerp(1, 1.25, p)})`,
      backgroundImage:
        "repeating-linear-gradient(0deg,rgba(0,0,0,.35) 0 1px,transparent 1px 3px)",
    }),
  },
  {
    id: "shader-edge-glow",
    type: "shader",
    get label() { return editorMessage("editor.effectCatalog.edge-glow.name"); },
    get description() { return editorMessage("editor.effectCatalog.edge-glow.description"); },
    category: "Stylize",
    params: { shaderId: "edge-glow", strength: 4, radius: 1.5, color: "#4de8ff" },
    previewStyle: (p) => ({
      filter: `contrast(${lerp(1, 1.45, p)}) drop-shadow(0 0 ${lerp(0, 9, p)}px #4de8ff)`,
    }),
  },
];

export const EDITOR_EFFECT_CATEGORIES: EffectCategory[] = [
  "Basic",
  "Color",
  "Blur",
  "Creative",
  "Stylize",
];

interface TransitionDef {
  id?: string;
  type: TransitionType;
  label: string;
  description: string;
  params?: Record<string, unknown>;
  /** Render the preview as two colored panels animated according to
   *  this transition's progress p in [0, 1]. */
  renderPreview: (
    p: number,
    thumbUrl: string | null,
  ) => React.ReactElement;
}

type TransitionCategory = "Dissolves" | "Wipes" | "Movement" | "Stylized";
type TransitionCategoryFilter = "All" | TransitionCategory;

const transitionCategoryKeys = {
  All: "editor.transitionsPanel.category.All",
  Dissolves: "editor.transitionsPanel.category.Dissolves",
  Wipes: "editor.transitionsPanel.category.Wipes",
  Movement: "editor.transitionsPanel.category.Movement",
  Stylized: "editor.transitionsPanel.category.Stylized",
} as const;
function transitionCategoryLabel(category: TransitionCategoryFilter): string {
  return editorMessage(transitionCategoryKeys[category]);
}

const TRANSITION_CATEGORIES: TransitionCategory[] = [
  "Dissolves",
  "Wipes",
  "Movement",
  "Stylized",
];

const transitionCategory = (type: TransitionType): TransitionCategory => {
  if (type === "crossfade" || type === "dipToBlack" || type === "dipToWhite") {
    return "Dissolves";
  }
  if (
    type === "wipe" ||
    type === "circleReveal" ||
    type === "radialWipe" ||
    type === "blinds" ||
    type === "diamondReveal" ||
    type === "splitReveal" ||
    type === "mosaic"
  ) {
    return "Wipes";
  }
  if (
    type === "slide" ||
    type === "push" ||
    type === "whipPan" ||
    type === "spin" ||
    type === "flip" ||
    type === "pageTurn"
  ) {
    return "Movement";
  }
  return "Stylized";
};

const renderThumb = (
  thumbUrl: string | null,
  style: React.CSSProperties,
  tint: string,
): React.ReactElement => (
  <div className="absolute inset-0 overflow-hidden" style={style}>
    {thumbUrl ? (
      <img src={thumbUrl} alt="" className="w-full h-full object-cover" />
    ) : (
      <div
        className="w-full h-full"
        style={{
          background: `linear-gradient(135deg, ${tint}, oklch(0.45 0.12 200))`,
        }}
      />
    )}
  </div>
);

const TRANSITIONS: TransitionDef[] = [
  {
    type: "crossfade",
    get label() { return editorMessage("editor.transitionPreview.crossfade"); },
    get description() { return editorMessage("editor.transitionPreview.smooth-opacity-blend"); },
    renderPreview: (p, thumb) => (
      <>
        {renderThumb(thumb, { opacity: 1 - p }, "oklch(0.55 0.14 295)")}
        {renderThumb(thumb, { opacity: p }, "oklch(0.72 0.16 162)")}
      </>
    ),
  },
  {
    type: "dipToBlack",
    get label() { return editorMessage("editor.transitionPreview.dip-to-black"); },
    get description() { return editorMessage("editor.transitionPreview.fade-through-black"); },
    renderPreview: (p, thumb) => (
      <>
        {renderThumb(thumb, { opacity: p < 0.5 ? 1 - p * 2 : 0 }, "oklch(0.55 0.14 295)")}
        {renderThumb(thumb, { opacity: p >= 0.5 ? (p - 0.5) * 2 : 0 }, "oklch(0.72 0.16 162)")}
        <div
          className="absolute inset-0 bg-black pointer-events-none"
          style={{ opacity: p < 0.5 ? p * 2 : (1 - p) * 2 }}
        />
      </>
    ),
  },
  {
    type: "dipToWhite",
    get label() { return editorMessage("editor.transitionPreview.dip-to-white"); },
    get description() { return editorMessage("editor.transitionPreview.fade-through-white"); },
    renderPreview: (p, thumb) => (
      <>
        {renderThumb(thumb, { opacity: p < 0.5 ? 1 - p * 2 : 0 }, "oklch(0.55 0.14 295)")}
        {renderThumb(thumb, { opacity: p >= 0.5 ? (p - 0.5) * 2 : 0 }, "oklch(0.72 0.16 162)")}
        <div
          className="absolute inset-0 bg-white pointer-events-none"
          style={{ opacity: p < 0.5 ? p * 2 : (1 - p) * 2 }}
        />
      </>
    ),
  },
  {
    type: "wipe",
    get label() { return editorMessage("editor.transitionPreview.wipe"); },
    get description() { return editorMessage("editor.transitionPreview.hard-edge-sweeps-across"); },
    renderPreview: (p, thumb) => (
      <>
        {renderThumb(thumb, { clipPath: `inset(0 ${p * 100}% 0 0)` }, "oklch(0.55 0.14 295)")}
        {renderThumb(thumb, { clipPath: `inset(0 0 0 ${(1 - p) * 100}%)` }, "oklch(0.72 0.16 162)")}
      </>
    ),
  },
  ...([
    { id: "wipe-left", labelKey: "editor.transitionPreview.wipe-left", direction: "left" },
    { id: "wipe-right", labelKey: "editor.transitionPreview.wipe-right", direction: "right" },
    { id: "wipe-up", labelKey: "editor.transitionPreview.wipe-up", direction: "up" },
    { id: "wipe-down", labelKey: "editor.transitionPreview.wipe-down", direction: "down" },
  ] as const).map<TransitionDef>(({ id, labelKey, direction }) => ({
    id,
    type: "wipe",
    get label() { return editorMessage(labelKey); },
    get description() { return editorMessage(`editor.transitionPreview.wipe.${direction}`); },
    params: { direction, softness: 0 },
    renderPreview: (p, thumb) => {
      const incomingClip =
        direction === "left"
          ? `inset(0 ${(1 - p) * 100}% 0 0)`
          : direction === "right"
            ? `inset(0 0 0 ${(1 - p) * 100}%)`
            : direction === "up"
              ? `inset(0 0 ${(1 - p) * 100}% 0)`
              : `inset(${(1 - p) * 100}% 0 0 0)`;
      return (
        <>
          {renderThumb(thumb, {}, "oklch(0.55 0.14 295)")}
          {renderThumb(
            thumb,
            { clipPath: incomingClip },
            "oklch(0.72 0.16 162)",
          )}
        </>
      );
    },
  })),
  {
    type: "slide",
    get label() { return editorMessage("editor.transitionPreview.slide"); },
    get description() { return editorMessage("editor.transitionPreview.new-clip-slides-in"); },
    renderPreview: (p, thumb) => (
      <>
        {renderThumb(thumb, { transform: `translateX(${-p * 100}%)` }, "oklch(0.55 0.14 295)")}
        {renderThumb(thumb, { transform: `translateX(${(1 - p) * 100}%)` }, "oklch(0.72 0.16 162)")}
      </>
    ),
  },
  ...([
    { id: "slide-left", labelKey: "editor.transitionPreview.slide-left", direction: "left" },
    { id: "slide-right", labelKey: "editor.transitionPreview.slide-right", direction: "right" },
    { id: "slide-up", labelKey: "editor.transitionPreview.slide-up", direction: "up" },
    { id: "slide-down", labelKey: "editor.transitionPreview.slide-down", direction: "down" },
  ] as const).map<TransitionDef>(({ id, labelKey, direction }) => ({
    id,
    type: "slide",
    get label() { return editorMessage(labelKey); },
    get description() { return editorMessage(`editor.transitionPreview.slide.${direction}`); },
    params: { direction },
    renderPreview: (p, thumb) => {
      const transform =
        direction === "left"
          ? `translateX(${(1 - p) * 100}%)`
          : direction === "right"
            ? `translateX(${-(1 - p) * 100}%)`
            : direction === "up"
              ? `translateY(${(1 - p) * 100}%)`
              : `translateY(${-(1 - p) * 100}%)`;
      return (
        <>
          {renderThumb(thumb, {}, "oklch(0.55 0.14 295)")}
          {renderThumb(
            thumb,
            { transform },
            "oklch(0.72 0.16 162)",
          )}
        </>
      );
    },
  })),
  {
    type: "push",
    get label() { return editorMessage("editor.transitionPreview.push"); },
    get description() { return editorMessage("editor.transitionPreview.outgoing-clip-is-shoved-off"); },
    renderPreview: (p, thumb) => (
      <>
        {renderThumb(thumb, { transform: `translateX(${-p * 100}%)` }, "oklch(0.55 0.14 295)")}
        {renderThumb(thumb, { transform: `translateX(${(1 - p) * 100}%)` }, "oklch(0.72 0.16 162)")}
      </>
    ),
  },
  {
    type: "zoom",
    get label() { return editorMessage("editor.transitionPreview.zoom"); },
    get description() { return editorMessage("editor.transitionPreview.scale-up-and-dissolve"); },
    renderPreview: (p, thumb) => (
      <>
        {renderThumb(
          thumb,
          { transform: `scale(${1 + p * 1.5})`, opacity: 1 - p },
          "oklch(0.55 0.14 295)",
        )}
        {renderThumb(
          thumb,
          { transform: `scale(${1.5 - p * 0.5})`, opacity: p },
          "oklch(0.72 0.16 162)",
        )}
      </>
    ),
  },
  {
    type: "circleReveal",
    get label() { return editorMessage("editor.transitionPreview.circle-reveal"); },
    get description() { return editorMessage("editor.transitionPreview.iris-reveal-from-the-center"); },
    renderPreview: (p, thumb) => (
      <>
        {renderThumb(thumb, {}, "oklch(0.55 0.14 295)")}
        {renderThumb(thumb, { clipPath: `circle(${p * 75}% at 50% 50%)` }, "oklch(0.72 0.16 162)")}
      </>
    ),
  },
  {
    type: "blur",
    get label() { return editorMessage("editor.transitionPreview.blur-dissolve"); },
    get description() { return editorMessage("editor.transitionPreview.blur-out-and-into-the-next-clip"); },
    renderPreview: (p, thumb) => {
      const b = Math.sin(p * Math.PI) * 6;
      return (
        <>
          {renderThumb(thumb, { opacity: 1 - p, filter: `blur(${b}px)` }, "oklch(0.55 0.14 295)")}
          {renderThumb(thumb, { opacity: p, filter: `blur(${b}px)` }, "oklch(0.72 0.16 162)")}
        </>
      );
    },
  },
  {
    type: "whipPan",
    get label() { return editorMessage("editor.transitionPreview.whip-pan"); },
    get description() { return editorMessage("editor.transitionPreview.fast-motion-blurred-pan"); },
    renderPreview: (p, thumb) => {
      const b = Math.sin(p * Math.PI) * 8;
      return (
        <>
          {renderThumb(
            thumb,
            { transform: `translateX(${-p * 100}%)`, filter: `blur(${b}px)` },
            "oklch(0.55 0.14 295)",
          )}
          {renderThumb(
            thumb,
            { transform: `translateX(${(1 - p) * 100}%)`, filter: `blur(${b}px)` },
            "oklch(0.72 0.16 162)",
          )}
        </>
      );
    },
  },
  {
    type: "radialWipe",
    get label() { return editorMessage("editor.transitionPreview.radial-wipe"); },
    get description() { return editorMessage("editor.transitionPreview.clock-style-angular-sweep"); },
    renderPreview: (p, thumb) => (
      <>
        {renderThumb(thumb, {}, "oklch(0.55 0.14 295)")}
        {renderThumb(
          thumb,
          {
            maskImage: `conic-gradient(from -90deg, #000 ${p * 360}deg, transparent 0deg)`,
            WebkitMaskImage: `conic-gradient(from -90deg, #000 ${p * 360}deg, transparent 0deg)`,
          },
          "oklch(0.72 0.16 162)",
        )}
      </>
    ),
  },
  {
    type: "pixelate",
    get label() { return editorMessage("editor.transitionPreview.pixelate"); },
    get description() { return editorMessage("editor.transitionPreview.break-the-cut-into-a-chunky-pixel-mosaic"); },
    params: { maxPixelSize: 48 },
    renderPreview: (p, thumb) => {
      const block = 2 + Math.round(Math.sin(p * Math.PI) * 12);
      return (
        <>
          {renderThumb(thumb, { opacity: 1 - p }, "oklch(0.55 0.14 295)")}
          {renderThumb(thumb, { opacity: p }, "oklch(0.72 0.16 162)")}
          <div
            className="pointer-events-none absolute inset-0 opacity-35 mix-blend-overlay"
            style={{
              backgroundImage:
                "linear-gradient(to right, #000 1px, transparent 1px), linear-gradient(to bottom, #000 1px, transparent 1px)",
              backgroundSize: `${block}px ${block}px`,
            }}
          />
        </>
      );
    },
  },
  {
    type: "glitch",
    get label() { return editorMessage("editor.transitionPreview.glitch-cut"); },
    get description() { return editorMessage("editor.transitionPreview.digital-slice-displacement-at-the-cut"); },
    params: { intensity: 0.08, slices: 12 },
    renderPreview: (p, thumb) => {
      const amount = Math.sin(p * Math.PI) * 12;
      return (
        <>
          {renderThumb(
            thumb,
            {
              opacity: 1 - p * 0.65,
              transform: `translateX(${-amount}px)`,
              filter: `hue-rotate(${-amount * 2}deg)`,
            },
            "oklch(0.55 0.14 295)",
          )}
          {renderThumb(
            thumb,
            {
              opacity: p,
              transform: `translateX(${amount}px)`,
              clipPath:
                "polygon(0 0,100% 0,100% 18%,0 18%,0 30%,100% 30%,100% 48%,0 48%,0 62%,100% 62%,100% 82%,0 82%)",
            },
            "oklch(0.72 0.16 162)",
          )}
        </>
      );
    },
  },
  {
    type: "blinds",
    get label() { return editorMessage("editor.transitionPreview.venetian-blinds"); },
    get description() { return editorMessage("editor.transitionPreview.reveal-the-next-shot-through-repeating-slats"); },
    params: { count: 8, direction: "vertical" },
    renderPreview: (p, thumb) => {
      const open = Math.max(0.5, p * 12);
      const mask = `repeating-linear-gradient(90deg,#000 0 ${open}px,transparent ${open}px 12px)`;
      return (
        <>
          {renderThumb(thumb, {}, "oklch(0.55 0.14 295)")}
          {renderThumb(
            thumb,
            { maskImage: mask, WebkitMaskImage: mask },
            "oklch(0.72 0.16 162)",
          )}
        </>
      );
    },
  },
  {
    type: "diamondReveal",
    get label() { return editorMessage("editor.transitionPreview.diamond-reveal"); },
    get description() { return editorMessage("editor.transitionPreview.geometric-iris-expanding-from-the-center"); },
    renderPreview: (p, thumb) => (
      <>
        {renderThumb(thumb, {}, "oklch(0.55 0.14 295)")}
        {renderThumb(
          thumb,
          {
            clipPath: `polygon(50% ${50 - p * 70}%, ${50 + p * 70}% 50%, 50% ${50 + p * 70}%, ${50 - p * 70}% 50%)`,
          },
          "oklch(0.72 0.16 162)",
        )}
      </>
    ),
  },
  ...([
    { id: "spin-clockwise", labelKey: "editor.transitionPreview.spin-clockwise", rotations: 1 },
    { id: "spin-counter", labelKey: "editor.transitionPreview.spin-counterclockwise", rotations: -1 },
  ] as const).map<TransitionDef>(({ id, labelKey, rotations }) => ({
    id,
    type: "spin",
    get label() { return editorMessage(labelKey); },
    get description() { return editorMessage("editor.transitionPreview.rotating-scale-transition-with-a-smooth-handoff"); },
    params: { rotations },
    renderPreview: (p, thumb) => (
      <>
        {renderThumb(
          thumb,
          {
            opacity: 1 - p,
            transform: `rotate(${rotations * p * 360}deg) scale(${1 - p * 0.75})`,
          },
          "oklch(0.55 0.14 295)",
        )}
        {renderThumb(
          thumb,
          {
            opacity: p,
            transform: `rotate(${rotations * (p - 1) * 360}deg) scale(${0.25 + p * 0.75})`,
          },
          "oklch(0.72 0.16 162)",
        )}
      </>
    ),
  })),
  ...([
    { id: "flip-horizontal", labelKey: "editor.transitionPreview.flip-horizontal", axis: "horizontal" },
    { id: "flip-vertical", labelKey: "editor.transitionPreview.flip-vertical", axis: "vertical" },
  ] as const).map<TransitionDef>(({ id, labelKey, axis }) => ({
    id,
    type: "flip",
    get label() { return editorMessage(labelKey); },
    get description() { return editorMessage(`editor.transitionPreview.flip.${axis}`); },
    params: { axis },
    renderPreview: (p, thumb) => {
      const firstHalf = p < 0.5;
      const phase = firstHalf ? 1 - p * 2 : (p - 0.5) * 2;
      const transform =
        axis === "horizontal" ? `scaleX(${phase})` : `scaleY(${phase})`;
      return renderThumb(
        thumb,
        { transform },
        firstHalf ? "oklch(0.55 0.14 295)" : "oklch(0.72 0.16 162)",
      );
    },
  })),
  ...([
    { id: "split-horizontal", labelKey: "editor.transitionPreview.split-horizontal", orientation: "horizontal" },
    { id: "split-vertical", labelKey: "editor.transitionPreview.split-vertical", orientation: "vertical" },
  ] as const).map<TransitionDef>(({ id, labelKey, orientation }) => ({
    id,
    type: "splitReveal",
    get label() { return editorMessage(labelKey); },
    get description() { return editorMessage(`editor.transitionPreview.split.${orientation}`); },
    params: { orientation },
    renderPreview: (p, thumb) => (
      <>
        {renderThumb(thumb, {}, "oklch(0.55 0.14 295)")}
        {renderThumb(
          thumb,
          {
            clipPath:
              orientation === "horizontal"
                ? `inset(0 ${50 - p * 50}% 0 ${50 - p * 50}%)`
                : `inset(${50 - p * 50}% 0 ${50 - p * 50}% 0)`,
          },
          "oklch(0.72 0.16 162)",
        )}
      </>
    ),
  })),
  {
    id: "flash-cut",
    type: "flash",
    get label() { return editorMessage("editor.transitionPreview.flash-cut"); },
    get description() { return editorMessage("editor.transitionPreview.high-energy-white-flash-through-the-edit"); },
    params: { intensity: 1 },
    renderPreview: (p, thumb) => (
      <>
        {renderThumb(thumb, { opacity: 1 - p }, "oklch(0.55 0.14 295)")}
        {renderThumb(thumb, { opacity: p }, "oklch(0.72 0.16 162)")}
        <div
          className="pointer-events-none absolute inset-0 bg-white"
          style={{ opacity: Math.sin(p * Math.PI) }}
        />
      </>
    ),
  },
  ...([
    {
      id: "film-burn",
      labelKey: "editor.transitionPreview.film-burn",
      descriptionKey: "editor.transitionPreview.warm-analog-light-leak-through-the-edit",
      intensity: 1,
      warmth: 0.75,
      gradient:
        "linear-gradient(110deg, rgb(255 40 0), rgb(255 170 20) 48%, rgb(255 245 210))",
    },
    {
      id: "film-burn-red",
      labelKey: "editor.transitionPreview.red-film-burn",
      descriptionKey: "editor.transitionPreview.dense-red-orange-flare-for-dramatic-cuts",
      intensity: 1.3,
      warmth: 1,
      gradient:
        "linear-gradient(105deg, rgb(125 0 0), rgb(255 35 0) 45%, rgb(255 210 80))",
    },
    {
      id: "light-leak-cool",
      labelKey: "editor.transitionPreview.cool-light-leak",
      descriptionKey: "editor.transitionPreview.blue-white-optical-flare-through-the-edit",
      intensity: 0.9,
      warmth: 0,
      gradient:
        "linear-gradient(110deg, rgb(15 65 255), rgb(65 220 255) 48%, rgb(245 250 255))",
    },
  ] as const).map<TransitionDef>(
    ({ id, labelKey, descriptionKey, intensity, warmth, gradient }) => ({
      id,
      type: "filmBurn",
      get label() { return editorMessage(labelKey); },
      get description() { return editorMessage(descriptionKey); },
      params: { intensity, warmth },
      renderPreview: (p, thumb) => {
      const burn = Math.sin(p * Math.PI);
      return (
        <>
          {renderThumb(thumb, { opacity: 1 - p }, "oklch(0.55 0.14 295)")}
          {renderThumb(thumb, { opacity: p }, "oklch(0.72 0.16 162)")}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              opacity: burn,
              background: gradient,
              mixBlendMode: "screen",
            }}
          />
        </>
      );
    },
    }),
  ),
  {
    type: "mosaic",
    get label() { return editorMessage("editor.transitionPreview.mosaic-reveal"); },
    get description() { return editorMessage("editor.transitionPreview.tiles-assemble-the-next-shot-in-a-shuffled-pattern"); },
    params: { tiles: 8, randomness: 0.85 },
    renderPreview: (p, thumb) => {
      const tileSize = 12;
      const cutoff = Math.round(p * 100);
      const mask = `linear-gradient(135deg, #000 ${cutoff}%, transparent ${cutoff + 18}%)`;
      return (
        <>
          {renderThumb(thumb, {}, "oklch(0.55 0.14 295)")}
          {renderThumb(
            thumb,
            {
              maskImage: mask,
              WebkitMaskImage: mask,
              backgroundSize: `${tileSize}px ${tileSize}px`,
              imageRendering: "pixelated",
            },
            "oklch(0.72 0.16 162)",
          )}
        </>
      );
    },
  },
  {
    type: "ripple",
    get label() { return editorMessage("editor.transitionPreview.ripple"); },
    get description() { return editorMessage("editor.transitionPreview.a-fluid-wave-distorts-both-shots-through-the-cut"); },
    params: { amplitude: 0.04, waves: 3 },
    renderPreview: (p, thumb) => {
      const wave = Math.sin(p * Math.PI) * 6;
      return (
        <>
          {renderThumb(
            thumb,
            { opacity: 1 - p, transform: `translateX(${-wave}px) skewY(${wave * 0.25}deg)` },
            "oklch(0.55 0.14 295)",
          )}
          {renderThumb(
            thumb,
            { opacity: p, transform: `translateX(${wave}px) skewY(${-wave * 0.25}deg)` },
            "oklch(0.72 0.16 162)",
          )}
        </>
      );
    },
  },
  ...([
    { id: "page-turn-left", labelKey: "editor.transitionPreview.page-turn-left", direction: "left" },
    { id: "page-turn-right", labelKey: "editor.transitionPreview.page-turn-right", direction: "right" },
  ] as const).map<TransitionDef>(({ id, labelKey, direction }) => ({
    id,
    type: "pageTurn",
    get label() { return editorMessage(labelKey); },
    get description() { return editorMessage(`editor.transitionPreview.page.${direction}`); },
    params: { direction, shadow: 0.55 },
    renderPreview: (p, thumb) => (
      <>
        {renderThumb(thumb, {}, "oklch(0.72 0.16 162)")}
        {renderThumb(
          thumb,
          {
            transform: `scaleX(${1 - p})`,
            transformOrigin: direction === "left" ? "left center" : "right center",
            filter: `brightness(${1 - Math.sin(p * Math.PI) * 0.25})`,
          },
          "oklch(0.55 0.14 295)",
        )}
      </>
    ),
  })),
  {
    type: "colorSplit",
    get label() { return editorMessage("editor.transitionPreview.color-split"); },
    get description() { return editorMessage("editor.transitionPreview.prismatic-channel-ghosts-collide-at-the-edit"); },
    params: { maxOffset: 18, angle: 0 },
    renderPreview: (p, thumb) => {
      const offset = Math.sin(p * Math.PI) * 7;
      return (
        <>
          {renderThumb(thumb, { opacity: 1 - p }, "oklch(0.55 0.14 295)")}
          {renderThumb(thumb, { opacity: p }, "oklch(0.72 0.16 162)")}
          <div
            className="pointer-events-none absolute inset-0 mix-blend-screen"
            style={{
              transform: `translateX(${offset}px)`,
              background: "linear-gradient(90deg,rgba(255,0,80,.5),transparent 45%,rgba(0,220,255,.55))",
              opacity: Math.sin(p * Math.PI) * 0.7,
            }}
          />
        </>
      );
    },
  },
  ...([
    {
      id: "crossfade-linear",
      labelKey: "editor.transitionPreview.linear-dissolve",
      descriptionKey: "editor.transitionPreview.constant-speed-opacity-blend",
      curve: "linear",
    },
    {
      id: "crossfade-ease-in",
      labelKey: "editor.transitionPreview.slow-in-dissolve",
      descriptionKey: "editor.transitionPreview.blend-accelerates-into-the-cut",
      curve: "ease-in",
    },
    {
      id: "crossfade-ease-out",
      labelKey: "editor.transitionPreview.slow-out-dissolve",
      descriptionKey: "editor.transitionPreview.blend-settles-gently-after-the-cut",
      curve: "ease-out",
    },
  ] as const).map<TransitionDef>(({ id, labelKey, descriptionKey, curve }) => ({
    id,
    type: "crossfade",
    get label() { return editorMessage(labelKey); },
    get description() { return editorMessage(descriptionKey); },
    params: { curve },
    renderPreview: (p, thumb) => {
      const eased =
        curve === "ease-in"
          ? p * p
          : curve === "ease-out"
            ? p * (2 - p)
            : p;
      return (
        <>
          {renderThumb(thumb, { opacity: 1 - eased }, "oklch(0.55 0.14 295)")}
          {renderThumb(thumb, { opacity: eased }, "oklch(0.72 0.16 162)")}
        </>
      );
    },
  })),
  ...([
    {
      id: "wipe-soft-left",
      labelKey: "editor.transitionPreview.soft-wipe-left",
      direction: "left",
      softness: 0.45,
    },
    {
      id: "wipe-soft-right",
      labelKey: "editor.transitionPreview.soft-wipe-right",
      direction: "right",
      softness: 0.45,
    },
    {
      id: "wipe-diagonal",
      labelKey: "editor.transitionPreview.diagonal-wipe",
      direction: "diagonal",
      softness: 0,
    },
  ] as const).map<TransitionDef>(({ id, labelKey, direction, softness }) => ({
    id,
    type: "wipe",
    get label() { return editorMessage(labelKey); },
    get description() { return editorMessage(direction === "diagonal" ? "editor.transitionPreview.diagonalDescription" : "editor.transitionPreview.softDescription"); },
    params: { direction, softness },
    renderPreview: (p, thumb) => {
      const clipPath =
        direction === "right"
          ? `inset(0 0 0 ${(1 - p) * 100}%)`
          : direction === "diagonal"
            ? `polygon(0 0, ${p * 200}% 0, 0 ${p * 200}%)`
            : `inset(0 ${(1 - p) * 100}% 0 0)`;
      return (
        <>
          {renderThumb(thumb, {}, "oklch(0.55 0.14 295)")}
          {renderThumb(
            thumb,
            {
              clipPath,
              filter: softness > 0 ? "blur(1.5px)" : undefined,
            },
            "oklch(0.72 0.16 162)",
          )}
        </>
      );
    },
  })),
  ...([
    { id: "push-left", labelKey: "editor.transitionPreview.push-left", direction: "left" },
    { id: "push-right", labelKey: "editor.transitionPreview.push-right", direction: "right" },
    { id: "push-up", labelKey: "editor.transitionPreview.push-up", direction: "up" },
    { id: "push-down", labelKey: "editor.transitionPreview.push-down", direction: "down" },
  ] as const).map<TransitionDef>(({ id, labelKey, direction }) => ({
    id,
    type: "push",
    get label() { return editorMessage(labelKey); },
    get description() { return editorMessage(`editor.transitionPreview.push.${direction}`); },
    params: { direction },
    renderPreview: (p, thumb) => {
      const outgoingTransform =
        direction === "left"
          ? `translateX(${-p * 100}%)`
          : direction === "right"
            ? `translateX(${p * 100}%)`
            : direction === "up"
              ? `translateY(${-p * 100}%)`
              : `translateY(${p * 100}%)`;
      const incomingTransform =
        direction === "left"
          ? `translateX(${(1 - p) * 100}%)`
          : direction === "right"
            ? `translateX(${-(1 - p) * 100}%)`
            : direction === "up"
              ? `translateY(${(1 - p) * 100}%)`
              : `translateY(${-(1 - p) * 100}%)`;
      return (
        <>
          {renderThumb(
            thumb,
            { transform: outgoingTransform },
            "oklch(0.55 0.14 295)",
          )}
          {renderThumb(
            thumb,
            { transform: incomingTransform },
            "oklch(0.72 0.16 162)",
          )}
        </>
      );
    },
  })),
  ...([
    {
      id: "zoom-top-left",
      labelKey: "editor.transitionPreview.zoom-top-left",
      center: { x: 0.15, y: 0.15 },
    },
    {
      id: "zoom-bottom-right",
      labelKey: "editor.transitionPreview.zoom-bottom-right",
      center: { x: 0.85, y: 0.85 },
    },
    {
      id: "zoom-punch",
      labelKey: "editor.transitionPreview.punch-zoom",
      center: { x: 0.5, y: 0.5 },
    },
  ] as const).map<TransitionDef>(({ id, labelKey, center }) => ({
    id,
    type: "zoom",
    get label() { return editorMessage(labelKey); },
    get description() { return editorMessage("editor.transitionPreview.focused-scale-and-dissolve-transition"); },
    params: { scale: id === "zoom-punch" ? 3 : 2, center },
    renderPreview: (p, thumb) => (
      <>
        {renderThumb(
          thumb,
          {
            opacity: 1 - p,
            transform: `scale(${1 + p * (id === "zoom-punch" ? 2 : 1)})`,
            transformOrigin: `${center.x * 100}% ${center.y * 100}%`,
          },
          "oklch(0.55 0.14 295)",
        )}
        {renderThumb(
          thumb,
          { opacity: p },
          "oklch(0.72 0.16 162)",
        )}
      </>
    ),
  })),
  ...([
    { id: "whip-left", labelKey: "editor.transitionPreview.whip-left", direction: "left" },
    { id: "whip-right", labelKey: "editor.transitionPreview.whip-right", direction: "right" },
    { id: "whip-up", labelKey: "editor.transitionPreview.whip-up", direction: "up" },
    { id: "whip-down", labelKey: "editor.transitionPreview.whip-down", direction: "down" },
  ] as const).map<TransitionDef>(({ id, labelKey, direction }) => ({
    id,
    type: "whipPan",
    get label() { return editorMessage(labelKey); },
    get description() { return editorMessage(`editor.transitionPreview.whip.${direction}`); },
    params: { direction },
    renderPreview: (p, thumb) => {
      const axis = direction === "left" || direction === "right" ? "X" : "Y";
      const sign = direction === "left" || direction === "up" ? -1 : 1;
      const blur = Math.sin(p * Math.PI) * 8;
      return (
        <>
          {renderThumb(
            thumb,
            {
              transform: `translate${axis}(${sign * p * 100}%)`,
              filter: `blur(${blur}px)`,
            },
            "oklch(0.55 0.14 295)",
          )}
          {renderThumb(
            thumb,
            {
              transform: `translate${axis}(${-sign * (1 - p) * 100}%)`,
              filter: `blur(${blur}px)`,
            },
            "oklch(0.72 0.16 162)",
          )}
        </>
      );
    },
  })),
];

// ─── Drag payload helpers ──────────────────────────────────────────
export const EFFECT_DRAG_MIME = "application/x-openreel-effect";
export const TRANSITION_DRAG_MIME = "application/x-openreel-transition";

const PREVIEW_CYCLE_MS = 1800;

// ─── Cards ────────────────────────────────────────────────────────

const EffectCard: React.FC<{
  def: EditorEffectPreviewDef;
  thumbUrl: string | null;
  onApply: () => void;
}> = ({ def, thumbUrl, onApply }) => {
  const [progress, setProgress] = useState(0.72);
  const [isHover, setIsHover] = useState(false);
  const rafRef = React.useRef<number | null>(null);
  const startRef = React.useRef<number>(0);

  React.useEffect(() => {
    if (!isHover) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      setProgress(0.72);
      return;
    }
    startRef.current = performance.now();
    const tick = (now: number) => {
      const elapsed = (now - startRef.current) % PREVIEW_CYCLE_MS;
      const t = elapsed / PREVIEW_CYCLE_MS;
      // Ping-pong so the effect intensifies then relaxes
      const eased = t < 0.5 ? t * 2 : (1 - t) * 2;
      setProgress(eased);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isHover]);

  const previewStyle = def.previewStyle(progress);

  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLElement>) => {
      e.dataTransfer.effectAllowed = "copy";
      const payload = serializeEditorEffectDropPayload({
        effectType: def.type,
        effectParams: def.params,
      });
      e.dataTransfer.setData(EFFECT_DRAG_MIME, payload);
      // Fallback for browsers that don't surface custom MIME types
      e.dataTransfer.setData("text/plain", `effect:${def.type}`);
    },
    [def.params, def.type],
  );

  return (
    <ClickableCard
      label={editorMessage("editor.effectsPanel.drag", { name: def.label })}
      draggable
      onDragStart={handleDragStart}
      onDoubleClick={onApply}
      onMouseEnter={() => setIsHover(true)}
      onMouseLeave={() => setIsHover(false)}
      padding={0}
      variant="default"
      className="group relative flex flex-col items-stretch border border-border bg-bg-2 overflow-hidden text-left cursor-grab active:cursor-grabbing hover:border-accent transition-colors"
    >
      <div
        data-effect-preview={def.id ?? def.type}
        data-preview-progress={progress.toFixed(2)}
        className="relative aspect-video bg-bg-3 overflow-hidden"
      >
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            style={previewStyle}
            draggable={false}
          />
        ) : (
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(135deg, oklch(0.55 0.14 295), oklch(0.72 0.16 162))",
              ...previewStyle,
            }}
          />
        )}
        <Text className="absolute bottom-1 right-1 text-[8.5px] uppercase px-1.5 py-0.5 rounded bg-black/55 text-white/85 backdrop-blur-sm">
          {editorEffectCategoryLabel(def.category)}
        </Text>
      </div>
      <div className="px-2 py-1.5 border-t border-border">
        <Text type="supporting" weight="bold" display="block" maxLines={1} className="text-[10.5px] text-fg leading-tight">
          {def.label}
        </Text>
        <Text type="supporting" color="secondary" display="block" maxLines={1} className="text-[9.5px] text-fg-muted leading-tight mt-0.5">
          {def.description}
        </Text>
      </div>
    </ClickableCard>
  );
};

const TransitionCard: React.FC<{
  def: TransitionDef;
  thumbUrl: string | null;
  onApply: () => void;
}> = ({ def, thumbUrl, onApply }) => {
  const [progress, setProgress] = useState(0);
  const [isHover, setIsHover] = useState(false);
  const rafRef = React.useRef<number | null>(null);
  const startRef = React.useRef<number>(0);

  React.useEffect(() => {
    if (!isHover) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      setProgress(0);
      return;
    }
    startRef.current = performance.now();
    const tick = (now: number) => {
      const elapsed = (now - startRef.current) % PREVIEW_CYCLE_MS;
      setProgress(elapsed / PREVIEW_CYCLE_MS);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isHover]);

  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLElement>) => {
      e.dataTransfer.effectAllowed = "copy";
      const payload = JSON.stringify({
        transitionType: def.type,
        transitionParams: def.params,
      });
      e.dataTransfer.setData(TRANSITION_DRAG_MIME, payload);
      e.dataTransfer.setData("text/plain", `transition:${def.type}`);
    },
    [def.params, def.type],
  );

  return (
    <ClickableCard
      label={editorMessage("editor.transitionsPanel.drag", { name: def.label })}
      draggable
      onDragStart={handleDragStart}
      onDoubleClick={onApply}
      onMouseEnter={() => setIsHover(true)}
      onMouseLeave={() => setIsHover(false)}
      padding={0}
      variant="default"
      className="group relative flex flex-col items-stretch border border-border bg-bg-2 overflow-hidden text-left cursor-grab active:cursor-grabbing hover:border-accent transition-colors"
    >
      <div className="relative aspect-video bg-bg-3 overflow-hidden">
        {def.renderPreview(progress, thumbUrl)}
      </div>
      <div className="px-2 py-1.5 border-t border-border">
        <Text type="supporting" weight="bold" display="block" maxLines={1} className="text-[10.5px] text-fg leading-tight">
          {def.label}
        </Text>
        <Text type="supporting" color="secondary" display="block" maxLines={1} className="text-[9.5px] text-fg-muted leading-tight mt-0.5">
          {def.description}
        </Text>
      </div>
    </ClickableCard>
  );
};

// ─── Hook: thumbnail of the user's currently selected clip ────────

/**
 * Resolve the best available thumbnail URL from the user's current
 * selection. Falls back to the first video clip in the project, then
 * the first imported video, otherwise null (cards show gradients).
 */
const useCurrentClipThumbnail = (): string | null => {
  const project = useProjectStore((s) => s.project);
  const getSelectedClipIds = useUIStore((s) => s.getSelectedClipIds);

  return useMemo(() => {
    const selectedIds = getSelectedClipIds();
    const tracks = project.timeline.tracks;
    const mediaItems = project.mediaLibrary.items;

    const findMediaForClipId = (clipId: string): string | null => {
      for (const track of tracks) {
        const clip = track.clips.find((c) => c.id === clipId);
        if (clip) {
          const item = mediaItems.find((m) => m.id === clip.mediaId);
          if (item?.thumbnailUrl) return item.thumbnailUrl;
        }
      }
      return null;
    };

    for (const id of selectedIds) {
      const thumb = findMediaForClipId(id);
      if (thumb) return thumb;
    }

    // Fallback 1: first clip with a thumbnail
    for (const track of tracks) {
      for (const clip of track.clips) {
        const item = mediaItems.find((m) => m.id === clip.mediaId);
        if (item?.thumbnailUrl) return item.thumbnailUrl;
      }
    }

    // Fallback 2: any media item with a thumbnail
    const firstWithThumb = mediaItems.find((m) => m.thumbnailUrl);
    return firstWithThumb?.thumbnailUrl ?? null;
  }, [project, getSelectedClipIds]);
};

// ─── Main panel ───────────────────────────────────────────────────

export const EffectsPanel: React.FC = () => {
  const thumbUrl = useCurrentClipThumbnail();
  const getSelectedClipIds = useUIStore((s) => s.getSelectedClipIds);
  const addVideoEffect = useProjectStore((s) => s.addVideoEffect);

  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] =
    useState<EffectCategoryFilter>("All");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return EDITOR_EFFECT_PREVIEWS.filter(
      (effect) =>
        (categoryFilter === "All" || effect.category === categoryFilter) &&
        (!q ||
          effect.label.toLowerCase().includes(q) ||
          effect.description.toLowerCase().includes(q) ||
          editorEffectCategoryLabel(effect.category).toLowerCase().includes(q)),
    );
  }, [categoryFilter, query]);

  const applyToSelection = useCallback(
    async (def: EditorEffectPreviewDef) => {
      const selectedIds = getSelectedClipIds();
      if (selectedIds.length === 0) {
        toast.warning(
          editorMessage("editor.effectsPanel.empty"),
          editorMessage("editor.effectsPanel.emptyHelp"),
        );
        return;
      }
      let appliedCount = 0;
      for (const id of selectedIds) {
        if (await addVideoEffect(id, def.type, def.params)) appliedCount += 1;
      }
      if (appliedCount === 0) {
        toast.error(
          editorMessage("editor.effectsPanel.failed"),
          editorMessage("editor.effectsPanel.failedHelp"),
        );
        return;
      }
      toast.success(
        editorMessage("editor.effectsPanel.applied"),
        editorMessage(appliedCount === 1 ? "editor.effectsPanel.appliedOne" : "editor.effectsPanel.appliedMany", { name: def.label, count: appliedCount }),
      );
      if (appliedCount < selectedIds.length) {
        toast.warning(
          editorMessage("editor.effectsPanel.skipped"),
          editorMessage(selectedIds.length - appliedCount === 1 ? "editor.effectsPanel.skippedOne" : "editor.effectsPanel.skippedMany", { count: selectedIds.length - appliedCount }),
        );
      }
    },
    [getSelectedClipIds, addVideoEffect],
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-3 pt-3 pb-2 shrink-0">
        <ToolcraftTextInputControl
          label={editorMessage("editor.effectsPanel.search")}
          isLabelHidden
          type="text"
          value={query}
          onChange={setQuery}
          placeholder={editorMessage("editor.effectsPanel.search")}
          startIcon={<Search size={13} aria-hidden />}
          size="sm"
          width="100%"
        />
        <div
          className="mt-2 flex gap-1 overflow-x-auto pb-0.5"
          role="group"
          aria-label={editorMessage("editor.effectsPanel.categories")}
        >
          {(["All", ...EDITOR_EFFECT_CATEGORIES] as const).map((category) => {
            const count =
              category === "All"
                ? EDITOR_EFFECT_PREVIEWS.length
                : EDITOR_EFFECT_PREVIEWS.filter(
                    (effect) => effect.category === category,
                  ).length;
            return (
              <button
                key={category}
                type="button"
                aria-pressed={categoryFilter === category}
                onClick={() => setCategoryFilter(category)}
                className={`h-6 shrink-0 rounded-md border px-2 text-[9px] font-semibold transition-colors ${
                  categoryFilter === category
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-bg-2 text-fg-3 hover:border-primary/50 hover:text-fg"
                }`}
              >
                {editorEffectCategoryLabel(category)} {count}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="px-3 pb-3 space-y-3">
          {EDITOR_EFFECT_CATEGORIES.filter(
            (category) =>
              categoryFilter === "All" || category === categoryFilter,
          ).map((cat) => {
            const items = filtered.filter((e) => e.category === cat);
            if (items.length === 0) return null;
            return (
              <section key={cat}>
                <Text type="supporting" color="secondary" weight="bold" display="block" className="text-[9.5px] uppercase mb-1.5">
                  {editorEffectCategoryLabel(cat)}
                </Text>
                <div className="grid grid-cols-2 gap-2">
                  {items.map((def) => (
                    <EffectCard
                      key={def.id ?? def.type}
                      def={def}
                      thumbUrl={thumbUrl}
                      onApply={() => applyToSelection(def)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
          {filtered.length === 0 && (
            <Text type="supporting" color="secondary" display="block" justify="center" className="text-[10.5px] py-6">
              {editorMessage("editor.effects.noMatch", { query })}
            </Text>
          )}
        </div>
      </div>
    </div>
  );
};

export const TransitionsPanel: React.FC = () => {
  const thumbUrl = useCurrentClipThumbnail();
  const project = useProjectStore((state) => state.project);
  const addClipTransition = useProjectStore(
    (state) => state.addClipTransition,
  );
  const getSelectedClipIds = useUIStore((state) => state.getSelectedClipIds);

  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] =
    useState<TransitionCategoryFilter>("All");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return TRANSITIONS.filter(
      (transition) => {
        const category = transitionCategory(transition.type);
        if (categoryFilter !== "All" && category !== categoryFilter) {
          return false;
        }
        return (
          !q ||
          transition.label.toLowerCase().includes(q) ||
          transition.description.toLowerCase().includes(q) ||
          transitionCategoryLabel(category).toLowerCase().includes(q)
        );
      },
    );
  }, [categoryFilter, query]);

  const applyToSelectedCut = useCallback(
    async (def: TransitionDef) => {
      const selectedIds = new Set(getSelectedClipIds());
      const selectedCount = selectedIds.size;
      if (selectedCount === 0) {
        toast.warning(
          editorMessage("editor.effectsPanel.empty"),
          editorMessage("editor.transitionsPanel.emptyHelp"),
        );
        return;
      }

      let clipA: Clip | undefined;
      let clipB: Clip | undefined;
      for (const track of project.timeline.tracks) {
        const sorted = [...track.clips].sort(
          (first, second) => first.startTime - second.startTime,
        );
        if (selectedCount > 1) {
          for (let index = 0; index < sorted.length - 1; index += 1) {
            if (
              selectedIds.has(sorted[index].id) &&
              selectedIds.has(sorted[index + 1].id)
            ) {
              clipA = sorted[index];
              clipB = sorted[index + 1];
              break;
            }
          }
        } else {
          const selectedIndex = sorted.findIndex((clip) =>
            selectedIds.has(clip.id),
          );
          if (selectedIndex >= 0) {
            const selected = sorted[selectedIndex];
            const next = sorted[selectedIndex + 1];
            const previous = sorted[selectedIndex - 1];
            if (next) {
              clipA = selected;
              clipB = next;
            } else if (previous) {
              clipA = previous;
              clipB = selected;
            } else {
              clipA = selected;
              clipB = undefined;
            }
          }
        }
        if (clipA) break;
      }

      if (!clipA) {
        toast.warning(
          editorMessage("editor.transitionsPanel.noCut"),
          editorMessage("editor.transitionsPanel.noCutHelp"),
        );
        return;
      }

      const bridge = getTransitionBridge();
      if (!bridge.isInitialized()) {
        bridge.initialize(project.settings.width, project.settings.height);
      }
      const params = {
        ...bridge.getDefaultParams(def.type),
        ...def.params,
      };
      const result = clipB
        ? bridge.createTransition(clipA, clipB, def.type, 1, params)
        : bridge.createClipEdgeTransition(clipA, "out", def.type, 1, params);
      if (!result.success || !result.transitionId) {
        toast.error(
          editorMessage("editor.transitionsPanel.failed"),
          result.error ?? editorMessage("editor.transitionsPanel.createFailed"),
        );
        return;
      }
      const transition = bridge.getTransition(result.transitionId);
      if (!transition || !(await addClipTransition(transition))) {
        toast.error(editorMessage("editor.transitionsPanel.failed"), editorMessage("editor.transitionsPanel.saveFailed"));
        return;
      }
      toast.success(
        editorMessage("editor.transitionsPanel.applied"),
        editorMessage("editor.transitionsPanel.appliedHelp", { name: def.label }),
      );
    },
    [addClipTransition, getSelectedClipIds, project],
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-3 pt-3 pb-2 shrink-0">
        <ToolcraftTextInputControl
          label={editorMessage("editor.transitionsPanel.search")}
          isLabelHidden
          type="text"
          value={query}
          onChange={setQuery}
          placeholder={editorMessage("editor.transitionsPanel.search")}
          startIcon={<Search size={13} aria-hidden />}
          size="sm"
          width="100%"
        />
        <div
          className="mt-2 flex gap-1 overflow-x-auto pb-0.5"
          role="group"
          aria-label={editorMessage("editor.transitionsPanel.categories")}
        >
          {(["All", ...TRANSITION_CATEGORIES] as const).map((category) => {
            const count =
              category === "All"
                ? TRANSITIONS.length
                : TRANSITIONS.filter(
                    (transition) =>
                      transitionCategory(transition.type) === category,
                  ).length;
            return (
              <button
                key={category}
                type="button"
                aria-pressed={categoryFilter === category}
                onClick={() => setCategoryFilter(category)}
                className={`h-6 shrink-0 rounded-md border px-2 text-[9px] font-semibold transition-colors ${
                  categoryFilter === category
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-bg-2 text-fg-3 hover:border-primary/50 hover:text-fg"
                }`}
              >
                {editorMessage("editor.transitionsPanel.categoryCount", { category: transitionCategoryLabel(category), count })}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="space-y-3 px-3 pb-3">
          {TRANSITION_CATEGORIES.filter(
            (category) =>
              categoryFilter === "All" || category === categoryFilter,
          ).map((category) => {
            const items = filtered.filter(
              (transition) => transitionCategory(transition.type) === category,
            );
            if (items.length === 0) return null;
            return (
              <section key={category}>
                <div className="mb-1.5 flex items-center justify-between">
                  <Text type="supporting" color="secondary" weight="bold" className="text-[9.5px] uppercase">
                    {transitionCategoryLabel(category)}
                  </Text>
                  <Text type="supporting" color="secondary" className="font-mono text-[9px]">
                    {items.length}
                  </Text>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {items.map((def) => (
                    <TransitionCard
                      key={def.id ?? def.type}
                      def={def}
                      thumbUrl={thumbUrl}
                      onApply={() => void applyToSelectedCut(def)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
          {filtered.length === 0 && (
            <Text type="supporting" color="secondary" display="block" justify="center" className="text-[10.5px] py-6">
              {editorMessage("editor.transitions.noMatch", { query })}
            </Text>
          )}
        </div>
      </div>
    </div>
  );
};
