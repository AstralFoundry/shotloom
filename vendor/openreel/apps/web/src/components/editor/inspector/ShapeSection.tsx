import { editorMessage } from "../../../shotloom-mode";
import React, { useCallback, useMemo } from "react";
import { ToolcraftSegmentedControl } from "@openreel/ui";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftNumberInputControl } from "@openreel/ui";
import { ToolcraftSelectControl as Selector } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import {
  Square,
  Circle,
  Triangle,
  Star,
  Hexagon,
  ArrowRight,
} from "@/icons/lucide-compat";
import { PropertySlider } from "./shell/PropertySlider";
import { useProjectStore } from "../../../stores/project-store";
import type {
  MotionShaderFill,
  MotionShaderParamValue,
  ShapeStyle,
  FillStyle,
  StrokeStyle,
} from "@openreel/core";
import {
  getMotionShaderDef,
  getMotionShaderFillDefs,
} from "@openreel/core";
import {
  createDefaultEditorShader,
  groupShaderDefsByCollection,
  ShaderParamFields,
} from "./ShaderControls";
import { ColorSelector } from "../../../motion/components/primitives";

const ColorField: React.FC<{
  label: string;
  value: string;
  onChange: (color: string) => void;
  showAlpha?: boolean;
}> = ({ label, value, onChange, showAlpha = false }) => (
  <div className="flex items-center justify-between gap-2">
    <Text type="supporting" color="secondary">
      {label}
    </Text>
    <div className="flex max-w-[190px] items-center">
      <ColorSelector
        value={value}
        onChange={onChange}
        label={editorMessage("editor.shapeControls.selectColor", { label })}
        showAlpha={showAlpha}
      />
    </div>
  </div>
);

const NumberInput: React.FC<{
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}> = ({ label, value, onChange, min = 0, max = 1000, step = 1, unit = "" }) => (
  <ToolcraftNumberInputControl
    label={label}
    size="sm"
    width="100%"
    value={Number.isFinite(value) ? value : 0}
    onChange={onChange}
    min={min}
    max={max}
    step={step}
    units={unit || null}
  />
);

const SliderField: React.FC<{
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}> = ({ label, value, onChange, min = 0, max = 100, step = 1, unit = "" }) => (
  <PropertySlider
    label={label}
    min={min}
    max={max}
    step={step}
    value={value}
    onChange={onChange}
    formatValue={(nextValue) => `${nextValue}${unit}`}
  />
);

const StrokeStyleSelector: React.FC<{
  value: number[] | undefined;
  onChange: (dashArray: number[] | undefined) => void;
}> = ({ value, onChange }) => {
  const styles = [
    { value: undefined, label: editorMessage("editor.shapeControls.dashSolid"), preview: "────" },
    { value: [5, 5], label: editorMessage("editor.shapeControls.dashed"), preview: "- - -" },
    { value: [2, 2], label: editorMessage("editor.shapeControls.dotted"), preview: "• • •" },
  ];

  return (
    <div className="flex items-center justify-between">
      <Text type="supporting" color="secondary">
        {editorMessage("editor.shapeControls.style")}
      </Text>
      <div className="flex gap-1">
        {styles.map((style, index) => (
          <Button
            key={index}
            label={style.label}
            size="sm"
            variant={
              (style.value === undefined && value === undefined) ||
              (style.value && value && style.value[0] === value[0])
                ? "primary"
                : "secondary"
            }
            onClick={() => onChange(style.value)}
          >{style.preview}</Button>
        ))}
      </div>
    </div>
  );
};

const SHAPE_LABELS = {
  line: "editor.timeline.graphics.shape.line",
  path: "editor.timeline.graphics.shape.path",
  "mesh-cube": "editor.timeline.graphics.shape.mesh-cube",
  "mesh-sphere": "editor.timeline.graphics.shape.mesh-sphere",
  "mesh-torus": "editor.timeline.graphics.shape.mesh-torus",
  "mesh-cone": "editor.timeline.graphics.shape.mesh-cone",
  "mesh-cylinder": "editor.timeline.graphics.shape.mesh-cylinder",
  "mesh-icosahedron": "editor.timeline.graphics.shape.mesh-icosahedron",
  rectangle: "editor.timeline.graphics.shape.rectangle",
  circle: "editor.timeline.graphics.shape.circle",
  ellipse: "editor.timeline.graphics.shape.ellipse",
  triangle: "editor.timeline.graphics.shape.triangle",
  star: "editor.timeline.graphics.shape.star",
  polygon: "editor.timeline.graphics.shape.polygon",
  arrow: "editor.timeline.graphics.shape.arrow",
} as const;
function shapeTypeLabel(type: string): string {
  return Object.hasOwn(SHAPE_LABELS, type)
    ? editorMessage(SHAPE_LABELS[type as keyof typeof SHAPE_LABELS]) : type;
}

const ShapeTypeDisplay: React.FC<{
  shapeType: string;
}> = ({ shapeType }) => {
  const shapeIcons: Record<string, React.ReactNode> = {
    rectangle: <Square size={16} />,
    circle: <Circle size={16} />,
    ellipse: <Circle size={16} />,
    triangle: <Triangle size={16} />,
    star: <Star size={16} />,
    polygon: <Hexagon size={16} />,
    arrow: <ArrowRight size={16} />,
  };

  return (
    <div className="flex items-center gap-2 p-2 bg-bg-2 rounded-lg">
      <div className="p-1.5 bg-bg-1 rounded">
        {shapeIcons[shapeType] || <Square size={16} />}
      </div>
      <div className="flex flex-col gap-0.5">
        <Text type="supporting" color="primary" weight="medium" className="capitalize">
          {shapeTypeLabel(shapeType)}
        </Text>
        <Text type="supporting" color="secondary" className="text-[9px]">
          {editorMessage("editor.shapeControls.shapeClip")}
        </Text>
      </div>
    </div>
  );
};

function firstShapeShaderFillId(): string {
  return getMotionShaderFillDefs()[0]?.id ?? "liquid-metal";
}

interface ShapeSectionProps {
  clipId: string;
}

export const ShapeSection: React.FC<ShapeSectionProps> = ({ clipId }) => {
  const { getShapeClip, updateShapeStyle, project } = useProjectStore();

  const shapeClip = useMemo(
    () => getShapeClip(clipId),
    [clipId, getShapeClip, project.modifiedAt],
  );

  const defaultFill: FillStyle = {
    type: "solid",
    color: "#3b82f6",
    opacity: 1,
  };

  const defaultStroke: StrokeStyle = {
    color: "#1d4ed8",
    width: 2,
    opacity: 1,
  };

  const defaultStyle: ShapeStyle = {
    fill: defaultFill,
    stroke: defaultStroke,
  };

  const style = shapeClip?.style || defaultStyle;
  const shapeType = shapeClip?.shapeType || "rectangle";

  const handleStyleChange = useCallback(
    (changes: Partial<ShapeStyle>) => {
      updateShapeStyle(clipId, changes);
    },
    [clipId, updateShapeStyle],
  );

  if (!shapeClip) {
    return (
      <div className="p-4 text-center">
        <Square size={24} className="mx-auto mb-2 text-fg-3" />
        <Text type="supporting" color="secondary">
          {editorMessage("editor.shapeControls.empty")}
        </Text>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ShapeTypeDisplay shapeType={shapeType} />

      <Card variant="muted" padding={3}>
        <div className="space-y-2">
          <Text type="supporting" color="primary" weight="medium">
            {editorMessage("editor.shapeControls.fill")}
          </Text>
          <ToolcraftSegmentedControl<"solid" | "shader">
            ariaLabel={editorMessage("editor.shapeControls.fillType")}
            value={style.fill?.type === "shader" ? "shader" : "solid"}
            onChange={(fillType) => {
              if (fillType === "shader") {
                const shader = createDefaultEditorShader(
                  style.fill?.shader?.shaderId ?? firstShapeShaderFillId(),
                );
                if (!shader) return;
                handleStyleChange({
                  fill: {
                    ...style.fill,
                    type: "shader",
                    opacity: style.fill?.opacity ?? 1,
                    shader,
                  },
                });
                return;
              }
              handleStyleChange({
                fill: {
                  ...style.fill,
                  type: "solid",
                  color: style.fill?.color || "#14b8a6",
                  opacity: style.fill?.opacity ?? 1,
                },
              });
            }}
            options={[
              { value: "solid", label: editorMessage("editor.shapeControls.solid") },
              { value: "shader", label: editorMessage("editor.shapeControls.shader") },
            ]}
          />
          {style.fill?.type === "shader" && style.fill.shader ? (
            <ShapeShaderFillControls
              shader={style.fill.shader}
              onChange={(shader) =>
                handleStyleChange({
                  fill: {
                    ...style.fill,
                    type: "shader",
                    opacity: style.fill?.opacity ?? 1,
                    shader,
                  },
                })
              }
            />
          ) : (
            <ColorField
              label={editorMessage("editor.shapeControls.color")}
              value={style.fill?.color || "#3b82f6"}
              onChange={(color) =>
                handleStyleChange({
                  fill: {
                    ...style.fill,
                    color,
                    type: "solid",
                    opacity: style.fill?.opacity ?? 1,
                  },
                })
              }
            />
          )}
          <SliderField
            label={editorMessage("editor.shapeControls.opacity")}
            value={(style.fill?.opacity ?? 1) * 100}
            onChange={(opacity) =>
              handleStyleChange({
                fill: {
                  ...style.fill,
                  opacity: opacity / 100,
                  type: style.fill?.type || "solid",
                },
              })
            }
            min={0}
            max={100}
            unit="%"
          />
        </div>
      </Card>

      <Card variant="muted" padding={3}>
        <div className="space-y-2">
          <Text type="supporting" color="primary" weight="medium">
            {editorMessage("editor.shapeControls.stroke")}
          </Text>
          <ColorField
            label={editorMessage("editor.shapeControls.color")}
            value={style.stroke?.color || "#1d4ed8"}
            onChange={(color) =>
              handleStyleChange({
                stroke: {
                  ...style.stroke,
                  color,
                  width: style.stroke?.width ?? 2,
                  opacity: style.stroke?.opacity ?? 1,
                },
              })
            }
          />
          <NumberInput
            label={editorMessage("editor.shapeControls.width")}
            value={style.stroke?.width ?? 0}
            onChange={(width) =>
              handleStyleChange({
                stroke: {
                  ...style.stroke,
                  width,
                  color: style.stroke?.color || "#1d4ed8",
                  opacity: style.stroke?.opacity ?? 1,
                },
              })
            }
            min={0}
            max={50}
            unit="px"
          />
          <StrokeStyleSelector
            value={style.stroke?.dashArray}
            onChange={(dashArray) =>
              handleStyleChange({
                stroke: {
                  ...style.stroke,
                  dashArray,
                  color: style.stroke?.color || "#1d4ed8",
                  width: style.stroke?.width ?? 2,
                  opacity: style.stroke?.opacity ?? 1,
                },
              })
            }
          />
        </div>
      </Card>

      {shapeType === "rectangle" && (
        <Card variant="muted" padding={3}>
          <div className="space-y-2">
            <Text type="supporting" color="primary" weight="medium">
              {editorMessage("editor.shapeControls.corners")}
            </Text>
            <SliderField
              label={editorMessage("editor.shapeControls.radius")}
              value={style.cornerRadius || 0}
              onChange={(cornerRadius) => handleStyleChange({ cornerRadius })}
              min={0}
              max={100}
              unit="px"
            />
          </div>
        </Card>
      )}

      <Card variant="muted" padding={3}>
        <div className="space-y-2">
          <Text type="supporting" color="primary" weight="medium">
            {editorMessage("editor.shapeControls.shadow")}
          </Text>
          <ColorField
            label={editorMessage("editor.shapeControls.color")}
            value={style.shadow?.color || "#000000"}
            onChange={(color) =>
              handleStyleChange({
                shadow: {
                  color,
                  offsetX: style.shadow?.offsetX || 0,
                  offsetY: style.shadow?.offsetY || 0,
                  blur: style.shadow?.blur || 0,
                },
              })
            }
            showAlpha
          />
          <NumberInput
            label={editorMessage("editor.shapeControls.offsetX")}
            value={style.shadow?.offsetX || 0}
            onChange={(offsetX) =>
              handleStyleChange({
                shadow: {
                  offsetX,
                  color: style.shadow?.color || "#000000",
                  offsetY: style.shadow?.offsetY || 0,
                  blur: style.shadow?.blur || 0,
                },
              })
            }
            min={-50}
            max={50}
            unit="px"
          />
          <NumberInput
            label={editorMessage("editor.shapeControls.offsetY")}
            value={style.shadow?.offsetY || 0}
            onChange={(offsetY) =>
              handleStyleChange({
                shadow: {
                  offsetY,
                  color: style.shadow?.color || "#000000",
                  offsetX: style.shadow?.offsetX || 0,
                  blur: style.shadow?.blur || 0,
                },
              })
            }
            min={-50}
            max={50}
            unit="px"
          />
          <SliderField
            label={editorMessage("editor.shapeControls.blur")}
            value={style.shadow?.blur || 0}
            onChange={(blur) =>
              handleStyleChange({
                shadow: {
                  blur,
                  color: style.shadow?.color || "#000000",
                  offsetX: style.shadow?.offsetX || 0,
                  offsetY: style.shadow?.offsetY || 0,
                },
              })
            }
            min={0}
            max={50}
            unit="px"
          />
        </div>
      </Card>
    </div>
  );
};

const ShapeShaderFillControls: React.FC<{
  shader: MotionShaderFill;
  onChange: (shader: MotionShaderFill) => void;
}> = ({ shader, onChange }) => {
  const shaderOptions = useMemo(
    () => groupShaderDefsByCollection(getMotionShaderFillDefs()),
    [],
  );
  const def = getMotionShaderDef(shader.shaderId);

  const handleShaderSelect = useCallback(
    (shaderId: string) => {
      const next = createDefaultEditorShader(shaderId);
      if (!next) return;
      const nextDef = getMotionShaderDef(shaderId);
      if (!nextDef || nextDef.category !== "fill") return;
      onChange(next);
    },
    [onChange],
  );

  const updateParam = useCallback(
    (name: string, value: MotionShaderParamValue) => {
      onChange({
        ...shader,
        params: {
          ...shader.params,
          [name]: value,
        },
      });
    },
    [onChange, shader],
  );

  return (
    <div className="space-y-2 rounded border border-border/70 bg-bg-2 p-2">
      <Selector
        label={editorMessage("editor.shapeControls.shaderFill")}
        isLabelHidden
        size="sm"
        width="100%"
        value={shader.shaderId}
        options={shaderOptions as any}
        onChange={handleShaderSelect}
      />
      {def ? (
        <ShaderParamFields
          def={def}
          params={shader.params}
          onChange={updateParam}
        />
      ) : null}
    </div>
  );
};

export default ShapeSection;
