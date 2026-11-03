import { motionBlendModeLabel, motionPropertyLabel } from "../motion-layer-labels";
import { motionShaderName, motionShaderParameterLabel } from "../motion-shader-labels";
import { editorMessage } from "../../shotloom-mode";
import type { JSX } from "react";
import type { ReactNode } from "react";
import { ToolcraftSwitchControl, ToolcraftText } from "@openreel/ui";
import {
  AlignCenter,
  AlignHorizontalDistributeCenter,
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignLeft,
  AlignRight,
  AlignVerticalDistributeCenter,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  Camera,
  Clapperboard,
  Film,
  Copy,
  Clock,
  Crosshair,
  Diamond,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Lightbulb,
  Layers,
  Lock,
  Move,
  Plus,
  Ruler,
  Scissors,
  Settings2,
  Shrink,
  SlidersHorizontal,
  Sparkles,
  Spline,
  Square,
  Star,
  Tornado,
  Trash2,
  Type,
  Unlock,
  Zap,
  Box,
} from "@/icons/lucide-compat";
import {
  DEFAULT_MOTION_BLUR_SETTINGS,
  MOTION_BLEND_MODE_OPTIONS,
  MOTION_ANIMATABLE_PROPERTIES,
  addMotionCompositionLight,
  addMotionCompositionGuide,
  addMotionShapeModifier,
  addMotionTextAnimator,
  alignMotionLayers,
  applyMotionParticlePreset,
  canNestMotionComposition,
  canParentMotionLayer,
  clearMotionCompositionGuides,
  createDefaultMotionGradientFill,
  createDefaultMotionShaderFill,
  createDefaultMotionCamera,
  createMotionGuide,
  createMotionLight,
  createMotionShapeModifier,
  createSolidMotionFill,
  createMotionTextAnimator,
  distributeMotionLayers,
  duplicateMotionLayers,
  getMotionShaderDef,
  getMotionShaderFillDefs,
  getMotionShaderTextDefs,
  getMotionTextShaderAnimator,
  MOTION_TEXT_ANIMATOR_PRESETS,
  normalizeMotionParticleEmitter,
  clearMotionCompositionTimeRemap,
  enableMotionCompositionTimeRemap,
  findMotionCameraKeyframeAtTime,
  findMotionLightKeyframeAtTime,
  findMotionLayerKeyframeAtTime,
  findMotionShapePathKeyframeAtTime,
  getMotionCameraAtTime,
  getMotionCameraPropertyKeyframes,
  getMotionCameraPropertyValue,
  getMotionLightAtTime,
  getMotionLightPropertyDescriptor,
  getMotionLightPropertyKeyframes,
  getMotionLightPropertyValue,
  getMotionLayerEffectPropertyDescriptors,
  getMotionLayerContentsPropertyDescriptors,
  getMotionLayerMaskPropertyDescriptors,
  getMotionLayerPuppetPropertyDescriptors,
  getMotionLayerShapeModifierPropertyDescriptors,
  getMotionOffsetPathsModifier,
  getMotionPuckerBloatModifier,
  getMotionRepeaterModifier,
  getMotionRoundCornersModifier,
  getMotionTrimPathsModifier,
  getMotionTwistModifier,
  getMotionWigglePathsModifier,
  getMotionZigZagModifier,
  getMotionLayerPropertyKeyframes,
  getMotionLayerPropertyValueAtTime,
  getMotionCompositionLayerPlaybackTime,
  getMotionVideoLayerSourceTime,
  getMotionShapePathKeyframes,
  getMotionShapeModifierKeyframeProperty,
  isMotionCompositionTimeRemapped,
  MOTION_PARTICLE_PRESETS,
  normalizeMotionBlurSettings,
  normalizeMotionCamera,
  normalizeMotionLights,
  MOTION_COMPOSITION_TIME_PROPERTY,
  MOTION_SHAPE_PATH_DATA_PROPERTY,
  removeMotionCameraKeyframe,
  removeMotionCompositionGuide,
  removeMotionCompositionLight,
  removeMotionLightKeyframe,
  removeMotionLayerKeyframe,
  removeMotionLayerPropertyKeyframes,
  removeMotionShapeModifier,
  removeMotionTextAnimator,
  removeMotionLayers,
  setMotionLayersLocked,
  setMotionLayersVisible,
  setMotionLayerParent,
  setMotionLayerPropertyValue,
  setMotionCameraPropertyValue,
  setMotionCameraDepthOfFieldEnabled,
  setMotionLightPropertyValue,
  sortMotionKeyframes,
  toggleMotionCompositionLight,
  toggleMotionShapeModifier,
  toggleMotionTextAnimator,
  updateMotionCompositionLight,
  updateMotionCompositionGuide,
  updateMotionTextAnimator,
  upsertMotionCameraKeyframe,
  upsertMotionLightKeyframe,
  upsertMotionLayerKeyframe,
  upsertMotionShapePathKeyframe,
  type MotionAnimatableProperty,
  type MotionAnimatablePropertyDescriptor,
  type MotionCamera,
  type MotionCameraProperty,
  MotionComposition,
  normalizeMotionGradientStops,
  type GradientStyle,
  type GradientStop,
  type MotionGuideOrientation,
  type MotionInstanceOverride,
  type Keyframe,
  type MotionLight,
  type MotionLightProperty,
  type MotionLightType,
  type MotionLayerAlignment,
  type MotionLayerDistributionAxis,
  MotionLayer,
  MotionLayerType,
  type MotionParticleEmitter,
  type MotionParticleShape,
  type MotionShaderDef,
  type MotionShaderFill,
  type MotionShaderParamDef,
  type MotionShapeModifierPropertyName,
  type MotionTextAnimator,
  type MotionTextAnimatorBasedOn,
  type MotionTextAnimatorDirection,
  type MotionTextAnimatorEasing,
  type MotionTextShaderRef,
  type BlendMode,
} from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import { useMotionStore } from "../stores/motion-store";
import {
  Button,
  ColorInput,
  Field,
  NumberInput,
  Section,
  SegmentedControl,
  Slider,
  TextArea,
  TextInput,
  IconButton,
} from "./primitives";
import { Scene3DInspector } from "./inspector/Scene3DInspector";
import { GenerateShaderBox } from "./GenerateShaderBox";
import { ShapeContentsSection } from "./ShapeContentsSection";
import { ShaderPreviewBrowser } from "../../components/shaders/ShaderPreviewBrowser";

interface PropertiesPanelProps {
  composition: MotionComposition;
  embedded?: boolean;
}

const TYPE_META: Record<MotionLayerType, { icon: typeof Type; label: Parameters<typeof editorMessage>[0] }> = {
  text: { icon: Type, label: "editor.motion.properties.type.text" },
  shape: { icon: Square, label: "editor.motion.properties.type.shape" },
  image: { icon: ImageIcon, label: "editor.motion.properties.type.image" },
  group: { icon: Settings2, label: "editor.motion.properties.type.group" },
  null: { icon: Crosshair, label: "editor.motion.properties.type.null" },
  video: { icon: Film, label: "editor.motion.properties.type.video" },
  composition: { icon: Clapperboard, label: "editor.motion.properties.type.composition" },
  adjustment: { icon: SlidersHorizontal, label: "editor.motion.properties.type.adjustment" },
  particle: { icon: Sparkles, label: "editor.motion.properties.type.particle" },
  scene3d: { icon: Box, label: "editor.motion.properties.type.scene3d" },
};

const SHAPE_OPTIONS = [
  "rectangle",
  "circle",
  "ellipse",
  "triangle",
  "star",
  "path",
] as const;
const SHAPE_LABEL_KEYS = {
  "rectangle": "editor.motion.properties.shapeType.rectangle",
  "circle": "editor.motion.properties.shapeType.circle",
  "ellipse": "editor.motion.properties.shapeType.ellipse",
  "triangle": "editor.motion.properties.shapeType.triangle",
  "star": "editor.motion.properties.shapeType.star",
  "path": "editor.motion.properties.shapeType.path",
} as const;

const LIGHT_TYPE_OPTIONS = ["ambient", "point", "directional"] as const;
const LIGHT_TYPE_LABELS = {
  ambient: "editor.motion.properties.lightType.ambient",
  point: "editor.motion.properties.lightType.point",
  directional: "editor.motion.properties.lightType.directional",
} as const;

const ENVIRONMENT_LABEL_KEYS = {
  "studio": "editor.motion.properties.environment.studio",
  "warm": "editor.motion.properties.environment.warm",
  "cool": "editor.motion.properties.environment.cool",
  "sunset": "editor.motion.properties.environment.sunset",
  "city": "editor.motion.properties.environment.city",
  "dark": "editor.motion.properties.environment.dark",
  "none": "editor.motion.properties.environment.none",
} as const;

const LIGHT_NAME_KEYS = {
  ambient: "editor.motion.properties.lightName.ambient",
  point: "editor.motion.properties.lightName.point",
  directional: "editor.motion.properties.lightName.directional",
} as const;

const FONT_FAMILY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "Inter", label: "Inter" },
  { value: "Roboto", label: "Roboto" },
  { value: "Montserrat", label: "Montserrat" },
  { value: "Poppins", label: "Poppins" },
  { value: "Playfair Display", label: "Playfair Display" },
  { value: "Georgia", label: "Georgia" },
  { value: "Arial", label: "Arial" },
  { value: "Helvetica", label: "Helvetica" },
  { value: "Courier New", label: "Courier New" },
];

const FONT_WEIGHT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "300", label: "Light" },
  { value: "400", label: "Regular" },
  { value: "500", label: "Medium" },
  { value: "600", label: "Semi Bold" },
  { value: "700", label: "Bold" },
  { value: "800", label: "Extra Bold" },
  { value: "900", label: "Black" },
];

const FONT_WEIGHT_LABEL_KEYS = {
  "300": "editor.motion.properties.weight.300",
  "400": "editor.motion.properties.weight.400",
  "500": "editor.motion.properties.weight.500",
  "600": "editor.motion.properties.weight.600",
  "700": "editor.motion.properties.weight.700",
  "800": "editor.motion.properties.weight.800",
  "900": "editor.motion.properties.weight.900",
} as const;

function FlatRow({
  label,
  labelWidth = 62,
  leading,
  children,
}: {
  label: string;
  labelWidth?: number;
  leading?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <span
        className="shrink-0 text-[13px] font-medium text-fg-3"
        style={{ width: labelWidth }}
      >
        {label}
      </span>
      {leading ?? null}
      <div className="flex min-w-0 flex-1 items-center gap-1.5">{children}</div>
    </div>
  );
}

function AxisPill({
  axis,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
}: {
  axis: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}): JSX.Element {
  return (
    <label className="flex min-w-0 flex-1 items-center gap-1.5 rounded-[7px] border border-border bg-bg-1 px-[9px] py-[6px] transition-colors focus-within:border-accent">
      <span className="shrink-0 text-[12px] font-medium text-fg-muted" aria-hidden>
        {axis}
      </span>
      <input
        type="number"
        inputMode="decimal"
        aria-label={editorMessage("editor.motion.properties.axisValue", { axis })}
        value={Number.isFinite(value) ? value : 0}
        min={min}
        max={max}
        step={step}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(next);
        }}
        className="min-w-0 flex-1 appearance-none bg-transparent text-[13px] font-medium tabular-nums text-fg-2 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      {unit ? (
        <span className="pointer-events-none shrink-0 text-[12px] font-medium text-fg-muted">
          {unit}
        </span>
      ) : null}
    </label>
  );
}

function SelectControl<T extends string>({
  value,
  options,
  groups,
  onChange,
  label = editorMessage("editor.motion.properties.selectOption"),
  preserveOptions = false,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  groups?: Array<{ label: string; options: Array<{ value: T; label: string }> }>;
  onChange: (value: T) => void;
  label?: string;
  preserveOptions?: boolean;
}): JSX.Element {
  return (
    <div className="relative flex items-center rounded-[7px] border border-border bg-bg-1">
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="w-full cursor-pointer appearance-none truncate bg-transparent py-2 pl-[10px] pr-[26px] text-[13px] font-medium text-fg-2 outline-none"
      >
        {groups
          ? groups.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.options.map((option) => (
                  <option data-shotloom-user-content={preserveOptions ? "" : undefined} key={String(option.value)} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
            ))
          : options.map((option) => (
              <option data-shotloom-user-content={preserveOptions ? "" : undefined} key={String(option.value)} value={option.value}>
                {option.label}
              </option>
            ))}
      </select>
      <svg
        className="pointer-events-none absolute right-[10px]"
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--fg-muted)"
        strokeWidth="2.2"
        aria-hidden
      >
        <path d="M6 9l6 6 6-6" />
      </svg>
    </div>
  );
}

function ToggleControl({
  label,
  checked,
  onChange,
  icon: Icon,
  description,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  icon?: typeof Star;
  description?: string;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-bg-1 px-3 py-2.5">
      <span className="min-w-0">
        <ToolcraftText
          type="supporting"
          color="secondary"
          weight="medium"
          className="flex items-center gap-1.5 text-[13px]"
        >
          {Icon ? <Icon size={12} aria-hidden /> : null}
          {label}
        </ToolcraftText>
        {description ? (
          <ToolcraftText type="supporting" color="secondary" className="mt-0.5 block text-[10.5px]">
            {description}
          </ToolcraftText>
        ) : null}
      </span>
      <ToolcraftSwitchControl
        ariaLabel={label}
        checked={checked}
        onCheckedChange={onChange}
        showLabel={false}
      />
    </div>
  );
}

export function PropertiesPanel({ composition, embedded = false }: PropertiesPanelProps): JSX.Element {
  const selectedLayerId = useMotionStore((state) => state.selectedLayerId);
  const selectedLayerIds = useMotionStore((state) => state.selectedLayerIds);
  const selectedLightId = useMotionStore((state) => state.selectedLightId);
  const selectedProperty = useMotionStore((state) => state.selectedProperty);
  const selectLight = useMotionStore((state) => state.selectLight);
  const setSelectedLayers = useMotionStore((state) => state.setSelectedLayers);
  const setSelectedProperty = useMotionStore((state) => state.setSelectedProperty);
  const setRightTab = useMotionStore((state) => state.setRightTab);
  const playhead = useMotionStore((state) => state.playhead);
  const autoKeyframe = useMotionStore((state) => state.autoKeyframe);
  const upsertMotionComposition = useProjectStore(
    (state) => state.upsertMotionComposition,
  );
  const motionCompositions = useProjectStore(
    (state) => state.project.motionCompositions ?? [],
  );
  const selectedLayer =
    composition.layers.find((layer) => layer.id === selectedLayerId) ?? null;
  const selectedLayerIdSet = new Set(selectedLayerIds);
  const selectedLayers = composition.layers.filter((layer) =>
    selectedLayerIdSet.has(layer.id),
  );
  const hasMultiLayerSelection = selectedLayers.length > 1;
  const motionBlurSettings = normalizeMotionBlurSettings(composition.motionBlur);
  const baseCamera = normalizeMotionCamera(composition);
  const camera = getMotionCameraAtTime(composition, playhead);
  const cameraLocalTime = Math.min(
    composition.duration,
    Math.max(0, playhead),
  );
  const guides = composition.guides ?? [];
  const lights = normalizeMotionLights(composition);
  const selectedLight =
    lights.find((light) => light.id === selectedLightId) ?? null;
  const selectedLayerLocalTime = selectedLayer
    ? Math.min(
        selectedLayer.duration,
        Math.max(0, playhead - selectedLayer.startTime),
      )
    : 0;
  const getLayerPropertyInspectorValue = (
    property: MotionAnimatableProperty,
  ): number =>
    selectedLayer
      ? getMotionLayerPropertyValueAtTime(
          selectedLayer,
          property,
          selectedLayerLocalTime,
          composition,
        )
      : 0;

  const updateComposition = (updates: Partial<MotionComposition>) => {
    void upsertMotionComposition({
      ...composition,
      ...updates,
      modifiedAt: Date.now(),
    });
  };

  const replaceComposition = (nextComposition: MotionComposition) => {
    void upsertMotionComposition(nextComposition);
  };

  const replaceLayer = (nextLayer: MotionLayer) => {
    const nextLayers = composition.layers.map((layer) =>
      layer.id === nextLayer.id ? nextLayer : layer,
    );
    updateComposition({ layers: nextLayers });
  };

  const patchLayer = (updates: Partial<MotionLayer>) => {
    if (!selectedLayer) return;
    replaceLayer({ ...selectedLayer, ...updates } as MotionLayer);
  };

  const setTransformProperty = (
    property: MotionAnimatableProperty,
    value: number,
  ) => {
    if (!selectedLayer) return;
    const hasAnimatedProperty =
      getMotionLayerPropertyKeyframes(selectedLayer, property).length > 0;
    if (autoKeyframe || hasAnimatedProperty) {
      replaceLayer(
        upsertMotionLayerKeyframe(selectedLayer, property, selectedLayerLocalTime, {
          value,
          easing: "ease",
        }),
      );
      setSelectedProperty(property);
      return;
    }
    replaceLayer(setMotionLayerPropertyValue(selectedLayer, property, value));
  };

  const setSelectionTransformProperty = (
    property: MotionAnimatableProperty,
    value: number,
  ) => {
    if (!hasMultiLayerSelection) return;
    const layers = composition.layers.map((layer) => {
      if (!selectedLayerIdSet.has(layer.id) || layer.locked) return layer;
      const localTime = Math.min(
        layer.duration,
        Math.max(0, playhead - layer.startTime),
      );
      const hasAnimatedProperty =
        getMotionLayerPropertyKeyframes(layer, property).length > 0;
      return autoKeyframe || hasAnimatedProperty
        ? upsertMotionLayerKeyframe(layer, property, localTime, {
            value,
            easing: "ease",
          })
        : setMotionLayerPropertyValue(layer, property, value);
    });
    updateComposition({ layers });
    setSelectedProperty(property);
  };

  const alignSelection = (alignment: MotionLayerAlignment) => {
    replaceComposition(
      alignMotionLayers(composition, selectedLayerIds, alignment, {
        relativeTo: "selection",
      }),
    );
  };

  const distributeSelection = (axis: MotionLayerDistributionAxis) => {
    replaceComposition(distributeMotionLayers(composition, selectedLayerIds, axis));
  };

  const setSelectionVisible = (visible: boolean) => {
    replaceComposition(setMotionLayersVisible(composition, selectedLayerIds, visible));
  };

  const setSelectionLocked = (locked: boolean) => {
    replaceComposition(setMotionLayersLocked(composition, selectedLayerIds, locked));
  };

  const duplicateSelection = () => {
    const result = duplicateMotionLayers(composition, selectedLayerIds);
    replaceComposition(result.composition);
    setSelectedLayers(result.duplicatedLayerIds);
  };

  const deleteSelection = () => {
    replaceComposition(removeMotionLayers(composition, selectedLayerIds));
    setSelectedLayers([]);
  };

  const patchMotionBlurSettings = (
    updates: Partial<typeof DEFAULT_MOTION_BLUR_SETTINGS>,
  ) => {
    updateComposition({
      motionBlur: {
        ...motionBlurSettings,
        ...updates,
      },
    });
  };

  const enableCamera = (enabled: boolean) => {
    updateComposition({
      camera: {
        ...(composition.camera ?? createDefaultMotionCamera(composition)),
        enabled,
      },
    });
  };

  const setCameraProperty = (
    property: MotionCameraProperty,
    value: number,
  ) => {
    const enabledCamera = {
      ...baseCamera,
      enabled: true,
    };
    const nextCamera = autoKeyframe
      ? upsertMotionCameraKeyframe(enabledCamera, property, cameraLocalTime, {
          value,
          easing: "ease",
        })
      : setMotionCameraPropertyValue(enabledCamera, property, value);
    updateComposition({ camera: nextCamera });
    setSelectedProperty(property);
  };

  const toggleCameraKeyframe = (property: MotionCameraProperty) => {
    const enabledCamera = {
      ...baseCamera,
      enabled: true,
    };
    const activeKeyframe = findMotionCameraKeyframeAtTime(
      enabledCamera,
      property,
      cameraLocalTime,
    );
    const nextCamera = activeKeyframe
      ? removeMotionCameraKeyframe(enabledCamera, activeKeyframe.id)
      : upsertMotionCameraKeyframe(enabledCamera, property, cameraLocalTime, {
          value: getMotionCameraPropertyValue(camera, property),
          easing: "ease",
        });
    updateComposition({ camera: nextCamera });
    setSelectedProperty(property);
  };

  const setCameraDepthOfFieldEnabled = (enabled: boolean) => {
    updateComposition({
      camera: setMotionCameraDepthOfFieldEnabled(
        {
          ...baseCamera,
          enabled: enabled ? true : baseCamera.enabled,
        },
        enabled,
      ),
    });
  };

  const addGuide = (orientation: MotionGuideOrientation) => {
    const position =
      orientation === "vertical" ? composition.width / 2 : composition.height / 2;
    replaceComposition(
      addMotionCompositionGuide(
        composition,
        createMotionGuide(orientation, position),
      ),
    );
  };

  const addLight = (type: MotionLightType) => {
    replaceComposition(
      addMotionCompositionLight(composition, createMotionLight(type, composition, { name: editorMessage(LIGHT_NAME_KEYS[type]) })),
    );
  };

  const updateLight = (
    lightId: string,
    updater: (light: MotionLight) => MotionLight,
  ) => {
    replaceComposition(updateMotionCompositionLight(composition, lightId, updater));
  };

  const removeLight = (lightId: string) => {
    replaceComposition(removeMotionCompositionLight(composition, lightId));
  };

  const toggleLight = (lightId: string, enabled: boolean) => {
    replaceComposition(toggleMotionCompositionLight(composition, lightId, enabled));
  };

  const setLightProperty = (
    light: MotionLight,
    property: MotionLightProperty,
    value: number,
  ) => {
    const nextLight = autoKeyframe
      ? upsertMotionLightKeyframe(light, property, cameraLocalTime, {
          value,
          easing: "ease",
        })
      : setMotionLightPropertyValue(light, property, value);
    updateLight(light.id, () => nextLight);
    selectLight(light.id, property);
    setSelectedProperty(property);
  };

  const toggleLightKeyframe = (
    light: MotionLight,
    property: MotionLightProperty,
  ) => {
    const activeKeyframe = findMotionLightKeyframeAtTime(
      light,
      property,
      cameraLocalTime,
    );
    const animatedLight = getMotionLightAtTime(light, composition, cameraLocalTime);
    const nextLight = activeKeyframe
      ? removeMotionLightKeyframe(light, activeKeyframe.id)
      : upsertMotionLightKeyframe(light, property, cameraLocalTime, {
          value: getMotionLightPropertyValue(animatedLight, property),
          easing: "ease",
        });
    updateLight(light.id, () => nextLight);
    selectLight(light.id, property);
    setSelectedProperty(property);
  };

  const reparentLayer = (parentId: string | null) => {
    if (!selectedLayer) return;
    void upsertMotionComposition(
      setMotionLayerParent(composition, selectedLayer.id, parentId),
    );
  };

  const addPropertyKeyframe = (property: MotionAnimatableProperty) => {
    if (!selectedLayer) return;
    const localTime = Math.min(
      selectedLayer.duration,
      Math.max(0, playhead - selectedLayer.startTime),
    );
    const nextLayer = upsertMotionLayerKeyframe(
      selectedLayer,
      property,
      localTime,
      {
        value: getMotionLayerPropertyValueAtTime(
          selectedLayer,
          property,
          localTime,
          composition,
        ),
        easing: "ease",
      },
    );
    replaceLayer(nextLayer);
    setSelectedProperty(property);
    setRightTab("graph");
  };

  const togglePropertyKeyframe = (property: MotionAnimatableProperty) => {
    if (!selectedLayer) return;
    const localTime = Math.min(
      selectedLayer.duration,
      Math.max(0, playhead - selectedLayer.startTime),
    );
    const keyframeAtPlayhead = findMotionLayerKeyframeAtTime(
      selectedLayer,
      property,
      localTime,
    );
    if (keyframeAtPlayhead) {
      replaceLayer(removeMotionLayerKeyframe(selectedLayer, keyframeAtPlayhead.id));
      setSelectedProperty(property);
      return;
    }
    addPropertyKeyframe(property);
  };

  const clearPropertyKeyframes = (property: MotionAnimatableProperty) => {
    if (!selectedLayer) return;
    replaceLayer(removeMotionLayerPropertyKeyframes(selectedLayer, property));
  };

  const addShapePathKeyframe = (
    layer: Extract<MotionLayer, { type: "shape" }>,
  ) => {
    const localTime = Math.min(
      layer.duration,
      Math.max(0, playhead - layer.startTime),
    );
    replaceLayer(
      upsertMotionShapePathKeyframe(layer, localTime, {
        pathData: layer.pathData,
        easing: "ease",
      }),
    );
  };

  const clearShapePathKeyframes = (
    layer: Extract<MotionLayer, { type: "shape" }>,
  ) => {
    replaceLayer(
      removeMotionLayerPropertyKeyframes(
        layer,
        MOTION_SHAPE_PATH_DATA_PROPERTY,
      ),
    );
  };

  const HeaderIcon = hasMultiLayerSelection
    ? Layers
    : selectedLayer
      ? TYPE_META[selectedLayer.type].icon
      : Settings2;
  const selectionOpacity =
    selectedLayers.reduce((total, layer) => {
      const localTime = Math.min(
        layer.duration,
        Math.max(0, playhead - layer.startTime),
      );
      return (
        total +
        getMotionLayerPropertyValueAtTime(
          layer,
          "transform.opacity",
          localTime,
          composition,
        )
      );
    }, 0) / Math.max(1, selectedLayers.length);
  const allSelectionVisible = selectedLayers.every((layer) => layer.visible);
  const allSelectionLocked = selectedLayers.every((layer) => layer.locked);

  return (
    <div className={embedded ? "" : "flex h-full min-h-0 flex-col"}>
      {embedded ? null : (
        <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border px-4">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-bg-2 text-fg-3">
            <HeaderIcon size={15} />
          </span>
          <span className="min-w-0">
            <span data-shotloom-user-content={selectedLayer && !hasMultiLayerSelection ? "" : undefined} className="block truncate text-[13px] font-semibold leading-tight text-fg">
              {hasMultiLayerSelection
                ? editorMessage("editor.motion.properties.selected", { count: selectedLayers.length })
                : selectedLayer
                  ? selectedLayer.name
                  : editorMessage("editor.motion.properties.composition")}
            </span>
            <span className="block text-[11px] font-medium leading-tight text-fg-muted">
              {hasMultiLayerSelection
                ? editorMessage("editor.motion.properties.multiInspector")
                : selectedLayer
                  ? editorMessage(TYPE_META[selectedLayer.type].label)
                  : editorMessage("editor.motion.properties.sceneSettings")}
            </span>
          </span>
        </div>
      )}

      <div className={embedded ? "" : "min-h-0 flex-1 overflow-auto"}>
        {hasMultiLayerSelection ? (
          <>
            <Section title={editorMessage("editor.motion.properties.align")} icon={AlignCenter} keepOpenInAccordion>
              <div
                className="grid grid-cols-8 gap-1 rounded-lg border border-border bg-bg-1 p-1"
                role="group"
                aria-label={editorMessage("editor.motion.properties.alignSelection")}
              >
                <IconButton
                  label={editorMessage("editor.motion.properties.left")}
                  icon={AlignHorizontalJustifyStart}
                  variant="outline"
                  onClick={() => alignSelection("left")}
                />
                <IconButton
                  label={editorMessage("editor.motion.properties.centerX")}
                  icon={AlignHorizontalJustifyCenter}
                  variant="outline"
                  onClick={() => alignSelection("center-x")}
                />
                <IconButton
                  label={editorMessage("editor.motion.properties.right")}
                  icon={AlignHorizontalJustifyEnd}
                  variant="outline"
                  onClick={() => alignSelection("right")}
                />
                <IconButton
                  label={editorMessage("editor.motion.properties.top")}
                  icon={AlignVerticalJustifyStart}
                  variant="outline"
                  onClick={() => alignSelection("top")}
                />
                <IconButton
                  label={editorMessage("editor.motion.properties.centerY")}
                  icon={AlignVerticalJustifyCenter}
                  variant="outline"
                  onClick={() => alignSelection("center-y")}
                />
                <IconButton
                  label={editorMessage("editor.motion.properties.bottom")}
                  icon={AlignVerticalJustifyEnd}
                  variant="outline"
                  onClick={() => alignSelection("bottom")}
                />
                <IconButton
                  label={editorMessage("editor.motion.properties.horizontal")}
                  icon={AlignHorizontalDistributeCenter}
                  variant="outline"
                  disabled={selectedLayers.length < 3}
                  onClick={() => distributeSelection("horizontal")}
                />
                <IconButton
                  label={editorMessage("editor.motion.properties.vertical")}
                  icon={AlignVerticalDistributeCenter}
                  variant="outline"
                  disabled={selectedLayers.length < 3}
                  onClick={() => distributeSelection("vertical")}
                />
              </div>
            </Section>

            <Section title={editorMessage("editor.motion.properties.appearance")} icon={SlidersHorizontal} keepOpenInAccordion>
              <FlatRow label={editorMessage("editor.motion.properties.averageOpacity")}>
                <Slider
                  value={selectionOpacity}
                  onChange={(opacity) =>
                    setSelectionTransformProperty("transform.opacity", opacity)
                  }
                />
              </FlatRow>
              <div className="grid grid-cols-2 gap-1.5">
                <Button
                  label={allSelectionVisible ? editorMessage("editor.motion.properties.hideAll") : editorMessage("editor.motion.properties.showAll")}
                  icon={allSelectionVisible ? EyeOff : Eye}
                  onClick={() => setSelectionVisible(!allSelectionVisible)}
                />
                <Button
                  label={allSelectionLocked ? editorMessage("editor.motion.properties.unlockAll") : editorMessage("editor.motion.properties.lockAll")}
                  icon={allSelectionLocked ? Unlock : Lock}
                  onClick={() => setSelectionLocked(!allSelectionLocked)}
                />
              </div>
            </Section>

            <Section title={editorMessage("editor.motion.properties.selectionActions")} icon={Layers} keepOpenInAccordion>
              <div className="grid grid-cols-2 gap-1.5">
                <Button
                  label={editorMessage("editor.motion.properties.duplicate")}
                  icon={Copy}
                  onClick={duplicateSelection}
                />
                <Button
                  label={editorMessage("editor.motion.properties.delete")}
                  icon={Trash2}
                  variant="danger"
                  onClick={deleteSelection}
                />
              </div>
              <p className="mt-2 text-[10.5px] leading-relaxed text-fg-muted">
                {editorMessage("editor.motion.properties.changes")}
              </p>
            </Section>
          </>
        ) : selectedLayer ? (
          <>
            <Section title={editorMessage("editor.motion.properties.transform")} icon={Move} keepOpenInAccordion>
              <FlatRow label={editorMessage("editor.motion.properties.position")}>
                <AxisPill
                  axis="X"
                  value={getLayerPropertyInspectorValue("transform.position.x")}
                  onChange={(x) =>
                    setTransformProperty("transform.position.x", x)
                  }
                />
                <AxisPill
                  axis="Y"
                  value={getLayerPropertyInspectorValue("transform.position.y")}
                  onChange={(y) =>
                    setTransformProperty("transform.position.y", y)
                  }
                />
                <AxisPill
                  axis="Z"
                  value={getLayerPropertyInspectorValue("transform.position.z")}
                  onChange={(z) =>
                    setTransformProperty("transform.position.z", z)
                  }
                />
              </FlatRow>
              <FlatRow
                label={editorMessage("editor.motion.properties.scale")}
                leading={
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--fg-muted)"
                    strokeWidth="1.8"
                    aria-hidden
                    className="shrink-0"
                  >
                    <path d="M8 12h8M10 8a3 3 0 0 1 0 6M14 8a3 3 0 0 0 0 6" />
                  </svg>
                }
              >
                <AxisPill
                  axis="X"
                  value={getLayerPropertyInspectorValue("transform.scale.x")}
                  step={0.05}
                  onChange={(x) =>
                    setTransformProperty("transform.scale.x", x)
                  }
                />
                <AxisPill
                  axis="Y"
                  value={getLayerPropertyInspectorValue("transform.scale.y")}
                  step={0.05}
                  onChange={(y) =>
                    setTransformProperty("transform.scale.y", y)
                  }
                />
              </FlatRow>
              <FlatRow label={editorMessage("editor.motion.properties.rotation")}>
                <AxisPill
                  axis="X"
                  value={getLayerPropertyInspectorValue("transform.rotation.x")}
                  unit="°"
                  onChange={(rotation) =>
                    setTransformProperty("transform.rotation.x", rotation)
                  }
                />
                <AxisPill
                  axis="Y"
                  value={getLayerPropertyInspectorValue("transform.rotation.y")}
                  unit="°"
                  onChange={(rotation) =>
                    setTransformProperty("transform.rotation.y", rotation)
                  }
                />
                <AxisPill
                  axis="Z"
                  value={getLayerPropertyInspectorValue("transform.rotation")}
                  unit="°"
                  onChange={(rotation) =>
                    setTransformProperty("transform.rotation", rotation)
                  }
                />
              </FlatRow>
              <FlatRow label={editorMessage("editor.motion.properties.anchor")}>
                <AxisPill
                  axis="X"
                  value={getLayerPropertyInspectorValue("transform.anchor.x")}
                  step={0.05}
                  onChange={(x) =>
                    setTransformProperty("transform.anchor.x", x)
                  }
                />
                <AxisPill
                  axis="Y"
                  value={getLayerPropertyInspectorValue("transform.anchor.y")}
                  step={0.05}
                  onChange={(y) =>
                    setTransformProperty("transform.anchor.y", y)
                  }
                />
              </FlatRow>
              <FlatRow label={editorMessage("editor.motion.properties.opacity")}>
                <Slider
                  value={getLayerPropertyInspectorValue("transform.opacity")}
                  onChange={(opacity) =>
                    setTransformProperty("transform.opacity", opacity)
                  }
                />
              </FlatRow>
              <FlatRow label={editorMessage("editor.motion.properties.perspective")}>
                <AxisPill
                  axis="px"
                  value={getLayerPropertyInspectorValue("transform.perspective")}
                  min={1}
                  step={25}
                  onChange={(perspective) =>
                    setTransformProperty("transform.perspective", perspective)
                  }
                />
              </FlatRow>
              <ToggleControl
                label={editorMessage("editor.motion.properties.preserve3d")}
                checked={selectedLayer.transform.transformStyle === "preserve-3d"}
                onChange={(checked) =>
                  patchLayer({
                    transform: {
                      ...selectedLayer.transform,
                      transformStyle: checked ? "preserve-3d" : "flat",
                    },
                  } as Partial<MotionLayer>)
                }
              />
            </Section>

            <Section title={editorMessage("editor.motion.properties.options")} defaultOpen={false}>
              <Field label={editorMessage("editor.motion.properties.name")}>
                <TextInput
                  value={selectedLayer.name}
                  onChange={(name) => patchLayer({ name } as Partial<MotionLayer>)}
                />
              </Field>
              <Field label={editorMessage("editor.motion.properties.parent")}>
                <SelectControl
                  label={editorMessage("editor.motion.properties.parent")}
                  preserveOptions
                  value={selectedLayer.parentId ?? ""}
                  options={[
                    { value: "", label: editorMessage("editor.motion.properties.none") },
                    ...composition.layers
                      .filter((layer) =>
                        canParentMotionLayer(
                          composition,
                          selectedLayer.id,
                          layer.id,
                        ),
                      )
                      .map((layer) => ({
                        value: layer.id,
                        label: layer.name,
                      })),
                  ]}
                  onChange={(parentId) => reparentLayer(parentId || null)}
                />
              </Field>
              <FlatRow label={editorMessage("editor.motion.properties.blending")} labelWidth={90}>
                <SelectControl
                  label={editorMessage("editor.motion.properties.blendMode")}
                  value={selectedLayer.blendMode ?? "normal"}
                  options={MOTION_BLEND_MODE_OPTIONS.map((mode) => ({
                    value: mode.id,
                    label: motionBlendModeLabel(mode.id),
                  }))}
                  onChange={(blendMode) =>
                    patchLayer({
                      blendMode: blendMode as BlendMode,
                    } as Partial<MotionLayer>)
                  }
                />
              </FlatRow>
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-medium text-fg-3">
                  {editorMessage("editor.motion.properties.motionBlur")}
                </span>
                <ToolcraftSwitchControl
                  ariaLabel={editorMessage("editor.motion.properties.motionBlurLabel")}
                  checked={selectedLayer.motionBlur ?? false}
                  onCheckedChange={(checked) =>
                    patchLayer({
                      motionBlur: checked,
                    } as Partial<MotionLayer>)
                  }
                  showLabel={false}
                />
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <ToggleControl
                  label={editorMessage("editor.motion.properties.solo")}
                  icon={Star}
                  checked={selectedLayer.solo ?? false}
                  onChange={(checked) =>
                    patchLayer({
                      solo: checked,
                    } as Partial<MotionLayer>)
                  }
                />
                <ToggleControl
                  label={editorMessage("editor.motion.properties.guide")}
                  icon={Ruler}
                  checked={selectedLayer.guideLayer ?? false}
                  onChange={(checked) =>
                    patchLayer({
                      guideLayer: checked,
                    } as Partial<MotionLayer>)
                  }
                />
              </div>
              <ToggleControl
                label={editorMessage("editor.motion.properties.orient")}
                checked={selectedLayer.autoOrient ?? false}
                onChange={(checked) =>
                  patchLayer({
                    autoOrient: checked,
                  } as Partial<MotionLayer>)
                }
              />
            </Section>

            <Section title={editorMessage("editor.motion.properties.animation")} icon={Diamond}>
              <div className="space-y-1.5">
                {getLayerAnimationProperties(selectedLayer).map((property) => {
                  const keyframes = getMotionLayerPropertyKeyframes(
                    selectedLayer,
                    property.property,
                  );
                  const localTime = Math.min(
                    selectedLayer.duration,
                    Math.max(0, playhead - selectedLayer.startTime),
                  );
                  const activeAtPlayhead = Boolean(
                    findMotionLayerKeyframeAtTime(
                      selectedLayer,
                      property.property,
                      localTime,
                    ),
                  );
                  const selected = selectedProperty === property.property;
                  return (
                    <div
                      key={property.property}
                      className={`flex items-center gap-1.5 rounded-lg border p-1.5 transition-colors ${
                        selected
                          ? "border-accent bg-accent-soft"
                          : "border-border bg-bg-1 hover:border-border-strong"
                      }`}
                    >
                      <Button
                        label={editorMessage("editor.motion.properties.propertyKeys", { name: motionPropertyLabel(property.property, property.label, selectedLayer), count: keyframes.length })}
                        variant="ghost"
                        size="sm"
                        className="min-w-0 flex-1 justify-start"
                        onClick={() => {
                          setSelectedProperty(property.property);
                          setRightTab("graph");
                        }}
                      />
                      <IconButton
                        icon={Diamond}
                        label={activeAtPlayhead ? editorMessage("editor.motion.properties.removeKeyframe") : editorMessage("editor.motion.properties.addKeyframe")}
                        active={activeAtPlayhead}
                        variant={activeAtPlayhead ? "solid" : "ghost"}
                        iconSize={13}
                        onClick={() => togglePropertyKeyframe(property.property)}
                      />
                      {keyframes.length > 0 ? (
                        <IconButton
                          icon={Trash2}
                          label={editorMessage("editor.motion.properties.disableAnimation")}
                          variant="danger"
                          iconSize={13}
                          onClick={() =>
                            clearPropertyKeyframes(property.property)
                          }
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </Section>

            <Section title={editorMessage("editor.motion.properties.timing")} icon={Clock}>
              <div className="grid grid-cols-2 gap-2.5">
                <Field label={editorMessage("editor.motion.properties.start")}>
                  <NumberInput
                    value={selectedLayer.startTime}
                    min={0}
                    step={0.1}
                    unit="s"
                    onChange={(startTime) =>
                      patchLayer({
                        startTime,
                      } as Partial<MotionLayer>)
                    }
                  />
                </Field>
                <Field label={editorMessage("editor.motion.properties.duration")}>
                  <NumberInput
                    value={selectedLayer.duration}
                    min={0.1}
                    step={0.1}
                    unit="s"
                    onChange={(duration) =>
                      patchLayer({ duration } as Partial<MotionLayer>)
                    }
                  />
                </Field>
              </div>
            </Section>

            {selectedLayer.type === "text" ? (
              <>
                <Section title={editorMessage("editor.motion.properties.text")} icon={Type}>
                  <Field label={editorMessage("editor.motion.properties.content")}>
                    <TextArea
                      value={selectedLayer.text}
                      onChange={(text) => patchLayer({ text } as Partial<MotionLayer>)}
                    />
                  </Field>
                  <SelectControl
                    label={editorMessage("editor.motion.properties.fontFamily")}
                    preserveOptions
                    value={selectedLayer.style.fontFamily}
                    options={FONT_FAMILY_OPTIONS.some(
                      (option) => option.value === selectedLayer.style.fontFamily,
                    )
                      ? FONT_FAMILY_OPTIONS
                      : [
                          {
                            value: selectedLayer.style.fontFamily,
                            label: selectedLayer.style.fontFamily,
                          },
                          ...FONT_FAMILY_OPTIONS,
                        ]}
                    onChange={(fontFamily) =>
                      patchLayer({
                        style: { ...selectedLayer.style, fontFamily },
                      } as Partial<MotionLayer>)
                    }
                  />
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <SelectControl
                        label={editorMessage("editor.motion.properties.fontWeight")}
                        value={String(selectedLayer.style.fontWeight ?? 700)}
                        options={FONT_WEIGHT_OPTIONS.map(option => ({ ...option, label: editorMessage(FONT_WEIGHT_LABEL_KEYS[option.value as keyof typeof FONT_WEIGHT_LABEL_KEYS]) }))}
                        onChange={(weight) =>
                          patchLayer({
                            style: {
                              ...selectedLayer.style,
                              fontWeight: Number(weight),
                            },
                          } as Partial<MotionLayer>)
                        }
                      />
                    </div>
                    <div className="w-[96px] shrink-0">
                      <NumberInput
                        value={selectedLayer.style.fontSize}
                        min={8}
                        unit="px"
                        onChange={(fontSize) =>
                          patchLayer({
                            style: { ...selectedLayer.style, fontSize },
                          } as Partial<MotionLayer>)
                        }
                      />
                    </div>
                  </div>
                  <SegmentedControl
                    value={(selectedLayer.style.align ?? "center") as "left" | "center" | "right"}
                    options={[
                      { value: "left", icon: AlignLeft },
                      { value: "center", icon: AlignCenter },
                      { value: "right", icon: AlignRight },
                    ]}
                    onChange={(align) =>
                      patchLayer({
                        style: { ...selectedLayer.style, align },
                      } as Partial<MotionLayer>)
                    }
                  />
                  <Field label={editorMessage("editor.motion.properties.fillType")}>
                    <SegmentedControl
                      value={selectedLayer.style.fillShader ? "shader" : "solid"}
                      options={[
                        { value: "solid", label: editorMessage("editor.motion.properties.solid") },
                        { value: "shader", label: editorMessage("editor.motion.shader.title") },
                      ]}
                      onChange={(type) => {
                        const style = selectedLayer.style;
                        if (type === "shader") {
                          patchLayer({
                            style: {
                              ...style,
                              fillShader:
                                style.fillShader ??
                                shaderFillFromDefault(
                                  createDefaultMotionShaderFill(
                                    firstMotionShaderFillId(),
                                  ),
                                ),
                            },
                          } as Partial<MotionLayer>);
                          return;
                        }
                        const { fillShader: _removed, ...rest } = style;
                        patchLayer({ style: rest } as Partial<MotionLayer>);
                      }}
                    />
                  </Field>
                  {selectedLayer.style.fillShader ? (
                    <ShaderFillControls
                      shader={selectedLayer.style.fillShader}
                      previewSample="text"
                      onChange={(nextShader) =>
                        patchLayer({
                          style: {
                            ...selectedLayer.style,
                            fillShader: nextShader,
                          },
                        } as Partial<MotionLayer>)
                      }
                    />
                  ) : (
                    <FlatRow label={editorMessage("editor.motion.properties.fill")} labelWidth={56}>
                      <ColorInput
                        value={selectedLayer.style.color}
                        onChange={(color) =>
                          patchLayer({
                            style: { ...selectedLayer.style, color },
                          } as Partial<MotionLayer>)
                        }
                      />
                    </FlatRow>
                  )}
                  <div className="grid grid-cols-2 gap-2.5">
                    <Field label={editorMessage("editor.motion.properties.tracking")}>
                      <NumberInput
                        value={selectedLayer.style.letterSpacing ?? 0}
                        step={0.5}
                        unit="px"
                        onChange={(letterSpacing) =>
                          patchLayer({
                            style: { ...selectedLayer.style, letterSpacing },
                          } as Partial<MotionLayer>)
                        }
                      />
                    </Field>
                    <Field label={editorMessage("editor.motion.properties.leading")}>
                      <NumberInput
                        value={selectedLayer.style.lineHeight ?? 1.1}
                        min={0.5}
                        step={0.05}
                        onChange={(lineHeight) =>
                          patchLayer({
                            style: { ...selectedLayer.style, lineHeight },
                          } as Partial<MotionLayer>)
                        }
                      />
                    </Field>
                  </div>
                  <Field label={editorMessage("editor.motion.properties.boxWidth")} hint={editorMessage("editor.motion.properties.wordWrapHint")}>
                    <NumberInput
                      value={selectedLayer.style.maxWidth ?? 0}
                      min={0}
                      unit="px"
                      onChange={(nextWidth) => {
                        if (!Number.isFinite(nextWidth) || nextWidth <= 0) {
                          const { maxWidth: _cleared, ...rest } =
                            selectedLayer.style;
                          patchLayer({ style: rest } as Partial<MotionLayer>);
                          return;
                        }
                        patchLayer({
                          style: {
                            ...selectedLayer.style,
                            maxWidth: nextWidth,
                          },
                        } as Partial<MotionLayer>);
                      }}
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-2.5">
                    <Field label={editorMessage("editor.motion.properties.stroke")}>
                      <ColorInput
                        value={selectedLayer.style.stroke?.color ?? "#000000"}
                        onChange={(color) =>
                          patchLayer({
                            style: {
                              ...selectedLayer.style,
                              stroke: {
                                color,
                                width: selectedLayer.style.stroke?.width ?? 2,
                                ...(selectedLayer.style.stroke?.over !== undefined
                                  ? { over: selectedLayer.style.stroke.over }
                                  : {}),
                              },
                            },
                          } as Partial<MotionLayer>)
                        }
                      />
                    </Field>
                    <Field label={editorMessage("editor.motion.properties.strokeWidth")} hint={editorMessage("editor.motion.properties.removeStroke")}>
                      <NumberInput
                        value={selectedLayer.style.stroke?.width ?? 0}
                        min={0}
                        step={0.5}
                        unit="px"
                        onChange={(nextWidth) => {
                          if (!Number.isFinite(nextWidth) || nextWidth <= 0) {
                            const { stroke: _clearedStroke, ...rest } =
                              selectedLayer.style;
                            patchLayer({ style: rest } as Partial<MotionLayer>);
                            return;
                          }
                          patchLayer({
                            style: {
                              ...selectedLayer.style,
                              stroke: {
                                color:
                                  selectedLayer.style.stroke?.color ?? "#000000",
                                width: nextWidth,
                                ...(selectedLayer.style.stroke?.over !== undefined
                                  ? { over: selectedLayer.style.stroke.over }
                                  : {}),
                              },
                            },
                          } as Partial<MotionLayer>);
                        }}
                      />
                    </Field>
                  </div>
                </Section>
                <TextAnimatorsSection
                  layer={selectedLayer}
                  replaceLayer={replaceLayer}
                />
                <Section title={editorMessage("editor.motion.shader.animator")} icon={Zap}>
                  <TextShaderAnimatorControls
                    layer={selectedLayer}
                    replaceLayer={replaceLayer}
                  />
                </Section>
              </>
            ) : null}

            {selectedLayer.type === "scene3d" ? (
              <Scene3DInspector
                layer={selectedLayer}
                replaceLayer={replaceLayer}
              />
            ) : null}

            {selectedLayer.type === "scene3d" ? (
              <Section title={editorMessage("editor.motion.properties.lightingEnvironment")} icon={Lightbulb}>
                <Field label={editorMessage("editor.motion.properties.environment")} hint={editorMessage("editor.motion.properties.iblHint")}>
                  <SelectControl
                    label={editorMessage("editor.motion.properties.environment")}
                    value={selectedLayer.lighting?.environment ?? "studio"}
                    options={[
                      "studio",
                      "warm",
                      "cool",
                      "sunset",
                      "city",
                      "dark",
                      "none",
                    ].map((option) => ({
                      value: option,
                      label: editorMessage(ENVIRONMENT_LABEL_KEYS[option as keyof typeof ENVIRONMENT_LABEL_KEYS]),
                    }))}
                    onChange={(environment) =>
                      patchLayer({
                        lighting: {
                          ...selectedLayer.lighting,
                          environment: environment as NonNullable<
                            typeof selectedLayer.lighting
                          >["environment"],
                        },
                      } as Partial<MotionLayer>)
                    }
                  />
                </Field>
                <Field label={editorMessage("editor.motion.properties.hdriUrl")} hint=".hdr / .exr / .jpg / .png">
                  <TextInput
                    value={selectedLayer.lighting?.environmentUrl ?? ""}
                    placeholder="https://…/studio_2k.hdr"
                    onChange={(url) =>
                      patchLayer({
                        lighting: {
                          ...selectedLayer.lighting,
                          environmentUrl: url.trim() ? url.trim() : undefined,
                        },
                      } as Partial<MotionLayer>)
                    }
                  />
                </Field>
                <ToggleControl
                  label={editorMessage("editor.motion.properties.showBackdrop")}
                  checked={selectedLayer.lighting?.environmentBackground ?? false}
                  onChange={(environmentBackground) =>
                    patchLayer({
                      lighting: {
                        ...selectedLayer.lighting,
                        environmentBackground,
                      },
                    } as Partial<MotionLayer>)
                  }
                />
                <ToggleControl
                  label={editorMessage("editor.motion.properties.groundShadow")}
                  checked={selectedLayer.lighting?.groundShadow ?? false}
                  onChange={(groundShadow) =>
                    patchLayer({
                      lighting: {
                        ...selectedLayer.lighting,
                        groundShadow,
                      },
                    } as Partial<MotionLayer>)
                  }
                />
                <div className="grid grid-cols-2 gap-2.5">
                  <Field label={editorMessage("editor.motion.properties.ambient")}>
                    <NumberInput
                      value={selectedLayer.lighting?.ambient ?? 0.55}
                      min={0}
                      max={3}
                      step={0.05}
                      onChange={(ambient) =>
                        patchLayer({
                          lighting: { ...selectedLayer.lighting, ambient },
                        } as Partial<MotionLayer>)
                      }
                    />
                  </Field>
                  <Field label={editorMessage("editor.motion.properties.keyIntensity")}>
                    <NumberInput
                      value={selectedLayer.lighting?.keyIntensity ?? 2.1}
                      min={0}
                      max={10}
                      step={0.1}
                      onChange={(keyIntensity) =>
                        patchLayer({
                          lighting: { ...selectedLayer.lighting, keyIntensity },
                        } as Partial<MotionLayer>)
                      }
                    />
                  </Field>
                  <Field label={editorMessage("editor.motion.properties.rimIntensity")}>
                    <NumberInput
                      value={selectedLayer.lighting?.rimIntensity ?? 1.1}
                      min={0}
                      max={10}
                      step={0.1}
                      onChange={(rimIntensity) =>
                        patchLayer({
                          lighting: { ...selectedLayer.lighting, rimIntensity },
                        } as Partial<MotionLayer>)
                      }
                    />
                  </Field>
                  <Field label={editorMessage("editor.motion.properties.keyColor")}>
                    <ColorInput
                      value={selectedLayer.lighting?.keyColor ?? "#fff2e6"}
                      onChange={(keyColor) =>
                        patchLayer({
                          lighting: { ...selectedLayer.lighting, keyColor },
                        } as Partial<MotionLayer>)
                      }
                    />
                  </Field>
                </div>
              </Section>
            ) : null}

            {selectedLayer.type === "shape" ? (
              <>
                <Section title={editorMessage("editor.motion.properties.shape")} icon={Square}>
                  <Field label={editorMessage("editor.motion.properties.type")}>
                    <SelectControl
                      label={editorMessage("editor.motion.properties.shapeType")}
                      value={selectedLayer.shapeType}
                      options={SHAPE_OPTIONS.map((shape) => ({
                        value: shape,
                        label: editorMessage(SHAPE_LABEL_KEYS[shape]),
                      }))}
                      onChange={(shapeType) => {
                        patchLayer({
                          shapeType,
                          ...(shapeType === "path" && !selectedLayer.pathData
                            ? {
                                pathData: buildDefaultPathData(
                                  selectedLayer.width,
                                  selectedLayer.height,
                                ),
                                pathClosed: true,
                              }
                            : {}),
                        } as unknown as Partial<MotionLayer>);
                      }}
                    />
                  </Field>
                  {selectedLayer.shapeType === "path" ? (
                    <>
                      <Field label={editorMessage("editor.motion.properties.pathData")}>
                        <TextArea
                          value={selectedLayer.pathData ?? ""}
                          placeholder="M -50 -50 L 50 -50 L 50 50 L -50 50 Z"
                          onChange={(pathData) =>
                            patchLayer({
                              pathData,
                            } as Partial<MotionLayer>)
                          }
                        />
                      </Field>
                      <ToggleControl
                        label={editorMessage("editor.motion.properties.closedPath")}
                        checked={selectedLayer.pathClosed ?? true}
                        onChange={(pathClosed) =>
                          patchLayer({
                            pathClosed,
                          } as Partial<MotionLayer>)
                        }
                      />
                      {(() => {
                        const localTime = Math.min(
                          selectedLayer.duration,
                          Math.max(0, playhead - selectedLayer.startTime),
                        );
                        const keyframes = getMotionShapePathKeyframes(selectedLayer);
                        const activeAtPlayhead = Boolean(
                          findMotionShapePathKeyframeAtTime(
                            selectedLayer,
                            localTime,
                          ),
                        );
                        return (
                          <div className="rounded-lg border border-border bg-bg-2 p-2.5">
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-3">
                                {editorMessage("editor.motion.properties.pathMorph")}
                              </span>
                              <span className="text-[10.5px] tabular-nums text-fg-muted">
                                {editorMessage("editor.motion.properties.keysCount", { count: keyframes.length })}
                              </span>
                            </div>
                            <div className="grid grid-cols-2 gap-1.5">
                              <Button
                                label={
                                  activeAtPlayhead
                                    ? editorMessage("editor.motion.properties.updatePathKeyframe")
                                    : editorMessage("editor.motion.properties.addPathKeyframe")
                                }
                                size="sm"
                                variant={activeAtPlayhead ? "primary" : "secondary"}
                                icon={
                                  <Diamond
                                    size={13}
                                    fill={activeAtPlayhead ? "currentColor" : "none"}
                                    aria-hidden
                                  />
                                }
                                onClick={() => addShapePathKeyframe(selectedLayer)}
                              />
                              <Button
                                label={editorMessage("editor.motion.properties.clearPathKeyframes")}
                                size="sm"
                                variant="destructive"
                                icon={<Trash2 size={13} aria-hidden />}
                                isDisabled={keyframes.length === 0}
                                onClick={() => clearShapePathKeyframes(selectedLayer)}
                              />
                            </div>
                          </div>
                        );
                      })()}
                    </>
                  ) : null}
                  <div className="grid grid-cols-2 gap-2.5">
                    <Field label={editorMessage("editor.motion.properties.width")}>
                      <NumberInput
                        value={getLayerPropertyInspectorValue("shape.width")}
                        min={1}
                        unit="px"
                        onChange={(width) =>
                          setTransformProperty("shape.width", width)
                        }
                      />
                    </Field>
                    <Field label={editorMessage("editor.motion.properties.height")}>
                      <NumberInput
                        value={getLayerPropertyInspectorValue("shape.height")}
                        min={1}
                        unit="px"
                        onChange={(height) =>
                          setTransformProperty("shape.height", height)
                        }
                      />
                    </Field>
                  </div>
                  {selectedLayer.shapeType === "star" ||
                  selectedLayer.shapeType === "polygon" ? (
                    <div className="grid grid-cols-2 gap-2.5">
                      <Field label={editorMessage("editor.motion.properties.points")}>
                        <NumberInput
                          value={selectedLayer.style.points ?? 5}
                          min={3}
                          max={24}
                          step={1}
                          onChange={(points) => {
                            if (!Number.isFinite(points)) return;
                            patchLayer({
                              style: {
                                ...selectedLayer.style,
                                points: Math.round(
                                  Math.min(24, Math.max(3, points)),
                                ),
                              },
                            } as Partial<MotionLayer>);
                          }}
                        />
                      </Field>
                      {selectedLayer.shapeType === "star" ? (
                        <Field label={editorMessage("editor.motion.properties.innerRadius")}>
                          <NumberInput
                            value={selectedLayer.style.innerRadius ?? 0.45}
                            min={0.05}
                            max={0.95}
                            step={0.05}
                            onChange={(innerRadius) => {
                              if (!Number.isFinite(innerRadius)) return;
                              patchLayer({
                                style: {
                                  ...selectedLayer.style,
                                  innerRadius: Math.min(
                                    0.95,
                                    Math.max(0.05, innerRadius),
                                  ),
                                },
                              } as Partial<MotionLayer>);
                            }}
                          />
                        </Field>
                      ) : null}
                    </div>
                  ) : null}
                  <Field label={editorMessage("editor.motion.properties.fillMode")}>
                    <SegmentedControl
                      value={selectedLayer.style.fill.type}
                      options={[
                        { value: "solid", label: editorMessage("editor.motion.properties.solid") },
                        { value: "gradient", label: editorMessage("editor.motion.properties.grad") },
                        { value: "shader", label: editorMessage("editor.motion.shader.title") },
                        { value: "none", label: editorMessage("editor.motion.properties.none") },
                      ]}
                      onChange={(type) =>
                        patchLayer({
                          style: {
                            ...selectedLayer.style,
                            fill:
                              type === "gradient"
                                ? createDefaultMotionGradientFill(
                                    selectedLayer.style.fill.color ?? "#14b8a6",
                                    selectedLayer.style.stroke.color ?? "#ffffff",
                                  )
                                : type === "shader"
                                  ? createDefaultMotionShaderFill(
                                      firstMotionShaderFillId(),
                                    )
                                  : type === "solid"
                                    ? createSolidMotionFill(
                                        selectedLayer.style.fill.color ?? "#14b8a6",
                                      )
                                    : { type: "none", opacity: 0 },
                          },
                        } as Partial<MotionLayer>)
                      }
                    />
                  </Field>
                  {selectedLayer.style.fill.type === "solid" ? (
                    <div className="grid grid-cols-2 gap-2.5">
                      <Field label={editorMessage("editor.motion.properties.fillColor")}>
                        <ColorInput
                          value={selectedLayer.style.fill.color ?? "#14b8a6"}
                          onChange={(color) =>
                            patchLayer({
                              style: {
                                ...selectedLayer.style,
                                fill: {
                                  ...selectedLayer.style.fill,
                                  color,
                                },
                              },
                            } as Partial<MotionLayer>)
                          }
                        />
                      </Field>
                      <Field label={editorMessage("editor.motion.properties.fillOpacity")}>
                        <Slider
                          value={getLayerPropertyInspectorValue(
                            "shape.fill.opacity",
                          )}
                          onChange={(opacity) =>
                            setTransformProperty("shape.fill.opacity", opacity)
                          }
                        />
                      </Field>
                    </div>
                  ) : null}
                  {selectedLayer.style.fill.type === "gradient" ? (
                    <GradientFillControls
                      composition={composition}
                      layer={selectedLayer}
                      patchLayer={patchLayer}
                      setLayerProperty={setTransformProperty}
                      localTime={selectedLayerLocalTime}
                    />
                  ) : null}
                  {selectedLayer.style.fill.type === "shader" &&
                  selectedLayer.style.fill.shader ? (
                    <ShaderFillControls
                      shader={selectedLayer.style.fill.shader}
                      onChange={(nextShader) =>
                        patchLayer({
                          style: {
                            ...selectedLayer.style,
                            fill: {
                              ...selectedLayer.style.fill,
                              type: "shader",
                              opacity: selectedLayer.style.fill.opacity,
                              shader: nextShader,
                            },
                          },
                        } as Partial<MotionLayer>)
                      }
                    />
                  ) : null}
                  <div className="grid grid-cols-2 gap-2.5">
                    <Field label={editorMessage("editor.motion.properties.cornerRadius")}>
                      <NumberInput
                        value={getLayerPropertyInspectorValue(
                          "shape.cornerRadius",
                        )}
                        min={0}
                        unit="px"
                        onChange={(cornerRadius) =>
                          setTransformProperty(
                            "shape.cornerRadius",
                            cornerRadius,
                          )
                        }
                      />
                    </Field>
                    <Field label={editorMessage("editor.motion.properties.strokeWidth")}>
                      <NumberInput
                        value={getLayerPropertyInspectorValue(
                          "shape.stroke.width",
                        )}
                        min={0}
                        unit="px"
                        onChange={(width) =>
                          setTransformProperty("shape.stroke.width", width)
                        }
                      />
                    </Field>
                    <Field label={editorMessage("editor.motion.properties.strokeColor")}>
                      <ColorInput
                        value={selectedLayer.style.stroke.color}
                        onChange={(color) =>
                          patchLayer({
                            style: {
                              ...selectedLayer.style,
                              stroke: { ...selectedLayer.style.stroke, color },
                            },
                          } as Partial<MotionLayer>)
                        }
                      />
                    </Field>
                    <Field label={editorMessage("editor.motion.properties.strokeOpacity")}>
                      <Slider
                        value={getLayerPropertyInspectorValue(
                          "shape.stroke.opacity",
                        )}
                        onChange={(opacity) =>
                          setTransformProperty("shape.stroke.opacity", opacity)
                        }
                      />
                    </Field>
                    <Field label={editorMessage("editor.motion.properties.lineCap")}>
                      <SelectControl
                        label={editorMessage("editor.motion.properties.lineCap")}
                        value={selectedLayer.style.stroke.lineCap ?? "butt"}
                        options={[
                          { value: "butt", label: editorMessage("editor.motion.properties.butt") },
                          { value: "round", label: editorMessage("editor.motion.properties.round") },
                          { value: "square", label: editorMessage("editor.motion.properties.square") },
                        ]}
                        onChange={(lineCap) =>
                          patchLayer({
                            style: {
                              ...selectedLayer.style,
                              stroke: {
                                ...selectedLayer.style.stroke,
                                lineCap,
                              },
                            },
                          } as Partial<MotionLayer>)
                        }
                      />
                    </Field>
                    <Field label={editorMessage("editor.motion.properties.lineJoin")}>
                      <SelectControl
                        label={editorMessage("editor.motion.properties.lineJoin")}
                        value={selectedLayer.style.stroke.lineJoin ?? "miter"}
                        options={[
                          { value: "miter", label: editorMessage("editor.motion.properties.miter") },
                          { value: "round", label: editorMessage("editor.motion.properties.round") },
                          { value: "bevel", label: editorMessage("editor.motion.properties.bevel") },
                        ]}
                        onChange={(lineJoin) =>
                          patchLayer({
                            style: {
                              ...selectedLayer.style,
                              stroke: {
                                ...selectedLayer.style.stroke,
                                lineJoin,
                              },
                            },
                          } as Partial<MotionLayer>)
                        }
                      />
                    </Field>
                    <Field label={editorMessage("editor.motion.properties.dashPattern")}>
                      <TextInput
                        value={formatDashArray(selectedLayer.style.stroke.dashArray)}
                        placeholder="8 4"
                        onChange={(value) =>
                          patchLayer({
                            style: {
                              ...selectedLayer.style,
                              stroke: {
                                ...selectedLayer.style.stroke,
                                dashArray: parseDashArray(value),
                              },
                            },
                          } as Partial<MotionLayer>)
                        }
                      />
                    </Field>
                    <Field label={editorMessage("editor.motion.properties.dashOffset")}>
                      <NumberInput
                        value={getLayerPropertyInspectorValue(
                          "shape.stroke.dashOffset",
                        )}
                        unit="px"
                        onChange={(dashOffset) =>
                          setTransformProperty(
                            "shape.stroke.dashOffset",
                            dashOffset,
                          )
                        }
                      />
                    </Field>
                  </div>
                  <StrokeGradientControls
                    layer={selectedLayer}
                    patchLayer={patchLayer}
                  />
                </Section>
                <ShapeModifiersSection
                  composition={composition}
                  layer={selectedLayer}
                  localTime={selectedLayerLocalTime}
                  autoKeyframe={autoKeyframe}
                  selectedProperty={selectedProperty}
                  setSelectedProperty={setSelectedProperty}
                  replaceLayer={replaceLayer}
                />
                <ShapeContentsSection
                  composition={composition}
                  layer={selectedLayer}
                />
              </>
            ) : null}

            {selectedLayer.type === "image" ? (
              <ImageLayerSection
                composition={composition}
                layer={selectedLayer}
                replaceLayer={replaceLayer}
              />
            ) : null}

            {selectedLayer.type === "video" ? (
              <VideoLayerSection
                composition={composition}
                layer={selectedLayer}
                replaceLayer={replaceLayer}
              />
            ) : null}

            {selectedLayer.type === "particle" ? (
              <ParticleLayerSection
                layer={selectedLayer}
                replaceLayer={replaceLayer}
              />
            ) : null}

            {selectedLayer.type === "adjustment" ? (
              <AdjustmentLayerSection
                layer={selectedLayer}
                replaceLayer={replaceLayer}
              />
            ) : null}

            {selectedLayer.type === "null" ? (
              <NullLayerSection
                layer={selectedLayer}
                replaceLayer={replaceLayer}
              />
            ) : null}

            {selectedLayer.type === "composition" ? (
              <PrecompSection
                hostComposition={composition}
                layer={selectedLayer}
                motionCompositions={motionCompositions}
                replaceLayer={replaceLayer}
              />
            ) : null}
          </>
        ) : null}

        <Section
          title={editorMessage("editor.motion.properties.composition")}
          icon={Settings2}
          defaultOpen={!selectedLayer}
          keepOpenInAccordion={!selectedLayer}
        >
          <Field label={editorMessage("editor.motion.properties.sceneName")}>
            <TextInput
              value={composition.name}
              onChange={(name) => updateComposition({ name })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label={editorMessage("editor.motion.properties.duration")}>
              <NumberInput
                value={composition.duration}
                min={0.1}
                step={0.1}
                unit="s"
                onChange={(duration) => updateComposition({ duration })}
              />
            </Field>
            <Field label={editorMessage("editor.motion.properties.frameRate")}>
              <NumberInput
                value={composition.frameRate}
                min={1}
                unit="fps"
                onChange={(frameRate) => updateComposition({ frameRate })}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label={editorMessage("editor.motion.properties.width")}>
              <NumberInput
                value={composition.width}
                min={1}
                unit="px"
                onChange={(width) => updateComposition({ width })}
              />
            </Field>
            <Field label={editorMessage("editor.motion.properties.height")}>
              <NumberInput
                value={composition.height}
                min={1}
                unit="px"
                onChange={(height) => updateComposition({ height })}
              />
            </Field>
          </div>
          <Field label={editorMessage("editor.motion.properties.background")}>
            <ColorInput
              value={composition.backgroundColor}
              onChange={(backgroundColor) => updateComposition({ backgroundColor })}
            />
          </Field>
        </Section>

        <Section title={editorMessage("editor.motion.properties.camera")} icon={Camera} defaultOpen={camera.enabled}>
          <ToggleControl
            label={editorMessage("editor.motion.properties.activeCamera")}
            checked={camera.enabled}
            onChange={enableCamera}
            description={editorMessage("editor.motion.properties.cameraDescription")}
          />
          <div className="grid grid-cols-2 gap-2.5">
            <CameraPropertyControl
              label={editorMessage("editor.motion.properties.positionX")}
              property="camera.position.x"
              camera={baseCamera}
              localTime={cameraLocalTime}
              value={camera.position.x}
              unit="px"
              onChange={setCameraProperty}
              onToggleKeyframe={toggleCameraKeyframe}
            />
            <CameraPropertyControl
              label={editorMessage("editor.motion.properties.positionY")}
              property="camera.position.y"
              camera={baseCamera}
              localTime={cameraLocalTime}
              value={camera.position.y}
              unit="px"
              onChange={setCameraProperty}
              onToggleKeyframe={toggleCameraKeyframe}
            />
            <CameraPropertyControl
              label={editorMessage("editor.motion.properties.depth")}
              property="camera.position.z"
              camera={baseCamera}
              localTime={cameraLocalTime}
              value={camera.position.z ?? 0}
              unit="px"
              onChange={setCameraProperty}
              onToggleKeyframe={toggleCameraKeyframe}
            />
            <CameraPropertyControl
              label={editorMessage("editor.motion.properties.zoom")}
              property="camera.zoom"
              camera={baseCamera}
              localTime={cameraLocalTime}
              value={camera.zoom}
              min={0.01}
              step={0.05}
              onChange={setCameraProperty}
              onToggleKeyframe={toggleCameraKeyframe}
            />
            <CameraPropertyControl
              label={editorMessage("editor.motion.properties.roll")}
              property="camera.rotation"
              camera={baseCamera}
              localTime={cameraLocalTime}
              value={camera.rotation}
              unit="°"
              onChange={setCameraProperty}
              onToggleKeyframe={toggleCameraKeyframe}
            />
            <CameraPropertyControl
              label={editorMessage("editor.motion.properties.perspective")}
              property="camera.perspective"
              camera={baseCamera}
              localTime={cameraLocalTime}
              value={camera.perspective}
              min={1}
              step={25}
              unit="px"
              onChange={setCameraProperty}
              onToggleKeyframe={toggleCameraKeyframe}
            />
          </div>
          <ToggleControl
            label={editorMessage("editor.motion.properties.depthOfField")}
            checked={camera.depthOfField?.enabled ?? false}
            onChange={setCameraDepthOfFieldEnabled}
            description={editorMessage("editor.motion.properties.dofDescription")}
          />
          <div className="grid grid-cols-2 gap-2.5">
            <CameraPropertyControl
              label={editorMessage("editor.motion.properties.focus")}
              property="camera.focusDistance"
              camera={baseCamera}
              localTime={cameraLocalTime}
              value={camera.depthOfField?.focusDistance ?? 0}
              unit="px"
              step={10}
              onChange={setCameraProperty}
              onToggleKeyframe={toggleCameraKeyframe}
            />
            <CameraPropertyControl
              label={editorMessage("editor.motion.properties.aperture")}
              property="camera.aperture"
              camera={baseCamera}
              localTime={cameraLocalTime}
              value={camera.depthOfField?.aperture ?? 1}
              min={0}
              step={0.1}
              onChange={setCameraProperty}
              onToggleKeyframe={toggleCameraKeyframe}
            />
            <CameraPropertyControl
              label={editorMessage("editor.motion.properties.maxBlur")}
              property="camera.maxBlur"
              camera={baseCamera}
              localTime={cameraLocalTime}
              value={camera.depthOfField?.maxBlur ?? 24}
              min={0}
              step={1}
              unit="px"
              onChange={setCameraProperty}
              onToggleKeyframe={toggleCameraKeyframe}
            />
          </div>
          <Button
            label={editorMessage("editor.motion.properties.resetCamera")}
            size="sm"
            variant="secondary"
            icon={<Camera size={13} aria-hidden />}
            onClick={() =>
              updateComposition({
                camera: createDefaultMotionCamera(composition),
              })
            }
          />
        </Section>

        <LightsSection
          composition={composition}
          lights={lights}
          selectedLightId={selectedLight?.id ?? null}
          localTime={cameraLocalTime}
          addLight={addLight}
          updateLight={updateLight}
          removeLight={removeLight}
          toggleLight={toggleLight}
          selectLight={selectLight}
          setLightProperty={setLightProperty}
          toggleLightKeyframe={toggleLightKeyframe}
        />

        <Section title={editorMessage("editor.motion.properties.guides")} icon={Ruler} defaultOpen={guides.length > 0}>
          <div className="grid grid-cols-2 gap-2.5">
            <Button
              label={editorMessage("editor.motion.properties.verticalGuide")}
              size="sm"
              variant="secondary"
              icon={<Plus size={13} aria-hidden />}
              onClick={() => addGuide("vertical")}
            />
            <Button
              label={editorMessage("editor.motion.properties.horizontalGuide")}
              size="sm"
              variant="secondary"
              icon={<Plus size={13} aria-hidden />}
              onClick={() => addGuide("horizontal")}
            />
          </div>
          {guides.length > 0 ? (
            <div className="space-y-2">
              {guides.map((guide) => (
                <div
                  key={guide.id}
                  className="space-y-2 rounded-md border border-border bg-bg-2 p-2"
                >
                  <div className="grid grid-cols-[minmax(0,1fr)_96px_28px] gap-2">
                    <SelectControl
                      label={editorMessage("editor.motion.properties.guideOrientation")}
                      value={guide.orientation}
                      options={[
                        { value: "vertical", label: editorMessage("editor.motion.properties.verticalGuide") },
                        { value: "horizontal", label: editorMessage("editor.motion.properties.horizontalGuide") },
                      ]}
                      onChange={(orientation) =>
                        replaceComposition(
                          updateMotionCompositionGuide(
                            composition,
                            guide.id,
                            (current) => ({
                              ...current,
                              orientation: orientation as MotionGuideOrientation,
                            }),
                          ),
                        )
                      }
                    />
                    <NumberInput
                      value={guide.position}
                      min={0}
                      max={
                        guide.orientation === "vertical"
                          ? composition.width
                          : composition.height
                      }
                      unit="px"
                      onChange={(position) =>
                        replaceComposition(
                          updateMotionCompositionGuide(
                            composition,
                            guide.id,
                            (current) => ({ ...current, position }),
                          ),
                        )
                      }
                    />
                    <IconButton
                      icon={Trash2}
                      label={editorMessage("editor.motion.properties.removeGuide")}
                      size="sm"
                      variant="danger"
                      onClick={() =>
                        replaceComposition(
                          removeMotionCompositionGuide(composition, guide.id),
                        )
                      }
                    />
                  </div>
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
                    <Field label={editorMessage("editor.motion.properties.color")}>
                      <ColorInput
                        value={guide.color ?? "#14b8a6"}
                        onChange={(color) =>
                          replaceComposition(
                            updateMotionCompositionGuide(
                              composition,
                              guide.id,
                              (current) => ({ ...current, color }),
                            ),
                          )
                        }
                      />
                    </Field>
                    <ToggleControl
                      label={editorMessage("editor.motion.properties.lock")}
                      checked={guide.locked ?? false}
                      onChange={(locked) =>
                        replaceComposition(
                          updateMotionCompositionGuide(
                            composition,
                            guide.id,
                            (current) => ({
                              ...current,
                              locked,
                            }),
                          ),
                        )
                      }
                    />
                  </div>
                </div>
              ))}
              <Button
                label={editorMessage("editor.motion.properties.clearGuides")}
                size="sm"
                variant="destructive"
                icon={<Trash2 size={13} aria-hidden />}
                onClick={() =>
                  replaceComposition(clearMotionCompositionGuides(composition))
                }
              />
            </div>
          ) : (
            <ToolcraftText type="supporting" color="secondary" className="block rounded-lg border border-dashed border-border px-3 py-3 text-[12px] leading-relaxed text-fg-muted">
              {editorMessage("editor.motion.properties.noGuides")}
            </ToolcraftText>
          )}
        </Section>

        <Section
          title={editorMessage("editor.motion.properties.motionBlur")}
          icon={Zap}
          defaultOpen={motionBlurSettings.enabled}
        >
          <ToggleControl
            label={editorMessage("editor.motion.properties.shutterBlur")}
            checked={motionBlurSettings.enabled}
            onChange={(enabled) => patchMotionBlurSettings({ enabled })}
          />
          <div className="grid grid-cols-2 gap-2.5">
            <Field label={editorMessage("editor.motion.properties.shutterAngle")} hint="deg">
              <NumberInput
                value={motionBlurSettings.shutterAngle}
                min={0}
                max={720}
                onChange={(shutterAngle) =>
                  patchMotionBlurSettings({ shutterAngle })
                }
              />
            </Field>
            <Field label={editorMessage("editor.motion.properties.phase")} hint="deg">
              <NumberInput
                value={motionBlurSettings.shutterPhase}
                min={-360}
                max={360}
                onChange={(shutterPhase) =>
                  patchMotionBlurSettings({ shutterPhase })
                }
              />
            </Field>
          </div>
          <Field label={editorMessage("editor.motion.properties.samples")}>
            <NumberInput
              value={motionBlurSettings.samples}
              min={2}
              max={32}
              onChange={(samples) => patchMotionBlurSettings({ samples })}
            />
          </Field>
        </Section>

        {!selectedLayer ? (
          <ToolcraftText type="supporting" color="secondary" className="block px-3.5 pb-5 pt-1 text-[12px] leading-relaxed text-fg-muted">
            {editorMessage("editor.motion.properties.layerHelp")}
          </ToolcraftText>
        ) : null}
      </div>
    </div>
  );
}

function buildDefaultPathData(width: number, height: number): string {
  const halfWidth = Math.max(1, width) / 2;
  const halfHeight = Math.max(1, height) / 2;
  return [
    `M ${-halfWidth} ${-halfHeight}`,
    `L ${halfWidth} ${-halfHeight}`,
    `L ${halfWidth} ${halfHeight}`,
    `L ${-halfWidth} ${halfHeight}`,
  ].join(" ");
}

function firstMotionShaderFillId(): string {
  return getMotionShaderFillDefs()[0]?.id ?? "liquid-metal";
}

function shaderFillFromDefault(fill: { shader?: MotionShaderFill }): MotionShaderFill {
  return fill.shader ?? { shaderId: firstMotionShaderFillId(), params: {} };
}

function shaderOptionLabel(def: MotionShaderDef): string {
  return def.origin === "generated"
    ? editorMessage("editor.motion.shader.generatedName", { name: def.name }) : motionShaderName(def);
}

function shaderCollectionLabel(def: MotionShaderDef): string {
  return def.collection ?? editorMessage("editor.motion.shader.builtin");
}

function groupShaderDefsByCollection(
  defs: readonly MotionShaderDef[],
  leading: Array<{ value: string; label: string }> = [],
): Array<{ label: string; options: Array<{ value: string; label: string }> }> {
  const order: string[] = [];
  const buckets = new Map<string, Array<{ value: string; label: string }>>();
  for (const def of defs) {
    const collection = shaderCollectionLabel(def);
    const bucket = buckets.get(collection);
    const option = { value: def.id, label: shaderOptionLabel(def) };
    if (bucket) {
      bucket.push(option);
    } else {
      order.push(collection);
      buckets.set(collection, [option]);
    }
  }
  const groups = order.map((collection) => ({
    label: collection,
    options: buckets.get(collection) ?? [],
  }));
  if (leading.length > 0) {
    return [{ label: editorMessage("editor.motion.shader.general"), options: leading }, ...groups];
  }
  return groups;
}

function shaderParamUsesSlider(paramDef: MotionShaderParamDef): boolean {
  if (paramDef.control) {
    return paramDef.control === "slider";
  }
  return paramDef.min === 0 && paramDef.max === 1;
}

function ShaderFillControls({
  shader,
  onChange,
  previewSample = "shape",
}: {
  shader: MotionShaderFill;
  onChange: (shader: MotionShaderFill) => void;
  previewSample?: "text" | "shape";
}): JSX.Element {
  const fillDefs = getMotionShaderFillDefs();
  const def = getMotionShaderDef(shader.shaderId);

  const selectShader = (shaderId: string) => {
    if (shaderId === shader.shaderId) return;
    onChange(shaderFillFromDefault(createDefaultMotionShaderFill(shaderId)));
  };

  const setParam = (name: string, value: number) => {
    if (!Number.isFinite(value)) return;
    onChange({
      ...shader,
      params: { ...shader.params, [name]: value },
    });
  };

  const setColorParam = (name: string, value: string) => {
    onChange({
      ...shader,
      params: { ...shader.params, [name]: value },
    });
  };

  return (
    <div className="space-y-2.5 rounded-lg border border-border bg-bg-2 p-3">
      <Field label={editorMessage("editor.motion.shader.title")}>
        <SelectControl
          label={editorMessage("editor.motion.shader.fill")}
          value={shader.shaderId}
          options={[]}
          groups={groupShaderDefsByCollection(fillDefs)}
          onChange={selectShader}
        />
      </Field>
      <ShaderPreviewBrowser
        defs={fillDefs}
        selectedId={shader.shaderId}
        onSelect={selectShader}
        sample={previewSample}
        label={editorMessage("editor.motion.shader.preview.fill")}
      />
      {def
        ? def.params.map((paramDef) => (
            <Field key={paramDef.name} label={motionShaderParameterLabel(def, paramDef)} preserveLabel>
              <ShaderParamControl
                paramDef={paramDef}
                value={shader.params[paramDef.name]}
                onNumberChange={(next) => setParam(paramDef.name, next)}
                onColorChange={(next) => setColorParam(paramDef.name, next)}
              />
            </Field>
          ))
        : null}
      <GenerateShaderBox category="fill" onGenerated={(next) => selectShader(next.id)} />
    </div>
  );
}

function shaderParamNumericValue(
  value: number | string | undefined,
  fallback: number | string,
): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof fallback === "number" && Number.isFinite(fallback)) return fallback;
  return 0;
}

function shaderParamColorValue(
  value: number | string | undefined,
  fallback: number | string,
): string {
  if (typeof value === "string") return value;
  if (typeof fallback === "string") return fallback;
  return "#ffffff";
}

function ShaderParamControl({
  paramDef,
  value,
  onNumberChange,
  onColorChange,
}: {
  paramDef: MotionShaderParamDef;
  value: number | string | undefined;
  onNumberChange: (value: number) => void;
  onColorChange: (value: string) => void;
}): JSX.Element {
  if (paramDef.type === "color") {
    return (
      <ColorInput
        value={shaderParamColorValue(value, paramDef.default)}
        onChange={onColorChange}
      />
    );
  }
  const numericValue = shaderParamNumericValue(value, paramDef.default);
  return shaderParamUsesSlider(paramDef) ? (
    <Slider
      value={numericValue}
      min={paramDef.min}
      max={paramDef.max}
      step={paramDef.step}
      onChange={onNumberChange}
    />
  ) : (
    <NumberInput
      value={numericValue}
      min={paramDef.min}
      max={paramDef.max}
      step={paramDef.step}
      onChange={onNumberChange}
    />
  );
}

function firstEnabledMotionTextAnimatorId(
  layer: Extract<MotionLayer, { type: "text" }>,
): string | undefined {
  return (layer.textAnimators ?? []).find((animator) => animator.enabled)?.id;
}

function textShaderRefFromDefault(shaderId: string): MotionTextShaderRef {
  const def = getMotionShaderDef(shaderId);
  const params: Record<string, number | string> = {};
  if (def) {
    for (const paramDef of def.params) {
      params[paramDef.name] = paramDef.default;
    }
  }
  return { shaderId, params };
}

function TextShaderAnimatorControls({
  layer,
  replaceLayer,
}: {
  layer: Extract<MotionLayer, { type: "text" }>;
  replaceLayer: (nextLayer: MotionLayer) => void;
}): JSX.Element {
  const textDefs = getMotionShaderTextDefs();
  const shaderAnimator = getMotionTextShaderAnimator(layer);
  const shader = shaderAnimator?.shader;
  const def = shader ? getMotionShaderDef(shader.shaderId) : undefined;

  const selectShader = (shaderId: string) => {
    if (shaderId === (shader?.shaderId ?? "")) return;

    if (!shaderId) {
      if (!shaderAnimator) return;
      replaceLayer(
        updateMotionTextAnimator(layer, shaderAnimator.id, (current) => {
          const { shader: _removed, ...rest } = current;
          return rest;
        }),
      );
      return;
    }

    const nextShader = textShaderRefFromDefault(shaderId);
    if (shaderAnimator) {
      replaceLayer(
        updateMotionTextAnimator(layer, shaderAnimator.id, (current) => ({
          ...current,
          shader: nextShader,
        })),
      );
      return;
    }

    const targetId = firstEnabledMotionTextAnimatorId(layer);
    if (targetId) {
      replaceLayer(
        updateMotionTextAnimator(layer, targetId, (current) => ({
          ...current,
          shader: nextShader,
        })),
      );
      return;
    }

    replaceLayer(
      addMotionTextAnimator(layer, {
        ...createMotionTextAnimator("text-reveal-up"),
        shader: nextShader,
      }),
    );
  };

  const updateShaderParam = (name: string, value: number | string) => {
    if (!shaderAnimator || !shader) return;
    replaceLayer(
      updateMotionTextAnimator(layer, shaderAnimator.id, (current) => ({
        ...current,
        shader: {
          shaderId: shader.shaderId,
          params: { ...shader.params, [name]: value },
        },
      })),
    );
  };

  const setParam = (name: string, value: number) => {
    if (!Number.isFinite(value)) return;
    const paramDef = def?.params.find((entry) => entry.name === name);
    const clamped = paramDef
      ? Math.min(paramDef.max, Math.max(paramDef.min, value))
      : value;
    updateShaderParam(name, clamped);
  };

  const setColorParam = (name: string, value: string) => {
    updateShaderParam(name, value);
  };

  return (
    <div className="space-y-2.5 rounded-lg border border-border bg-bg-2 p-3">
      <Field label={editorMessage("editor.motion.shader.animator")}>
        <SelectControl
          label={editorMessage("editor.motion.shader.textAnimator")}
          value={shader?.shaderId ?? ""}
          options={[]}
          groups={groupShaderDefsByCollection(textDefs, [{ value: "", label: editorMessage("editor.motion.shader.none") }])}
          onChange={selectShader}
        />
      </Field>
      {def && shader
        ? def.params.map((paramDef) => {
            const shaderRef = shader;
            return (
              <Field key={paramDef.name} label={motionShaderParameterLabel(def, paramDef)} preserveLabel>
                <ShaderParamControl
                  paramDef={paramDef}
                  value={shaderRef.params[paramDef.name]}
                  onNumberChange={(next) => setParam(paramDef.name, next)}
                  onColorChange={(next) => setColorParam(paramDef.name, next)}
                />
              </Field>
            );
          })
        : null}
      <GenerateShaderBox category="text" onGenerated={(next) => selectShader(next.id)} />
    </div>
  );
}

function GradientFillControls({
  composition,
  layer,
  patchLayer,
  setLayerProperty,
  localTime,
}: {
  composition: MotionComposition;
  layer: Extract<MotionLayer, { type: "shape" }>;
  patchLayer: (updates: Partial<MotionLayer>) => void;
  setLayerProperty: (property: MotionAnimatableProperty, value: number) => void;
  localTime: number;
}): JSX.Element {
  const fallbackFill = createDefaultMotionGradientFill(
    layer.style.fill.color ?? "#14b8a6",
    layer.style.stroke.color ?? "#ffffff",
  );
  const gradient = layer.style.fill.gradient ?? fallbackFill.gradient!;
  const stops =
    gradient.stops.length >= 2
      ? gradient.stops
      : fallbackFill.gradient!.stops;
  const gradientAngle = getMotionLayerPropertyValueAtTime(
    layer,
    "shape.gradient.angle",
    localTime,
    composition,
  );
  const fillOpacity = getMotionLayerPropertyValueAtTime(
    layer,
    "shape.fill.opacity",
    localTime,
    composition,
  );

  const updateGradient = (
    updates: Partial<NonNullable<typeof layer.style.fill.gradient>>,
  ) => {
    patchLayer({
      style: {
        ...layer.style,
        fill: {
          ...layer.style.fill,
          type: "gradient",
          opacity: layer.style.fill.opacity,
          gradient: {
            ...gradient,
            ...updates,
          },
        },
      },
    } as Partial<MotionLayer>);
  };

  return (
    <div className="space-y-2.5 rounded-lg border border-border bg-bg-2 p-3">
      <Field label={editorMessage("editor.motion.properties.gradientType")}>
        <SegmentedControl
          value={gradient.type}
          options={[
            { value: "linear", label: editorMessage("editor.motion.properties.linear") },
            { value: "radial", label: editorMessage("editor.motion.properties.radial") },
          ]}
          onChange={(type) => updateGradient({ type })}
        />
      </Field>
      {gradient.type === "linear" ? (
        <Field label={editorMessage("editor.motion.properties.angle")}>
          <NumberInput
            value={gradientAngle}
            unit="°"
            onChange={(angle) =>
              setLayerProperty("shape.gradient.angle", angle)
            }
          />
        </Field>
      ) : null}
      <GradientStopEditor
        stops={stops}
        onChange={(nextStops) => updateGradient({ stops: nextStops })}
      />
      <Field label={editorMessage("editor.motion.properties.fillOpacity")}>
        <Slider
          value={fillOpacity}
          onChange={(opacity) =>
            setLayerProperty("shape.fill.opacity", opacity)
          }
        />
      </Field>
    </div>
  );
}

function interpolateHexColor(from: string, to: string, ratio: number): string {
  const start = parseHexColor(from);
  const end = parseHexColor(to);
  if (!start || !end) return from;
  const mix = (a: number, b: number): number =>
    Math.round(a + (b - a) * clampUnit(ratio));
  return rgbToHex(
    mix(start.r, end.r),
    mix(start.g, end.g),
    mix(start.b, end.b),
  );
}

function parseHexColor(
  value: string,
): { r: number; g: number; b: number } | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const hex = match[1];
  const expanded =
    hex.length === 3
      ? hex
          .split("")
          .map((char) => char + char)
          .join("")
      : hex;
  return {
    r: parseInt(expanded.slice(0, 2), 16),
    g: parseInt(expanded.slice(2, 4), 16),
    b: parseInt(expanded.slice(4, 6), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (channel: number): string =>
    Math.max(0, Math.min(255, channel)).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function GradientStopEditor({
  stops,
  onChange,
}: {
  stops: readonly GradientStop[];
  onChange: (stops: GradientStop[]) => void;
}): JSX.Element {
  const sorted = normalizeMotionGradientStops(stops);

  const commit = (nextStops: GradientStop[]): void => {
    onChange(normalizeMotionGradientStops(nextStops));
  };

  const updateStop = (index: number, updates: Partial<GradientStop>): void => {
    commit(
      sorted.map((stop, stopIndex) =>
        stopIndex === index ? { ...stop, ...updates } : stop,
      ),
    );
  };

  const removeStop = (index: number): void => {
    if (sorted.length <= 2) return;
    commit(sorted.filter((_, stopIndex) => stopIndex !== index));
  };

  const addStop = (): void => {
    const last = sorted[sorted.length - 1];
    const prev = sorted[sorted.length - 2];
    const offset = clampUnit((prev.offset + last.offset) / 2);
    const color = interpolateHexColor(prev.color, last.color, 0.5);
    commit([...sorted, { offset, color }]);
  };

  const canRemove = sorted.length > 2;

  return (
    <div className="space-y-2">
      <div className="space-y-1.5">
        {sorted.map((stop, index) => (
          <div
            key={index}
            data-testid="gradient-stop"
            className="grid grid-cols-[1fr_auto_auto] items-center gap-1.5"
          >
            <ColorInput
              value={stop.color}
              onChange={(color) => updateStop(index, { color })}
            />
            <div className="w-20">
              <NumberInput
                value={stop.offset}
                min={0}
                max={1}
                step={0.01}
                onChange={(offset) => updateStop(index, { offset })}
              />
            </div>
            {canRemove ? (
              <IconButton
                icon={Trash2}
                label={editorMessage("editor.motion.properties.removeStop", { index: index + 1 })}
                size="sm"
                iconSize={13}
                onClick={() => removeStop(index)}
              />
            ) : (
              <span className="w-7" aria-hidden />
            )}
          </div>
        ))}
      </div>
      <Button
        label={editorMessage("editor.motion.properties.addStop")}
        variant="ghost"
        size="sm"
        icon={<Plus size={13} aria-hidden />}
        onClick={addStop}
      />
    </div>
  );
}

function createDefaultStrokeGradient(color: string): GradientStyle {
  return {
    type: "linear",
    angle: 0,
    stops: [
      { offset: 0, color: color || "#ffffff" },
      { offset: 1, color: "#14b8a6" },
    ],
  };
}

function StrokeGradientControls({
  layer,
  patchLayer,
}: {
  layer: Extract<MotionLayer, { type: "shape" }>;
  patchLayer: (updates: Partial<MotionLayer>) => void;
}): JSX.Element {
  const stroke = layer.style.stroke;
  const mode: "solid" | "gradient" = stroke.gradient ? "gradient" : "solid";

  const setMode = (nextMode: "solid" | "gradient"): void => {
    if (nextMode === mode) return;
    if (nextMode === "gradient") {
      patchLayer({
        style: {
          ...layer.style,
          stroke: {
            ...stroke,
            gradient: createDefaultStrokeGradient(stroke.color),
          },
        },
      } as Partial<MotionLayer>);
      return;
    }
    const { gradient: _removed, ...rest } = stroke;
    patchLayer({
      style: { ...layer.style, stroke: rest },
    } as Partial<MotionLayer>);
  };

  const setStops = (nextStops: GradientStop[]): void => {
    const base = stroke.gradient ?? createDefaultStrokeGradient(stroke.color);
    patchLayer({
      style: {
        ...layer.style,
        stroke: { ...stroke, gradient: { ...base, stops: nextStops } },
      },
    } as Partial<MotionLayer>);
  };

  const setGradientType = (type: GradientStyle["type"]): void => {
    const base = stroke.gradient ?? createDefaultStrokeGradient(stroke.color);
    patchLayer({
      style: {
        ...layer.style,
        stroke: { ...stroke, gradient: { ...base, type } },
      },
    } as Partial<MotionLayer>);
  };

  return (
    <div className="mt-2.5 space-y-2.5">
      <Field label={editorMessage("editor.motion.properties.strokeFill")}>
        <SegmentedControl
          value={mode}
          options={[
            { value: "solid", label: editorMessage("editor.motion.properties.solidStroke") },
            { value: "gradient", label: editorMessage("editor.motion.properties.gradientStroke") },
          ]}
          onChange={setMode}
        />
      </Field>
      {stroke.gradient ? (
        <div className="space-y-2.5 rounded-lg border border-border bg-bg-2 p-3">
          <Field label={editorMessage("editor.motion.properties.gradientType")}>
            <SegmentedControl
              value={stroke.gradient.type === "radial" ? "radial" : "linear"}
              options={[
                { value: "linear", label: editorMessage("editor.motion.properties.linear") },
                { value: "radial", label: editorMessage("editor.motion.properties.radial") },
              ]}
              onChange={setGradientType}
            />
          </Field>
          <GradientStopEditor
            stops={stroke.gradient.stops}
            onChange={setStops}
          />
        </div>
      ) : null}
    </div>
  );
}

function parseDashArray(value: string): number[] {
  return value
    .split(/[\s,]+/)
    .map((part) => Number(part.trim()))
    .filter((dash) => Number.isFinite(dash) && dash > 0);
}

function formatDashArray(value: readonly number[] | undefined): string {
  return value?.join(" ") ?? "";
}

function getLayerAnimationProperties(
  layer: MotionLayer,
): MotionAnimatablePropertyDescriptor[] {
  return [
    ...MOTION_ANIMATABLE_PROPERTIES.filter(
      (property) =>
        property.group === "Transform" ||
        (property.group === "Shape" && layer.type === "shape") ||
        (property.group === "Precomp" && layer.type === "composition") ||
        (property.group === "Particles" && layer.type === "particle"),
    ),
    ...getMotionLayerEffectPropertyDescriptors(layer),
    ...getMotionLayerMaskPropertyDescriptors(layer),
    ...getMotionLayerPuppetPropertyDescriptors(layer),
    ...getMotionLayerShapeModifierPropertyDescriptors(layer),
    ...getMotionLayerContentsPropertyDescriptors(layer),
  ];
}

function CameraPropertyControl({
  label,
  property,
  camera,
  localTime,
  value,
  min,
  step,
  unit,
  onChange,
  onToggleKeyframe,
}: {
  label: string;
  property: MotionCameraProperty;
  camera: MotionCamera;
  localTime: number;
  value: number;
  min?: number;
  step?: number;
  unit?: string;
  onChange: (property: MotionCameraProperty, value: number) => void;
  onToggleKeyframe: (property: MotionCameraProperty) => void;
}): JSX.Element {
  const activeKeyframe = Boolean(
    findMotionCameraKeyframeAtTime(camera, property, localTime),
  );
  const keyframeCount = getMotionCameraPropertyKeyframes(camera, property).length;

  return (
    <Field label={label} hint={keyframeCount > 0 ? editorMessage("editor.motion.properties.keysCount", { count: keyframeCount }) : unit}>
      <div className="grid grid-cols-[minmax(0,1fr)_32px] gap-1.5">
        <NumberInput
          value={value}
          min={min}
          step={step}
          unit={unit}
          onChange={(nextValue) => onChange(property, nextValue)}
        />
        <IconButton
          icon={Diamond}
          label={activeKeyframe ? editorMessage("editor.motion.properties.removeCameraKeyframe") : editorMessage("editor.motion.properties.addCameraKeyframe")}
          active={activeKeyframe}
          variant={activeKeyframe ? "solid" : "outline"}
          iconSize={13}
          onClick={() => onToggleKeyframe(property)}
        />
      </div>
    </Field>
  );
}

function LightsSection({
  composition,
  lights,
  selectedLightId,
  localTime,
  addLight,
  updateLight,
  removeLight,
  toggleLight,
  selectLight,
  setLightProperty,
  toggleLightKeyframe,
}: {
  composition: MotionComposition;
  lights: readonly MotionLight[];
  selectedLightId: string | null;
  localTime: number;
  addLight: (type: MotionLightType) => void;
  updateLight: (
    lightId: string,
    updater: (light: MotionLight) => MotionLight,
  ) => void;
  removeLight: (lightId: string) => void;
  toggleLight: (lightId: string, enabled: boolean) => void;
  selectLight: (lightId: string | null, property?: string | null) => void;
  setLightProperty: (
    light: MotionLight,
    property: MotionLightProperty,
    value: number,
  ) => void;
  toggleLightKeyframe: (
    light: MotionLight,
    property: MotionLightProperty,
  ) => void;
}): JSX.Element {
  return (
    <Section title={editorMessage("editor.motion.properties.lights")} icon={Lightbulb} defaultOpen={lights.length > 0}>
      <div className="grid grid-cols-3 gap-1.5">
        {LIGHT_TYPE_OPTIONS.map((type) => (
          <Button
            key={type}
            label={editorMessage(LIGHT_TYPE_LABELS[type])}
            size="sm"
            variant="secondary"
            icon={<Plus size={12} aria-hidden />}
            onClick={() => addLight(type)}
          />
        ))}
      </div>

      {lights.length > 0 ? (
        <div className="space-y-2.5">
          {lights.map((light) => {
            const selected = light.id === selectedLightId;
            const animatedLight = getMotionLightAtTime(
              light,
              composition,
              localTime,
            );
            const patchLight = (updates: Partial<MotionLight>) =>
              updateLight(light.id, (current) => ({ ...current, ...updates }));
            return (
              <div
                key={light.id}
                onClick={() => selectLight(light.id, "light.intensity")}
                className={`space-y-2.5 rounded-lg border p-2.5 transition-colors ${
                  selected
                    ? "border-accent bg-accent-soft"
                    : "border-border bg-bg-2"
                }`}
              >
                <div className="grid grid-cols-[minmax(0,1fr)_28px_28px] gap-1.5">
                  <TextInput
                    value={light.name}
                    onChange={(name) => patchLight({ name })}
                  />
                  <IconButton
                    icon={light.enabled ? Eye : EyeOff}
                    label={light.enabled ? editorMessage("editor.motion.properties.disableLight") : editorMessage("editor.motion.properties.enableLight")}
                    active={light.enabled}
                    size="sm"
                    onClick={() => toggleLight(light.id, !light.enabled)}
                  />
                  <IconButton
                    icon={Trash2}
                    label={editorMessage("editor.motion.properties.removeLight")}
                    size="sm"
                    variant="danger"
                    onClick={() => removeLight(light.id)}
                  />
                </div>

                <div className="grid grid-cols-[108px_minmax(0,1fr)] gap-2">
                  <Field label={editorMessage("editor.motion.properties.type")}>
                    <SelectControl
                      label={editorMessage("editor.motion.properties.lightType")}
                      value={light.type}
                      options={LIGHT_TYPE_OPTIONS.map((type) => ({
                        value: type,
                        label: editorMessage(LIGHT_TYPE_LABELS[type]),
                      }))}
                      onChange={(type) =>
                        updateLight(light.id, (current) =>
                          retargetMotionLightType(
                            current,
                            type as MotionLightType,
                            composition,
                          ),
                        )
                      }
                    />
                  </Field>
                  <Field label={editorMessage("editor.motion.properties.color")}>
                    <ColorInput
                      value={light.color}
                      onChange={(color) => patchLight({ color })}
                    />
                  </Field>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <LightPropertyControl
                    light={light}
                    localTime={localTime}
                    property="light.intensity"
                    value={animatedLight.intensity}
                    onChange={setLightProperty}
                    onToggleKeyframe={toggleLightKeyframe}
                  />
                  {light.type === "directional" ? (
                    <LightPropertyControl
                      light={light}
                      localTime={localTime}
                      property="light.angle"
                      value={animatedLight.angle}
                      onChange={setLightProperty}
                      onToggleKeyframe={toggleLightKeyframe}
                    />
                  ) : (
                    <LightPropertyControl
                      light={light}
                      localTime={localTime}
                      property="light.position.z"
                      value={animatedLight.position.z ?? 0}
                      onChange={setLightProperty}
                      onToggleKeyframe={toggleLightKeyframe}
                    />
                  )}
                </div>

                {light.type === "point" ? (
                  <>
                    <div className="grid grid-cols-2 gap-2.5">
                      <LightPropertyControl
                        light={light}
                        localTime={localTime}
                        property="light.position.x"
                        value={animatedLight.position.x}
                        onChange={setLightProperty}
                        onToggleKeyframe={toggleLightKeyframe}
                      />
                      <LightPropertyControl
                        light={light}
                        localTime={localTime}
                        property="light.position.y"
                        value={animatedLight.position.y}
                        onChange={setLightProperty}
                        onToggleKeyframe={toggleLightKeyframe}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2.5">
                      <LightPropertyControl
                        light={light}
                        localTime={localTime}
                        property="light.radius"
                        value={animatedLight.radius}
                        onChange={setLightProperty}
                        onToggleKeyframe={toggleLightKeyframe}
                      />
                      <LightPropertyControl
                        light={light}
                        localTime={localTime}
                        property="light.falloff"
                        value={animatedLight.falloff}
                        onChange={setLightProperty}
                        onToggleKeyframe={toggleLightKeyframe}
                      />
                    </div>
                  </>
                ) : null}

                {light.type !== "ambient" ? (
                  <div className="space-y-2">
                    <ToggleControl
                      label={editorMessage("editor.motion.properties.castShadow")}
                      checked={light.castsShadow}
                      onChange={(castsShadow) => patchLight({ castsShadow })}
                    />
                    <div className="grid grid-cols-2 gap-2.5">
                      <LightPropertyControl
                        light={light}
                        localTime={localTime}
                        property="light.shadowOpacity"
                        value={animatedLight.shadowOpacity}
                        onChange={setLightProperty}
                        onToggleKeyframe={toggleLightKeyframe}
                      />
                      <LightPropertyControl
                        light={light}
                        localTime={localTime}
                        property="light.shadowSoftness"
                        value={animatedLight.shadowSoftness}
                        onChange={setLightProperty}
                        onToggleKeyframe={toggleLightKeyframe}
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <ToolcraftText type="supporting" color="secondary" className="block rounded-lg border border-dashed border-border px-3 py-3 text-[12px] leading-relaxed text-fg-muted">
          {editorMessage("editor.motion.properties.noLights")}
        </ToolcraftText>
      )}
    </Section>
  );
}

function retargetMotionLightType(
  light: MotionLight,
  type: MotionLightType,
  composition: Pick<MotionComposition, "width" | "height">,
): MotionLight {
  return createMotionLight(type, composition, {
    id: light.id,
    name: light.name,
    enabled: light.enabled,
    color: light.color,
    intensity: light.intensity,
    position: light.position,
    radius: light.radius,
    falloff: light.falloff,
    angle: light.angle,
    castsShadow: type === "ambient" ? false : light.castsShadow,
    shadowOpacity: type === "ambient" ? 0 : light.shadowOpacity,
    shadowSoftness: light.shadowSoftness,
    ...(light.keyframes ? { keyframes: light.keyframes } : {}),
  });
}

const LIGHT_PROPERTY_LABEL_KEYS: Record<MotionLightProperty, Parameters<typeof editorMessage>[0]> = {
  "light.intensity": "editor.motion.timeline.light.intensity",
  "light.position.x": "editor.motion.timeline.light.position.x",
  "light.position.y": "editor.motion.timeline.light.position.y",
  "light.position.z": "editor.motion.timeline.light.position.z",
  "light.radius": "editor.motion.timeline.light.radius",
  "light.falloff": "editor.motion.timeline.light.falloff",
  "light.angle": "editor.motion.timeline.light.angle",
  "light.shadowOpacity": "editor.motion.timeline.light.shadowOpacity",
  "light.shadowSoftness": "editor.motion.timeline.light.shadowSoftness",
};

function LightPropertyControl({
  light,
  localTime,
  property,
  value,
  onChange,
  onToggleKeyframe,
}: {
  light: MotionLight;
  localTime: number;
  property: MotionLightProperty;
  value: number;
  onChange: (
    light: MotionLight,
    property: MotionLightProperty,
    value: number,
  ) => void;
  onToggleKeyframe: (
    light: MotionLight,
    property: MotionLightProperty,
  ) => void;
}): JSX.Element {
  const descriptor = getMotionLightPropertyDescriptor(property);
  const activeKeyframe = Boolean(
    findMotionLightKeyframeAtTime(light, property, localTime),
  );
  const keyframeCount = getMotionLightPropertyKeyframes(light, property).length;

  return (
    <Field
      label={editorMessage(LIGHT_PROPERTY_LABEL_KEYS[property])}
      hint={keyframeCount > 0 ? editorMessage("editor.motion.properties.keysCount", { count: keyframeCount }) : descriptor.unit}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_32px] gap-1.5">
        <NumberInput
          value={value}
          min={descriptor.min}
          max={descriptor.max}
          step={descriptor.step}
          unit={descriptor.unit}
          onChange={(nextValue) => onChange(light, property, nextValue)}
        />
        <IconButton
          icon={Diamond}
          label={activeKeyframe ? editorMessage("editor.motion.properties.removeLightKeyframe") : editorMessage("editor.motion.properties.addLightKeyframe")}
          active={activeKeyframe}
          variant={activeKeyframe ? "solid" : "outline"}
          iconSize={13}
          onClick={() => {
            onToggleKeyframe(light, property);
          }}
        />
      </div>
    </Field>
  );
}

function AdjustmentLayerSection({
  layer,
  replaceLayer,
}: {
  layer: Extract<MotionLayer, { type: "adjustment" }>;
  replaceLayer: (nextLayer: MotionLayer) => void;
}): JSX.Element {
  return (
    <Section title={editorMessage("editor.motion.properties.adjustment")} icon={SlidersHorizontal}>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label={editorMessage("editor.motion.properties.width")}>
          <NumberInput
            value={layer.width}
            min={1}
            unit="px"
            onChange={(width) => replaceLayer({ ...layer, width })}
          />
        </Field>
        <Field label={editorMessage("editor.motion.properties.height")}>
          <NumberInput
            value={layer.height}
            min={1}
            unit="px"
            onChange={(height) => replaceLayer({ ...layer, height })}
          />
        </Field>
      </div>
    </Section>
  );
}

function NullLayerSection({
  layer,
  replaceLayer,
}: {
  layer: Extract<MotionLayer, { type: "null" }>;
  replaceLayer: (nextLayer: MotionLayer) => void;
}): JSX.Element {
  return (
    <Section title={editorMessage("editor.motion.properties.controller")} icon={Crosshair}>
      <Field label={editorMessage("editor.motion.properties.guideColor")}>
        <ColorInput
          value={layer.guideColor ?? "#14b8a6"}
          onChange={(guideColor) => replaceLayer({ ...layer, guideColor })}
        />
      </Field>
      <Field label={editorMessage("editor.motion.properties.guideSize")}>
        <NumberInput
          value={layer.guideSize ?? 48}
          min={12}
          max={240}
          step={1}
          unit="px"
          onChange={(guideSize) => replaceLayer({ ...layer, guideSize })}
        />
      </Field>
    </Section>
  );
}

function ImageLayerSection({
  composition,
  layer,
  replaceLayer,
}: {
  composition: MotionComposition;
  layer: Extract<MotionLayer, { type: "image" }>;
  replaceLayer: (nextLayer: MotionLayer) => void;
}): JSX.Element {
  const imageAssets = composition.assets.filter((asset) => asset.type === "image");
  const selectedAsset = imageAssets.find((asset) => asset.id === layer.assetId);

  return (
    <Section title={editorMessage("editor.motion.properties.image")} icon={ImageIcon}>
      {imageAssets.length === 0 ? (
        <ToolcraftText type="supporting" color="secondary" className="block rounded-lg border border-dashed border-border bg-bg-2 px-3 py-3 text-[12px] leading-relaxed text-fg-muted">
          {editorMessage("editor.motion.properties.imageEmpty")}
        </ToolcraftText>
      ) : (
        <Field label={editorMessage("editor.motion.properties.source")}>
          <SelectControl
            label={editorMessage("editor.motion.properties.imageSource")}
            preserveOptions
            value={layer.assetId}
            options={imageAssets.map((asset) => ({
              value: asset.id,
              label: asset.name,
            }))}
            onChange={(assetId) => {
              const asset = imageAssets.find(
                (candidate) => candidate.id === assetId,
              );
              if (!asset) return;
              replaceLayer({
                ...layer,
                assetId: asset.id,
                name: asset.name,
                width: layer.width ?? asset.width,
                height: layer.height ?? asset.height,
              });
            }}
          />
        </Field>
      )}

      <div className="grid grid-cols-2 gap-2.5">
        <Field label={editorMessage("editor.motion.properties.width")}>
          <NumberInput
            value={layer.width ?? selectedAsset?.width ?? 320}
            min={1}
            unit="px"
            onChange={(width) => replaceLayer({ ...layer, width })}
          />
        </Field>
        <Field label={editorMessage("editor.motion.properties.height")}>
          <NumberInput
            value={layer.height ?? selectedAsset?.height ?? 180}
            min={1}
            unit="px"
            onChange={(height) => replaceLayer({ ...layer, height })}
          />
        </Field>
      </div>

      <Field label={editorMessage("editor.motion.properties.fit")}>
        <SelectControl
          label={editorMessage("editor.motion.properties.imageFit")}
          value={layer.fit ?? "contain"}
          options={[
            { value: "contain", label: editorMessage("editor.motion.properties.contain") },
            { value: "cover", label: editorMessage("editor.motion.properties.cover") },
            { value: "fill", label: editorMessage("editor.motion.properties.fill") },
          ]}
          onChange={(fit) =>
            replaceLayer({
              ...layer,
              fit: fit as "contain" | "cover" | "fill",
            })
          }
        />
      </Field>
    </Section>
  );
}

function VideoLayerSection({
  composition,
  layer,
  replaceLayer,
}: {
  composition: MotionComposition;
  layer: Extract<MotionLayer, { type: "video" }>;
  replaceLayer: (nextLayer: MotionLayer) => void;
}): JSX.Element {
  const playhead = useMotionStore((state) => state.playhead);
  const videoAssets = composition.assets.filter((asset) => asset.type === "video");
  const selectedAsset = videoAssets.find((asset) => asset.id === layer.assetId);
  const sourceTimeAtPlayhead = getMotionVideoLayerSourceTime(
    { ...layer, freezeFrame: undefined },
    Math.max(0, playhead - layer.startTime),
    selectedAsset?.duration,
  );

  return (
    <Section title={editorMessage("editor.motion.properties.video")} icon={Film}>
      {videoAssets.length === 0 ? (
        <ToolcraftText type="supporting" color="secondary" className="block rounded-lg border border-dashed border-border bg-bg-2 px-3 py-3 text-[12px] leading-relaxed text-fg-muted">
          {editorMessage("editor.motion.properties.videoEmpty")}
        </ToolcraftText>
      ) : (
        <Field label={editorMessage("editor.motion.properties.source")}>
          <SelectControl
            label={editorMessage("editor.motion.properties.videoSource")}
            preserveOptions
            value={layer.assetId}
            options={videoAssets.map((asset) => ({
              value: asset.id,
              label: asset.name,
            }))}
            onChange={(assetId) => {
              const asset = videoAssets.find(
                (candidate) => candidate.id === assetId,
              );
              if (!asset) return;
              replaceLayer({
                ...layer,
                assetId: asset.id,
                name: asset.name,
                width: layer.width ?? asset.width,
                height: layer.height ?? asset.height,
              });
            }}
          />
        </Field>
      )}

      <div className="grid grid-cols-2 gap-2.5">
        <Field label={editorMessage("editor.motion.properties.width")}>
          <NumberInput
            value={layer.width ?? selectedAsset?.width ?? 1920}
            min={1}
            unit="px"
            onChange={(width) => replaceLayer({ ...layer, width })}
          />
        </Field>
        <Field label={editorMessage("editor.motion.properties.height")}>
          <NumberInput
            value={layer.height ?? selectedAsset?.height ?? 1080}
            min={1}
            unit="px"
            onChange={(height) => replaceLayer({ ...layer, height })}
          />
        </Field>
      </div>

      <Field label={editorMessage("editor.motion.properties.fit")}>
        <SelectControl
          label={editorMessage("editor.motion.properties.videoFit")}
          value={layer.fit ?? "contain"}
          options={[
            { value: "contain", label: editorMessage("editor.motion.properties.contain") },
            { value: "cover", label: editorMessage("editor.motion.properties.cover") },
            { value: "fill", label: editorMessage("editor.motion.properties.fill") },
          ]}
          onChange={(fit) =>
            replaceLayer({
              ...layer,
              fit: fit as "contain" | "cover" | "fill",
            })
          }
        />
      </Field>

      <div className="grid grid-cols-2 gap-2.5">
        <Field label={editorMessage("editor.motion.properties.speed")} hint="×">
          <NumberInput
            value={layer.playbackRate ?? 1}
            min={0.1}
            max={8}
            step={0.1}
            onChange={(playbackRate) => replaceLayer({ ...layer, playbackRate })}
          />
        </Field>
        <Field label={editorMessage("editor.motion.properties.trimStart")} hint="s">
          <NumberInput
            value={layer.trimStart ?? 0}
            min={0}
            step={0.05}
            onChange={(trimStart) => replaceLayer({ ...layer, trimStart })}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <ToggleControl
          label={editorMessage("editor.motion.properties.loopSource")}
          checked={Boolean(layer.loop)}
          onChange={(loop) => replaceLayer({ ...layer, loop })}
        />
        <ToggleControl
          label={editorMessage("editor.motion.properties.reverse")}
          checked={Boolean(layer.reverse)}
          onChange={(reverse) => replaceLayer({ ...layer, reverse })}
        />
      </div>

      <ToggleControl
        label={editorMessage("editor.motion.properties.freezeFrame")}
        checked={Number.isFinite(layer.freezeFrame)}
        onChange={(freeze) =>
          replaceLayer({
            ...layer,
            freezeFrame: freeze ? sourceTimeAtPlayhead : undefined,
          })
        }
      />
      {Number.isFinite(layer.freezeFrame) ? (
        <Field label={editorMessage("editor.motion.properties.frozenTime")} hint="s">
          <NumberInput
            value={layer.freezeFrame ?? 0}
            min={0}
            max={selectedAsset?.duration}
            step={1 / composition.frameRate}
            onChange={(freezeFrame) => replaceLayer({ ...layer, freezeFrame })}
          />
        </Field>
      ) : null}

      <ToggleControl
        label={editorMessage("editor.motion.properties.muteAudio")}
        checked={layer.muted ?? false}
        onChange={(muted) => replaceLayer({ ...layer, muted })}
      />
    </Section>
  );
}

const PARTICLE_PRESET_NAME_KEYS = {
  "sparks": "editor.motion.properties.particlePreset.sparks",
  "confetti": "editor.motion.properties.particlePreset.confetti",
  "snow": "editor.motion.properties.particlePreset.snow",
  "dust": "editor.motion.properties.particlePreset.dust",
  "ui-burst": "editor.motion.properties.particlePreset.ui-burst",
} as const;

function ParticleLayerSection({
  layer,
  replaceLayer,
}: {
  layer: Extract<MotionLayer, { type: "particle" }>;
  replaceLayer: (nextLayer: MotionLayer) => void;
}): JSX.Element {
  const emitter = normalizeMotionParticleEmitter(layer.emitter);
  const patchEmitter = (updates: Partial<MotionParticleEmitter>) => {
    replaceLayer({
      ...layer,
      emitter: normalizeMotionParticleEmitter({
        ...emitter,
        ...updates,
      }),
    });
  };

  return (
    <Section title={editorMessage("editor.motion.properties.particles")} icon={Sparkles}>
      <div className="grid grid-cols-2 gap-1.5">
        {MOTION_PARTICLE_PRESETS.map((preset) => (
          <Button
            key={preset.id}
            label={editorMessage("editor.motion.properties.particlePresetRate", { name: editorMessage(PARTICLE_PRESET_NAME_KEYS[preset.id]), rate: preset.emitter.emissionRate })}
            size="sm"
            variant="secondary"
            onClick={() => replaceLayer(applyMotionParticlePreset(layer, preset.id, { defaultName: editorMessage(PARTICLE_PRESET_NAME_KEYS[preset.id]) }))}
          />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label={editorMessage("editor.motion.properties.rate")} hint="/s">
          <NumberInput
            value={emitter.emissionRate}
            min={0}
            max={1000}
            step={1}
            onChange={(emissionRate) => patchEmitter({ emissionRate })}
          />
        </Field>
        <Field label={editorMessage("editor.motion.properties.maxParticles")}>
          <NumberInput
            value={emitter.maxParticles}
            min={0}
            max={5000}
            step={1}
            onChange={(maxParticles) => patchEmitter({ maxParticles })}
          />
        </Field>
        <Field label={editorMessage("editor.motion.properties.lifetime")} hint="s">
          <NumberInput
            value={emitter.lifetime}
            min={0.01}
            max={60}
            step={0.1}
            onChange={(lifetime) => patchEmitter({ lifetime })}
          />
        </Field>
        <Field label={editorMessage("editor.motion.properties.speed")}>
          <NumberInput
            value={emitter.speed}
            min={0}
            max={5000}
            step={10}
            onChange={(speed) => patchEmitter({ speed })}
          />
        </Field>
        <Field label={editorMessage("editor.motion.properties.spread")} hint="deg">
          <NumberInput
            value={emitter.spread}
            min={0}
            max={360}
            step={1}
            onChange={(spread) => patchEmitter({ spread })}
          />
        </Field>
        <Field label={editorMessage("editor.motion.properties.gravity")}>
          <NumberInput
            value={emitter.gravity}
            min={-5000}
            max={5000}
            step={10}
            onChange={(gravity) => patchEmitter({ gravity })}
          />
        </Field>
        <Field label={editorMessage("editor.motion.properties.size")}>
          <NumberInput
            value={emitter.size}
            min={0.1}
            max={1000}
            step={1}
            onChange={(size) => patchEmitter({ size })}
          />
        </Field>
        <Field label={editorMessage("editor.motion.properties.random")} hint="%">
          <NumberInput
            value={Math.round(emitter.sizeRandomness * 100)}
            min={0}
            max={100}
            step={1}
            onChange={(sizeRandomness) =>
              patchEmitter({ sizeRandomness: sizeRandomness / 100 })
            }
          />
        </Field>
        <Field label={editorMessage("editor.motion.properties.startOpacity")} hint="%">
          <NumberInput
            value={Math.round(emitter.opacityStart * 100)}
            min={0}
            max={100}
            step={1}
            onChange={(opacityStart) =>
              patchEmitter({ opacityStart: opacityStart / 100 })
            }
          />
        </Field>
        <Field label={editorMessage("editor.motion.properties.endOpacity")} hint="%">
          <NumberInput
            value={Math.round(emitter.opacityEnd * 100)}
            min={0}
            max={100}
            step={1}
            onChange={(opacityEnd) =>
              patchEmitter({ opacityEnd: opacityEnd / 100 })
            }
          />
        </Field>
        <Field label={editorMessage("editor.motion.properties.seed")}>
          <NumberInput
            value={emitter.seed}
            min={-1_000_000}
            max={1_000_000}
            step={1}
            onChange={(seed) => patchEmitter({ seed })}
          />
        </Field>
        <Field label={editorMessage("editor.motion.properties.shape")}>
          <SelectControl
            label={editorMessage("editor.motion.properties.particleShape")}
            value={emitter.shape}
            options={[
              { value: "circle", label: editorMessage("editor.motion.properties.particleCircle") },
              { value: "square", label: editorMessage("editor.motion.properties.particleSquare") },
            ]}
            onChange={(shape) =>
              patchEmitter({ shape: shape as MotionParticleShape })
            }
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label={editorMessage("editor.motion.properties.startColor")}>
          <ColorInput
            value={emitter.colorStart}
            onChange={(colorStart) => patchEmitter({ colorStart })}
          />
        </Field>
        <Field label={editorMessage("editor.motion.properties.endColor")}>
          <ColorInput
            value={emitter.colorEnd}
            onChange={(colorEnd) => patchEmitter({ colorEnd })}
          />
        </Field>
      </div>
    </Section>
  );
}

function PrecompSection({
  hostComposition,
  layer,
  motionCompositions,
  replaceLayer,
}: {
  hostComposition: MotionComposition;
  layer: Extract<MotionLayer, { type: "composition" }>;
  motionCompositions: readonly MotionComposition[];
  replaceLayer: (nextLayer: MotionLayer) => void;
}): JSX.Element {
  const setActiveCompositionId = useMotionStore(
    (state) => state.setActiveCompositionId,
  );
  const playhead = useMotionStore((state) => state.playhead);
  const setSelectedProperty = useMotionStore((state) => state.setSelectedProperty);
  const setRightTab = useMotionStore((state) => state.setRightTab);
  const source = motionCompositions.find(
    (composition) => composition.id === layer.compositionId,
  );
  const sourceOptions = motionCompositions.filter(
    (candidate) =>
      candidate.id === layer.compositionId ||
      canNestMotionComposition(
        motionCompositions,
        hostComposition.id,
        candidate.id,
      ),
  );
  const layerLocalTime = Math.min(
    layer.duration,
    Math.max(0, playhead - layer.startTime),
  );
  const sourceDuration = source?.duration ?? layer.duration;
  const sourceTime = Math.min(
    sourceDuration,
    getMotionCompositionLayerPlaybackTime(layer, layerLocalTime, sourceDuration),
  );
  const remapped = isMotionCompositionTimeRemapped(layer);
  const remapKeyAtPlayhead = findMotionLayerKeyframeAtTime(
    layer,
    MOTION_COMPOSITION_TIME_PROPERTY,
    layerLocalTime,
  );

  const focusTimeRemapGraph = () => {
    setSelectedProperty(MOTION_COMPOSITION_TIME_PROPERTY);
    setRightTab("graph");
  };

  const enableTimeRemap = () => {
    replaceLayer(
      enableMotionCompositionTimeRemap(layer, {
        sourceDuration,
      }),
    );
    focusTimeRemapGraph();
  };

  const clearTimeRemap = () => {
    replaceLayer(clearMotionCompositionTimeRemap(layer));
  };

  const keySourceTime = (value = sourceTime) => {
    replaceLayer(
      upsertMotionLayerKeyframe(layer, MOTION_COMPOSITION_TIME_PROPERTY, layerLocalTime, {
        value: Math.min(sourceDuration, Math.max(0, value)),
        easing: remapKeyAtPlayhead?.easing ?? "linear",
      }),
    );
    focusTimeRemapGraph();
  };

  const freezeFrameAtPlayhead = () => {
    const frozenTime = sourceTime;
    const remapKeyframes = [
      {
        id: `motion-kf-${Date.now()}-freeze-start`,
        property: MOTION_COMPOSITION_TIME_PROPERTY,
        time: 0,
        value: frozenTime,
        easing: "hold",
      },
      {
        id: `motion-kf-${Date.now()}-freeze-end`,
        property: MOTION_COMPOSITION_TIME_PROPERTY,
        time: Math.max(0.001, layer.duration),
        value: frozenTime,
        easing: "hold",
      },
    ] satisfies Keyframe[];
    replaceLayer({
      ...clearMotionCompositionTimeRemap(layer),
      keyframes: sortMotionKeyframes([
        ...layer.keyframes.filter(
          (keyframe) => keyframe.property !== MOTION_COMPOSITION_TIME_PROPERTY,
        ),
        ...remapKeyframes,
      ]),
    });
    focusTimeRemapGraph();
  };

  const reverseTimeRemap = () => {
    const remapKeyframes = [
      {
        id: `motion-kf-${Date.now()}-reverse-start`,
        property: MOTION_COMPOSITION_TIME_PROPERTY,
        time: 0,
        value: Math.min(sourceDuration, Math.max(0, sourceDuration)),
        easing: "linear",
      },
      {
        id: `motion-kf-${Date.now()}-reverse-end`,
        property: MOTION_COMPOSITION_TIME_PROPERTY,
        time: Math.max(0.001, layer.duration),
        value: 0,
        easing: "linear",
      },
    ] satisfies Keyframe[];
    replaceLayer({
      ...clearMotionCompositionTimeRemap(layer),
      keyframes: sortMotionKeyframes([
        ...layer.keyframes.filter(
          (keyframe) => keyframe.property !== MOTION_COMPOSITION_TIME_PROPERTY,
        ),
        ...remapKeyframes,
      ]),
    });
    focusTimeRemapGraph();
  };

  const overridableChildren = (source?.layers ?? []).filter(
    (child) => child.type === "text" || child.type === "shape",
  );

  const masterColorOf = (child: MotionLayer): string => {
    if (child.type === "text") {
      return (
        child.style.fillGradient?.stops[0]?.color ??
        child.style.color ??
        "#ffffff"
      );
    }
    if (child.type === "shape") {
      const fill = child.style.fill;
      if (fill.type === "solid") return fill.color ?? "#ffffff";
      return fill.gradient?.stops[0]?.color ?? "#ffffff";
    }
    return "#ffffff";
  };

  const setChildOverride = (childId: string, patch: MotionInstanceOverride) => {
    const current = layer.overrides ?? {};
    const next = { ...current, [childId]: { ...current[childId], ...patch } };
    replaceLayer({ ...layer, overrides: next });
  };

  const clearChildOverride = (childId: string) => {
    if (!layer.overrides?.[childId]) return;
    const next = { ...layer.overrides };
    delete next[childId];
    replaceLayer({
      ...layer,
      overrides: Object.keys(next).length > 0 ? next : undefined,
    });
  };

  const hasOverrides =
    layer.overrides !== undefined && Object.keys(layer.overrides).length > 0;

  return (
    <Section
      title={editorMessage("editor.motion.properties.precomp")}
      icon={Clapperboard}
      action={
        <IconButton
          icon={Clapperboard}
          label={editorMessage("editor.motion.properties.openSource")}
          size="sm"
          variant="outline"
          disabled={!source}
          onClick={() => source && setActiveCompositionId(source.id)}
        />
      }
    >
      {!source ? (
        <ToolcraftText type="supporting" color="secondary" className="block rounded-lg border border-dashed border-border bg-bg-2 px-3 py-3 text-[12px] leading-relaxed text-fg-muted">
          {editorMessage("editor.motion.properties.missingComposition")}
        </ToolcraftText>
      ) : null}

      <Field label={editorMessage("editor.motion.properties.source")}>
        <SelectControl
          label={editorMessage("editor.motion.properties.sourceComposition")}
          preserveOptions
          value={layer.compositionId}
          options={sourceOptions.map((candidate) => ({
            value: candidate.id,
            label: candidate.name,
          }))}
          onChange={(compositionId) => {
            const nextSource = motionCompositions.find(
              (composition) => composition.id === compositionId,
            );
            if (!nextSource) return;
            replaceLayer({
              ...layer,
              compositionId: nextSource.id,
              name: nextSource.name,
              width: nextSource.width,
              height: nextSource.height,
              duration: Math.min(layer.duration, nextSource.duration),
            });
          }}
        />
      </Field>

      <div className="grid grid-cols-2 gap-2.5">
        <Field label={editorMessage("editor.motion.properties.width")}>
          <NumberInput
            value={layer.width}
            min={1}
            unit="px"
            onChange={(width) => replaceLayer({ ...layer, width })}
          />
        </Field>
        <Field label={editorMessage("editor.motion.properties.height")}>
          <NumberInput
            value={layer.height}
            min={1}
            unit="px"
            onChange={(height) => replaceLayer({ ...layer, height })}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <Field label={editorMessage("editor.motion.properties.timeOffset")} hint="s">
          <NumberInput
            value={layer.timeOffset}
            min={0}
            step={0.1}
            onChange={(timeOffset) => replaceLayer({ ...layer, timeOffset })}
          />
        </Field>
        <Field label={editorMessage("editor.motion.properties.playback")}>
          <NumberInput
            value={layer.playbackRate}
            min={0.01}
            step={0.05}
            onChange={(playbackRate) =>
              replaceLayer({ ...layer, playbackRate })
            }
          />
        </Field>
      </div>

      <ToggleControl
        label={editorMessage("editor.motion.properties.loopSource")}
        checked={Boolean(layer.loop)}
        onChange={(loop) => replaceLayer({ ...layer, loop })}
      />

      <div className="rounded-lg border border-border bg-bg-2 p-2.5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-3">{editorMessage("editor.motion.properties.timeRemap")}</span>
          <span className="rounded-md bg-bg-1 px-1.5 py-0.5 text-[10.5px] tabular-nums text-fg-muted">
            {sourceTime.toFixed(2)}s
          </span>
        </div>
        <div className="mb-2 grid grid-cols-2 gap-1.5">
          <Button
            label={remapped ? editorMessage("editor.motion.properties.clearRemap") : editorMessage("editor.motion.properties.enableRemap")}
            size="sm"
            variant="secondary"
            onClick={remapped ? clearTimeRemap : enableTimeRemap}
          />
          <Button
            label={remapKeyAtPlayhead ? editorMessage("editor.motion.properties.updateKey") : editorMessage("editor.motion.properties.keyTime")}
            size="sm"
            variant={remapKeyAtPlayhead ? "primary" : "secondary"}
            onClick={() => keySourceTime()}
          />
          <Button
            label={editorMessage("editor.motion.properties.freeze")}
            size="sm"
            variant="secondary"
            onClick={freezeFrameAtPlayhead}
          />
          <Button
            label={editorMessage("editor.motion.properties.reverse")}
            size="sm"
            variant="secondary"
            onClick={reverseTimeRemap}
          />
        </div>
        <Field label={editorMessage("editor.motion.properties.sourceTime")} hint="s">
          <NumberInput
            value={sourceTime}
            min={0}
            max={sourceDuration}
            step={1 / Math.max(1, source?.frameRate ?? hostComposition.frameRate)}
            onChange={keySourceTime}
          />
        </Field>
      </div>

      <Field label={editorMessage("editor.motion.properties.fit")}>
        <SelectControl
          label={editorMessage("editor.motion.properties.precompFit")}
          value={layer.fit ?? "contain"}
          options={[
            { value: "contain", label: editorMessage("editor.motion.properties.contain") },
            { value: "cover", label: editorMessage("editor.motion.properties.cover") },
            { value: "fill", label: editorMessage("editor.motion.properties.fill") },
          ]}
          onChange={(fit) =>
            replaceLayer({
              ...layer,
              fit: fit as "contain" | "cover" | "fill",
            })
          }
        />
      </Field>

      {source && overridableChildren.length > 0 ? (
        <div className="rounded-lg border border-border bg-bg-2 p-2.5">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-3">
              {editorMessage("editor.motion.properties.overrides")}
            </span>
            {hasOverrides ? (
              <Button
                label={editorMessage("editor.motion.properties.resetAll")}
                size="sm"
                variant="ghost"
                onClick={() => replaceLayer({ ...layer, overrides: undefined })}
              />
            ) : null}
          </div>
          <div className="space-y-2.5">
            {overridableChildren.map((child) => {
              const override = layer.overrides?.[child.id];
              return (
                <div
                  key={child.id}
                  className="rounded-lg border border-border bg-bg-1 p-2.5"
                >
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span data-shotloom-user-content="" className="truncate text-[11px] font-medium text-fg-3">
                      {child.name}
                    </span>
                    {override ? (
                      <Button
                        label={editorMessage("editor.motion.properties.reset")}
                        size="sm"
                        variant="ghost"
                        onClick={() => clearChildOverride(child.id)}
                      />
                    ) : null}
                  </div>
                  {child.type === "text" ? (
                    <Field label={editorMessage("editor.motion.properties.text")}>
                      <TextArea
                        value={override?.text ?? child.text}
                        onChange={(text) => setChildOverride(child.id, { text })}
                      />
                    </Field>
                  ) : null}
                  <Field label={editorMessage("editor.motion.properties.color")}>
                    <ColorInput
                      value={override?.color ?? masterColorOf(child)}
                      onChange={(color) => setChildOverride(child.id, { color })}
                    />
                  </Field>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </Section>
  );
}

const TEXT_ANIMATOR_PRESET_KEYS = {
  "text-reveal-up": "editor.motion.properties.textPreset.text-reveal-up",
  "text-type-on": "editor.motion.properties.textPreset.text-type-on",
  "text-scale-in": "editor.motion.properties.textPreset.text-scale-in",
  "text-reveal-down": "editor.motion.properties.textPreset.text-reveal-down",
  "text-slide-left": "editor.motion.properties.textPreset.text-slide-left",
  "text-spin-in": "editor.motion.properties.textPreset.text-spin-in",
} as const;
const TEXT_BASED_ON_KEYS = { characters: "editor.motion.properties.characters", words: "editor.motion.properties.words" } as const;
const TEXT_DIRECTION_KEYS = { forward: "editor.motion.properties.forward", reverse: "editor.motion.properties.reverse", center: "editor.motion.properties.fromCenter" } as const;
const JOIN_LABEL_KEYS = { miter: "editor.motion.properties.miter", round: "editor.motion.properties.round", bevel: "editor.motion.properties.bevel" } as const;

function TextAnimatorsSection({
  layer,
  replaceLayer,
}: {
  layer: Extract<MotionLayer, { type: "text" }>;
  replaceLayer: (nextLayer: MotionLayer) => void;
}): JSX.Element {
  const animators = layer.textAnimators ?? [];

  const updateAnimator = (
    animator: MotionTextAnimator,
    updater: (current: MotionTextAnimator) => MotionTextAnimator,
  ) => {
    replaceLayer(updateMotionTextAnimator(layer, animator.id, updater));
  };

  return (
    <Section
      title={editorMessage("editor.motion.properties.textAnimators")}
      icon={Type}
      action={
        <div className="relative flex w-[150px] items-center rounded-[7px] border border-border bg-bg-1">
          <select
            aria-label={editorMessage("editor.motion.properties.addAnimatorPreset")}
            value=""
            onChange={(event) => {
              const presetId = event.target.value;
              if (!presetId) return;
              replaceLayer(
                addMotionTextAnimator(layer, { ...createMotionTextAnimator(presetId), name: editorMessage(TEXT_ANIMATOR_PRESET_KEYS[presetId as keyof typeof TEXT_ANIMATOR_PRESET_KEYS]) }),
              );
            }}
            className="w-full cursor-pointer appearance-none truncate bg-transparent py-1.5 pl-[10px] pr-[24px] text-[12px] font-medium text-fg-2 outline-none"
          >
            <option value="">{editorMessage("editor.motion.properties.addAnimator")}</option>
            {MOTION_TEXT_ANIMATOR_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {editorMessage(TEXT_ANIMATOR_PRESET_KEYS[preset.id as keyof typeof TEXT_ANIMATOR_PRESET_KEYS])}
              </option>
            ))}
          </select>
          <svg
            className="pointer-events-none absolute right-[9px]"
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--fg-muted)"
            strokeWidth="2.2"
            aria-hidden
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
      }
    >
      {animators.length === 0 ? (
        <ToolcraftText type="supporting" color="secondary" className="block rounded-lg border border-dashed border-border bg-bg-2 px-3 py-3 text-[12px] leading-relaxed text-fg-muted">
          {editorMessage("editor.motion.properties.animatorEmpty")}
        </ToolcraftText>
      ) : (
        <div className="space-y-3">
          {animators.map((animator) => (
            <div
              key={animator.id}
              className={`rounded-xl border border-border bg-bg-1 shadow-sm ${animator.enabled ? "" : "opacity-55"}`}
            >
              <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-bg-2 text-fg-3">
                  <Type size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span data-shotloom-user-content="" className="block truncate text-[12.5px] font-semibold text-fg-2">
                    {animator.name}
                  </span>
                  <span className="block text-[10.5px] text-fg-muted">
                    {editorMessage(TEXT_BASED_ON_KEYS[animator.selector.basedOn])} · {editorMessage(TEXT_DIRECTION_KEYS[animator.timing.direction])}
                  </span>
                </span>
                <div className="flex items-center gap-0.5">
                  <IconButton
                    icon={animator.enabled ? Eye : EyeOff}
                    label={
                      animator.enabled
                        ? editorMessage("editor.motion.properties.disableAnimator")
                        : editorMessage("editor.motion.properties.enableAnimator")
                    }
                    size="sm"
                    active={animator.enabled}
                    onClick={() =>
                      replaceLayer(
                        toggleMotionTextAnimator(
                          layer,
                          animator.id,
                          !animator.enabled,
                        ),
                      )
                    }
                  />
                  <IconButton
                    icon={Trash2}
                    label={editorMessage("editor.motion.properties.removeAnimator")}
                    size="sm"
                    variant="danger"
                    onClick={() =>
                      replaceLayer(removeMotionTextAnimator(layer, animator.id))
                    }
                  />
                </div>
              </div>

              <div className="space-y-3 p-3">
                <Field label={editorMessage("editor.motion.properties.name")}>
                  <TextInput
                    value={animator.name}
                    onChange={(name) =>
                      updateAnimator(animator, (current) => ({
                        ...current,
                        name,
                      }))
                    }
                  />
                </Field>

                <div className="grid grid-cols-2 gap-2.5">
                  <Field label={editorMessage("editor.motion.properties.basedOn")}>
                    <SelectControl
                      label={editorMessage("editor.motion.properties.basedOn")}
                      value={animator.selector.basedOn}
                      options={[
                        { value: "characters", label: editorMessage("editor.motion.properties.characters") },
                        { value: "words", label: editorMessage("editor.motion.properties.words") },
                      ]}
                      onChange={(basedOn) =>
                        updateAnimator(animator, (current) => ({
                          ...current,
                          selector: {
                            ...current.selector,
                            basedOn: basedOn as MotionTextAnimatorBasedOn,
                          },
                        }))
                      }
                    />
                  </Field>
                  <Field label={editorMessage("editor.motion.properties.direction")}>
                    <SelectControl
                      label={editorMessage("editor.motion.properties.direction")}
                      value={animator.timing.direction}
                      options={[
                        { value: "forward", label: editorMessage("editor.motion.properties.forward") },
                        { value: "reverse", label: editorMessage("editor.motion.properties.reverse") },
                        { value: "center", label: editorMessage("editor.motion.properties.fromCenter") },
                      ]}
                      onChange={(direction) =>
                        updateAnimator(animator, (current) => ({
                          ...current,
                          timing: {
                            ...current.timing,
                            direction: direction as MotionTextAnimatorDirection,
                          },
                        }))
                      }
                    />
                  </Field>
                </div>

                <div className="grid grid-cols-3 gap-2.5">
                  <Field label={editorMessage("editor.motion.properties.start")} hint="%">
                    <NumberInput
                      value={animator.selector.start}
                      min={0}
                      max={100}
                      onChange={(start) =>
                        updateAnimator(animator, (current) => ({
                          ...current,
                          selector: { ...current.selector, start },
                        }))
                      }
                    />
                  </Field>
                  <Field label={editorMessage("editor.motion.properties.end")} hint="%">
                    <NumberInput
                      value={animator.selector.end}
                      min={0}
                      max={100}
                      onChange={(end) =>
                        updateAnimator(animator, (current) => ({
                          ...current,
                          selector: { ...current.selector, end },
                        }))
                      }
                    />
                  </Field>
                  <Field label={editorMessage("editor.motion.properties.offset")} hint="%">
                    <NumberInput
                      value={animator.selector.offset}
                      onChange={(offset) =>
                        updateAnimator(animator, (current) => ({
                          ...current,
                          selector: { ...current.selector, offset },
                        }))
                      }
                    />
                  </Field>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <Field label={editorMessage("editor.motion.properties.startTime")} hint="s">
                    <NumberInput
                      value={animator.timing.startTime}
                      min={0}
                      step={0.05}
                      onChange={(startTime) =>
                        updateAnimator(animator, (current) => ({
                          ...current,
                          timing: { ...current.timing, startTime },
                        }))
                      }
                    />
                  </Field>
                  <Field label={editorMessage("editor.motion.properties.duration")} hint="s">
                    <NumberInput
                      value={animator.timing.duration}
                      min={0.001}
                      step={0.05}
                      onChange={(duration) =>
                        updateAnimator(animator, (current) => ({
                          ...current,
                          timing: { ...current.timing, duration },
                        }))
                      }
                    />
                  </Field>
                  <Field label={editorMessage("editor.motion.properties.stagger")} hint="s">
                    <NumberInput
                      value={animator.timing.stagger}
                      min={0}
                      step={0.01}
                      onChange={(stagger) =>
                        updateAnimator(animator, (current) => ({
                          ...current,
                          timing: { ...current.timing, stagger },
                        }))
                      }
                    />
                  </Field>
                  <Field label={editorMessage("editor.motion.properties.ease")}>
                    <SelectControl
                      label={editorMessage("editor.motion.properties.ease")}
                      value={animator.timing.easing}
                      options={[
                        { value: "linear", label: editorMessage("editor.motion.properties.linear") },
                        { value: "ease", label: editorMessage("editor.motion.properties.ease") },
                        { value: "ease-in", label: editorMessage("editor.motion.properties.easeIn") },
                        { value: "ease-out", label: editorMessage("editor.motion.properties.easeOut") },
                      ]}
                      onChange={(easing) =>
                        updateAnimator(animator, (current) => ({
                          ...current,
                          timing: {
                            ...current.timing,
                            easing: easing as MotionTextAnimatorEasing,
                          },
                        }))
                      }
                    />
                  </Field>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <Field label={editorMessage("editor.motion.properties.initialX")} hint="px">
                    <NumberInput
                      value={animator.properties.position.x}
                      onChange={(x) =>
                        updateAnimator(animator, (current) => ({
                          ...current,
                          properties: {
                            ...current.properties,
                            position: { ...current.properties.position, x },
                          },
                        }))
                      }
                    />
                  </Field>
                  <Field label={editorMessage("editor.motion.properties.initialY")} hint="px">
                    <NumberInput
                      value={animator.properties.position.y}
                      onChange={(y) =>
                        updateAnimator(animator, (current) => ({
                          ...current,
                          properties: {
                            ...current.properties,
                            position: { ...current.properties.position, y },
                          },
                        }))
                      }
                    />
                  </Field>
                  <Field label={editorMessage("editor.motion.properties.initialScale")}>
                    <NumberInput
                      value={animator.properties.scale.x}
                      min={0.001}
                      step={0.05}
                      onChange={(scale) =>
                        updateAnimator(animator, (current) => ({
                          ...current,
                          properties: {
                            ...current.properties,
                            scale: { x: scale, y: scale },
                          },
                        }))
                      }
                    />
                  </Field>
                  <Field label={editorMessage("editor.motion.properties.initialOpacity")}>
                    <NumberInput
                      value={animator.properties.opacity}
                      min={0}
                      max={1}
                      step={0.05}
                      onChange={(opacity) =>
                        updateAnimator(animator, (current) => ({
                          ...current,
                          properties: { ...current.properties, opacity },
                        }))
                      }
                    />
                  </Field>
                  <Field label={editorMessage("editor.motion.properties.initialRotation")} hint="deg">
                    <NumberInput
                      value={animator.properties.rotation}
                      onChange={(rotation) =>
                        updateAnimator(animator, (current) => ({
                          ...current,
                          properties: { ...current.properties, rotation },
                        }))
                      }
                    />
                  </Field>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function ShapeModifiersSection({
  composition,
  layer,
  localTime,
  autoKeyframe,
  selectedProperty,
  setSelectedProperty,
  replaceLayer,
}: {
  composition: MotionComposition;
  layer: Extract<MotionLayer, { type: "shape" }>;
  localTime: number;
  autoKeyframe: boolean;
  selectedProperty: string | null;
  setSelectedProperty: (property: string | null) => void;
  replaceLayer: (nextLayer: MotionLayer) => void;
}): JSX.Element {
  const trimPaths = getMotionTrimPathsModifier(layer);
  const repeater = getMotionRepeaterModifier(layer);
  const zigZag = getMotionZigZagModifier(layer);
  const roundCorners = getMotionRoundCornersModifier(layer);
  const wigglePaths = getMotionWigglePathsModifier(layer);
  const offsetPaths = getMotionOffsetPathsModifier(layer);
  const puckerBloat = getMotionPuckerBloatModifier(layer);
  const twist = getMotionTwistModifier(layer);

  const addTrimPaths = () => {
    const fillColor =
      layer.style.fill.type === "solid" && layer.style.fill.color
        ? layer.style.fill.color
        : layer.style.stroke.color;
    const layerWithVisibleStroke =
      layer.style.stroke.width > 0
        ? layer
        : ({
            ...layer,
            style: {
              ...layer.style,
              stroke: {
                ...layer.style.stroke,
                color: fillColor,
                width: 8,
                opacity: 1,
              },
            },
          } satisfies typeof layer);

    replaceLayer(
      addMotionShapeModifier(
        layerWithVisibleStroke,
        { ...createMotionShapeModifier("trim-paths"), name: editorMessage("editor.motion.properties.modifier.trim-paths") },
      ),
    );
  };

  const addRepeater = () => {
    replaceLayer(addMotionShapeModifier(layer, { ...createMotionShapeModifier("repeater"), name: editorMessage("editor.motion.properties.modifier.repeater") }));
  };

  const addZigZag = () => {
    replaceLayer(addMotionShapeModifier(layer, { ...createMotionShapeModifier("zig-zag"), name: editorMessage("editor.motion.properties.modifier.zig-zag") }));
  };

  const addRoundCorners = () => {
    replaceLayer(
      addMotionShapeModifier(layer, { ...createMotionShapeModifier("round-corners"), name: editorMessage("editor.motion.properties.modifier.round-corners") }),
    );
  };

  const addWigglePaths = () => {
    replaceLayer(
      addMotionShapeModifier(layer, { ...createMotionShapeModifier("wiggle-paths"), name: editorMessage("editor.motion.properties.modifier.wiggle-paths") }),
    );
  };

  const addOffsetPaths = () => {
    replaceLayer(
      addMotionShapeModifier(layer, { ...createMotionShapeModifier("offset-paths"), name: editorMessage("editor.motion.properties.modifier.offset-paths") }),
    );
  };

  const addPuckerBloat = () => {
    replaceLayer(
      addMotionShapeModifier(layer, { ...createMotionShapeModifier("pucker-bloat"), name: editorMessage("editor.motion.properties.modifier.pucker-bloat") }),
    );
  };

  const addTwist = () => {
    replaceLayer(addMotionShapeModifier(layer, { ...createMotionShapeModifier("twist"), name: editorMessage("editor.motion.properties.modifier.twist") }));
  };

  const renderModifierNumberInput = ({
    modifierId,
    property,
    label,
    hint,
    min,
    max,
    step,
  }: {
    modifierId: string;
    property: MotionShapeModifierPropertyName;
    label: string;
    hint?: string;
    min?: number;
    max?: number;
    step?: number;
  }) => {
    const keyframeProperty = getMotionShapeModifierKeyframeProperty(
      modifierId,
      property,
    );
    const value = getMotionLayerPropertyValueAtTime(
      layer,
      keyframeProperty,
      localTime,
      composition,
    );
    const keyframeAtPlayhead = findMotionLayerKeyframeAtTime(
      layer,
      keyframeProperty,
      localTime,
    );
    const hasAnimatedProperty =
      getMotionLayerPropertyKeyframes(layer, keyframeProperty).length > 0;
    const writeValue = (nextValue: number) => {
      setSelectedProperty(keyframeProperty);
      if (autoKeyframe || hasAnimatedProperty) {
        replaceLayer(
          upsertMotionLayerKeyframe(layer, keyframeProperty, localTime, {
            value: nextValue,
            easing: keyframeAtPlayhead?.easing ?? "ease",
          }),
        );
        return;
      }
      replaceLayer(setMotionLayerPropertyValue(layer, keyframeProperty, nextValue));
    };
    const toggleKeyframe = () => {
      setSelectedProperty(keyframeProperty);
      replaceLayer(
        keyframeAtPlayhead
          ? removeMotionLayerKeyframe(layer, keyframeAtPlayhead.id)
          : upsertMotionLayerKeyframe(layer, keyframeProperty, localTime, {
              value,
              easing: "ease",
            }),
      );
    };

    return (
      <Field label={label} hint={hint}>
        <div className="grid grid-cols-[minmax(0,1fr)_28px] gap-1.5">
          <NumberInput
            value={value}
            min={min}
            max={max}
            step={step}
            onChange={writeValue}
          />
          <IconButton
            icon={Diamond}
            label={keyframeAtPlayhead ? editorMessage("editor.motion.shader.removeKeyframe", { name: label }) : editorMessage("editor.motion.shader.addKeyframe", { name: label })}
            size="sm"
            active={Boolean(keyframeAtPlayhead)}
            variant={selectedProperty === keyframeProperty ? "solid" : "ghost"}
            onClick={toggleKeyframe}
          />
        </div>
      </Field>
    );
  };

  return (
    <Section
      title={editorMessage("editor.motion.properties.shapeModifiers")}
      icon={Scissors}
      action={
        <div className="flex items-center gap-1">
          <IconButton
            icon={Plus}
            label={editorMessage("editor.motion.properties.modifier.trim-paths.add")}
            size="sm"
            variant="outline"
            disabled={Boolean(trimPaths)}
            onClick={addTrimPaths}
          />
          <IconButton
            icon={Plus}
            label={editorMessage("editor.motion.properties.modifier.repeater.add")}
            size="sm"
            variant="outline"
            disabled={Boolean(repeater)}
            onClick={addRepeater}
          />
          <IconButton
            icon={Plus}
            label={editorMessage("editor.motion.properties.modifier.zig-zag.add")}
            size="sm"
            variant="outline"
            disabled={Boolean(zigZag)}
            onClick={addZigZag}
          />
          <IconButton
            icon={Plus}
            label={editorMessage("editor.motion.properties.modifier.round-corners.add")}
            size="sm"
            variant="outline"
            disabled={Boolean(roundCorners)}
            onClick={addRoundCorners}
          />
          <IconButton
            icon={Plus}
            label={editorMessage("editor.motion.properties.modifier.wiggle-paths.add")}
            size="sm"
            variant="outline"
            disabled={Boolean(wigglePaths)}
            onClick={addWigglePaths}
          />
          <IconButton
            icon={Plus}
            label={editorMessage("editor.motion.properties.modifier.offset-paths.add")}
            size="sm"
            variant="outline"
            disabled={Boolean(offsetPaths)}
            onClick={addOffsetPaths}
          />
          <IconButton
            icon={Plus}
            label={editorMessage("editor.motion.properties.modifier.pucker-bloat.add")}
            size="sm"
            variant="outline"
            disabled={Boolean(puckerBloat)}
            onClick={addPuckerBloat}
          />
          <IconButton
            icon={Plus}
            label={editorMessage("editor.motion.properties.modifier.twist.add")}
            size="sm"
            variant="outline"
            disabled={Boolean(twist)}
            onClick={addTwist}
          />
        </div>
      }
    >
      {!trimPaths &&
      !repeater &&
      !zigZag &&
      !roundCorners &&
      !wigglePaths &&
      !offsetPaths &&
      !puckerBloat &&
      !twist ? (
        <ToolcraftText type="supporting" color="secondary" className="block rounded-lg border border-dashed border-border bg-bg-2 px-3 py-3 text-[12px] leading-relaxed text-fg-muted">
          {editorMessage("editor.motion.properties.modifierEmpty")}
        </ToolcraftText>
      ) : (
        <div className="space-y-3">
          {trimPaths ? (
            <div className={`rounded-xl border border-border bg-bg-1 shadow-sm ${trimPaths.enabled ? "" : "opacity-55"}`}>
              <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-bg-2 text-fg-3">
                  <Scissors size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span data-shotloom-user-content="" className="block truncate text-[12.5px] font-semibold text-fg-2">
                    {trimPaths.name}
                  </span>
                  <span className="block text-[10.5px] text-fg-muted">
                    {editorMessage("editor.motion.properties.strokeReveal")}
                  </span>
                </span>
                <div className="flex items-center gap-0.5">
                  <IconButton
                    icon={trimPaths.enabled ? Eye : EyeOff}
                    label={
                      trimPaths.enabled ? editorMessage("editor.motion.properties.modifier.trim-paths.disable") : editorMessage("editor.motion.properties.modifier.trim-paths.enable")
                    }
                    size="sm"
                    active={trimPaths.enabled}
                    onClick={() =>
                      replaceLayer(
                        toggleMotionShapeModifier(
                          layer,
                          trimPaths.id,
                          !trimPaths.enabled,
                        ),
                      )
                    }
                  />
                  <IconButton
                    icon={Trash2}
                    label={editorMessage("editor.motion.properties.modifier.trim-paths.remove")}
                    size="sm"
                    variant="danger"
                    onClick={() =>
                      replaceLayer(removeMotionShapeModifier(layer, trimPaths.id))
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2.5 p-3">
                {renderModifierNumberInput({ modifierId: trimPaths.id, property: "start", label: editorMessage("editor.motion.properties.start"), hint: "%", min: 0, max: 100 })}
                {renderModifierNumberInput({ modifierId: trimPaths.id, property: "end", label: editorMessage("editor.motion.properties.end"), hint: "%", min: 0, max: 100 })}
                {renderModifierNumberInput({ modifierId: trimPaths.id, property: "offset", label: editorMessage("editor.motion.properties.offset"), hint: "deg" })}
              </div>
            </div>
          ) : null}

          {repeater ? (
            <div className={`rounded-xl border border-border bg-bg-1 shadow-sm ${repeater.enabled ? "" : "opacity-55"}`}>
              <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-bg-2 text-fg-3">
                  <Square size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span data-shotloom-user-content="" className="block truncate text-[12.5px] font-semibold text-fg-2">
                    {repeater.name}
                  </span>
                  <span className="block text-[10.5px] text-fg-muted">
                    {editorMessage("editor.motion.properties.generatedCopies", { count: repeater.copies })}
                  </span>
                </span>
                <div className="flex items-center gap-0.5">
                  <IconButton
                    icon={repeater.enabled ? Eye : EyeOff}
                    label={repeater.enabled ? editorMessage("editor.motion.properties.modifier.repeater.disable") : editorMessage("editor.motion.properties.modifier.repeater.enable")}
                    size="sm"
                    active={repeater.enabled}
                    onClick={() =>
                      replaceLayer(
                        toggleMotionShapeModifier(
                          layer,
                          repeater.id,
                          !repeater.enabled,
                        ),
                      )
                    }
                  />
                  <IconButton
                    icon={Trash2}
                    label={editorMessage("editor.motion.properties.modifier.repeater.remove")}
                    size="sm"
                    variant="danger"
                    onClick={() =>
                      replaceLayer(removeMotionShapeModifier(layer, repeater.id))
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2.5 p-3">
                {renderModifierNumberInput({ modifierId: repeater.id, property: "copies", label: editorMessage("editor.motion.properties.copies"), min: 1, max: 256 })}
                {renderModifierNumberInput({ modifierId: repeater.id, property: "offset", label: editorMessage("editor.motion.properties.offset"), step: 0.1 })}
                {renderModifierNumberInput({ modifierId: repeater.id, property: "position.x", label: editorMessage("editor.motion.properties.positionX"), hint: "px" })}
                {renderModifierNumberInput({ modifierId: repeater.id, property: "position.y", label: editorMessage("editor.motion.properties.positionY"), hint: "px" })}
                {renderModifierNumberInput({ modifierId: repeater.id, property: "scale.x", label: editorMessage("editor.motion.properties.scaleX"), min: 0.001, step: 0.05 })}
                {renderModifierNumberInput({ modifierId: repeater.id, property: "scale.y", label: editorMessage("editor.motion.properties.scaleY"), min: 0.001, step: 0.05 })}
                {renderModifierNumberInput({ modifierId: repeater.id, property: "rotation", label: editorMessage("editor.motion.properties.rotation"), hint: "deg" })}
                {renderModifierNumberInput({ modifierId: repeater.id, property: "opacity", label: editorMessage("editor.motion.properties.opacity"), min: 0, max: 1, step: 0.05 })}
              </div>
            </div>
          ) : null}

          {zigZag ? (
            <div className={`rounded-xl border border-border bg-bg-1 shadow-sm ${zigZag.enabled ? "" : "opacity-55"}`}>
              <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-bg-2 text-fg-3">
                  <Zap size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span data-shotloom-user-content="" className="block truncate text-[12.5px] font-semibold text-fg-2">
                    {zigZag.name}
                  </span>
                  <span className="block text-[10.5px] text-fg-muted">
                    {editorMessage("editor.motion.properties.ridgesSummary", { count: zigZag.ridgesPerSegment })}
                  </span>
                </span>
                <div className="flex items-center gap-0.5">
                  <IconButton
                    icon={zigZag.enabled ? Eye : EyeOff}
                    label={zigZag.enabled ? editorMessage("editor.motion.properties.modifier.zig-zag.disable") : editorMessage("editor.motion.properties.modifier.zig-zag.enable")}
                    size="sm"
                    active={zigZag.enabled}
                    onClick={() =>
                      replaceLayer(
                        toggleMotionShapeModifier(
                          layer,
                          zigZag.id,
                          !zigZag.enabled,
                        ),
                      )
                    }
                  />
                  <IconButton
                    icon={Trash2}
                    label={editorMessage("editor.motion.properties.modifier.zig-zag.remove")}
                    size="sm"
                    variant="danger"
                    onClick={() =>
                      replaceLayer(removeMotionShapeModifier(layer, zigZag.id))
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2.5 p-3">
                {renderModifierNumberInput({ modifierId: zigZag.id, property: "size", label: editorMessage("editor.motion.properties.size"), hint: "px", min: -4000, max: 4000, step: 1 })}
                {renderModifierNumberInput({ modifierId: zigZag.id, property: "ridgesPerSegment", label: editorMessage("editor.motion.properties.ridges"), min: 0, max: 128, step: 1 })}
              </div>
            </div>
          ) : null}

          {roundCorners ? (
            <div className={`rounded-xl border border-border bg-bg-1 shadow-sm ${roundCorners.enabled ? "" : "opacity-55"}`}>
              <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-bg-2 text-fg-3">
                  <Ruler size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span data-shotloom-user-content="" className="block truncate text-[12.5px] font-semibold text-fg-2">
                    {roundCorners.name}
                  </span>
                  <span className="block text-[10.5px] text-fg-muted">
                    {editorMessage("editor.motion.properties.roundSummary", { radius: roundCorners.radius, count: roundCorners.segments })}
                  </span>
                </span>
                <div className="flex items-center gap-0.5">
                  <IconButton
                    icon={roundCorners.enabled ? Eye : EyeOff}
                    label={
                      roundCorners.enabled
                        ? editorMessage("editor.motion.properties.modifier.round-corners.disable")
                        : editorMessage("editor.motion.properties.modifier.round-corners.enable")
                    }
                    size="sm"
                    active={roundCorners.enabled}
                    onClick={() =>
                      replaceLayer(
                        toggleMotionShapeModifier(
                          layer,
                          roundCorners.id,
                          !roundCorners.enabled,
                        ),
                      )
                    }
                  />
                  <IconButton
                    icon={Trash2}
                    label={editorMessage("editor.motion.properties.modifier.round-corners.remove")}
                    size="sm"
                    variant="danger"
                    onClick={() =>
                      replaceLayer(
                        removeMotionShapeModifier(layer, roundCorners.id),
                      )
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2.5 p-3">
                {renderModifierNumberInput({ modifierId: roundCorners.id, property: "radius", label: editorMessage("editor.motion.properties.radius"), hint: "px", min: 0, max: 4000, step: 1 })}
                {renderModifierNumberInput({ modifierId: roundCorners.id, property: "segments", label: editorMessage("editor.motion.properties.samples"), min: 1, max: 48, step: 1 })}
              </div>
            </div>
          ) : null}

          {wigglePaths ? (
            <div className={`rounded-xl border border-border bg-bg-1 shadow-sm ${wigglePaths.enabled ? "" : "opacity-55"}`}>
              <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-bg-2 text-fg-3">
                  <Sparkles size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span data-shotloom-user-content="" className="block truncate text-[12.5px] font-semibold text-fg-2">
                    {wigglePaths.name}
                  </span>
                  <span className="block text-[10.5px] text-fg-muted">
                    {editorMessage("editor.motion.properties.wiggleSummary", { size: wigglePaths.size, speed: wigglePaths.speed })}
                  </span>
                </span>
                <div className="flex items-center gap-0.5">
                  <IconButton
                    icon={wigglePaths.enabled ? Eye : EyeOff}
                    label={
                      wigglePaths.enabled
                        ? editorMessage("editor.motion.properties.modifier.wiggle-paths.disable")
                        : editorMessage("editor.motion.properties.modifier.wiggle-paths.enable")
                    }
                    size="sm"
                    active={wigglePaths.enabled}
                    onClick={() =>
                      replaceLayer(
                        toggleMotionShapeModifier(
                          layer,
                          wigglePaths.id,
                          !wigglePaths.enabled,
                        ),
                      )
                    }
                  />
                  <IconButton
                    icon={Trash2}
                    label={editorMessage("editor.motion.properties.modifier.wiggle-paths.remove")}
                    size="sm"
                    variant="danger"
                    onClick={() =>
                      replaceLayer(
                        removeMotionShapeModifier(layer, wigglePaths.id),
                      )
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2.5 p-3">
                {renderModifierNumberInput({ modifierId: wigglePaths.id, property: "size", label: editorMessage("editor.motion.properties.size"), hint: "px", min: 0, max: 4000, step: 1 })}
                {renderModifierNumberInput({ modifierId: wigglePaths.id, property: "detail", label: editorMessage("editor.motion.properties.detail"), min: 0, max: 32, step: 1 })}
                {renderModifierNumberInput({ modifierId: wigglePaths.id, property: "speed", label: editorMessage("editor.motion.properties.speed"), min: 0, max: 60, step: 0.1 })}
                {renderModifierNumberInput({ modifierId: wigglePaths.id, property: "seed", label: editorMessage("editor.motion.properties.seed"), step: 1 })}
              </div>
            </div>
          ) : null}

          {offsetPaths ? (
            <div className={`rounded-xl border border-border bg-bg-1 shadow-sm ${offsetPaths.enabled ? "" : "opacity-55"}`}>
              <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-bg-2 text-fg-3">
                  <Spline size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span data-shotloom-user-content="" className="block truncate text-[12.5px] font-semibold text-fg-2">
                    {offsetPaths.name}
                  </span>
                  <span className="block text-[10.5px] text-fg-muted">
                    {editorMessage("editor.motion.properties.offsetSummary", { amount: offsetPaths.amount, join: editorMessage(JOIN_LABEL_KEYS[offsetPaths.lineJoin]) })}
                  </span>
                </span>
                <div className="flex items-center gap-0.5">
                  <IconButton
                    icon={offsetPaths.enabled ? Eye : EyeOff}
                    label={
                      offsetPaths.enabled
                        ? editorMessage("editor.motion.properties.modifier.offset-paths.disable")
                        : editorMessage("editor.motion.properties.modifier.offset-paths.enable")
                    }
                    size="sm"
                    active={offsetPaths.enabled}
                    onClick={() =>
                      replaceLayer(
                        toggleMotionShapeModifier(
                          layer,
                          offsetPaths.id,
                          !offsetPaths.enabled,
                        ),
                      )
                    }
                  />
                  <IconButton
                    icon={Trash2}
                    label={editorMessage("editor.motion.properties.modifier.offset-paths.remove")}
                    size="sm"
                    variant="danger"
                    onClick={() =>
                      replaceLayer(
                        removeMotionShapeModifier(layer, offsetPaths.id),
                      )
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2.5 p-3">
                {renderModifierNumberInput({ modifierId: offsetPaths.id, property: "amount", label: editorMessage("editor.motion.properties.amount"), hint: "px", min: -4000, max: 4000, step: 1 })}
              </div>
            </div>
          ) : null}

          {puckerBloat ? (
            <div className={`rounded-xl border border-border bg-bg-1 shadow-sm ${puckerBloat.enabled ? "" : "opacity-55"}`}>
              <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-bg-2 text-fg-3">
                  <Shrink size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span data-shotloom-user-content="" className="block truncate text-[12.5px] font-semibold text-fg-2">
                    {puckerBloat.name}
                  </span>
                  <span className="block text-[10.5px] text-fg-muted">
                    {editorMessage("editor.motion.properties.distortionSummary", { amount: puckerBloat.amount })}
                  </span>
                </span>
                <div className="flex items-center gap-0.5">
                  <IconButton
                    icon={puckerBloat.enabled ? Eye : EyeOff}
                    label={
                      puckerBloat.enabled
                        ? editorMessage("editor.motion.properties.modifier.pucker-bloat.disable")
                        : editorMessage("editor.motion.properties.modifier.pucker-bloat.enable")
                    }
                    size="sm"
                    active={puckerBloat.enabled}
                    onClick={() =>
                      replaceLayer(
                        toggleMotionShapeModifier(
                          layer,
                          puckerBloat.id,
                          !puckerBloat.enabled,
                        ),
                      )
                    }
                  />
                  <IconButton
                    icon={Trash2}
                    label={editorMessage("editor.motion.properties.modifier.pucker-bloat.remove")}
                    size="sm"
                    variant="danger"
                    onClick={() =>
                      replaceLayer(
                        removeMotionShapeModifier(layer, puckerBloat.id),
                      )
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2.5 p-3">
                {renderModifierNumberInput({ modifierId: puckerBloat.id, property: "amount", label: editorMessage("editor.motion.properties.amount"), hint: "%", min: -100, max: 100, step: 1 })}
              </div>
            </div>
          ) : null}

          {twist ? (
            <div className={`rounded-xl border border-border bg-bg-1 shadow-sm ${twist.enabled ? "" : "opacity-55"}`}>
              <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-bg-2 text-fg-3">
                  <Tornado size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span data-shotloom-user-content="" className="block truncate text-[12.5px] font-semibold text-fg-2">
                    {twist.name}
                  </span>
                  <span className="block text-[10.5px] text-fg-muted">
                    {editorMessage("editor.motion.properties.twistSummary", { angle: twist.angle })}
                  </span>
                </span>
                <div className="flex items-center gap-0.5">
                  <IconButton
                    icon={twist.enabled ? Eye : EyeOff}
                    label={twist.enabled ? editorMessage("editor.motion.properties.modifier.twist.disable") : editorMessage("editor.motion.properties.modifier.twist.enable")}
                    size="sm"
                    active={twist.enabled}
                    onClick={() =>
                      replaceLayer(
                        toggleMotionShapeModifier(layer, twist.id, !twist.enabled),
                      )
                    }
                  />
                  <IconButton
                    icon={Trash2}
                    label={editorMessage("editor.motion.properties.modifier.twist.remove")}
                    size="sm"
                    variant="danger"
                    onClick={() =>
                      replaceLayer(removeMotionShapeModifier(layer, twist.id))
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2.5 p-3">
                {renderModifierNumberInput({ modifierId: twist.id, property: "angle", label: editorMessage("editor.motion.properties.angle"), hint: "deg", min: -3600, max: 3600, step: 1 })}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </Section>
  );
}
