import { editorMessage } from "../../../shotloom-mode";
import React, { useCallback, useMemo } from "react";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftSelectControl as Selector } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { PropertySlider } from "./shell/PropertySlider";
import { useProjectStore } from "../../../stores/project-store";

interface Transform3DSectionProps {
  clipId: string;
}

export const Transform3DSection: React.FC<Transform3DSectionProps> = ({
  clipId,
}) => {
  const {
    getClip,
    getTextClip,
    getShapeClip,
    getSVGClip,
    getStickerClip,
    updateClipRotate3D,
    updateClipPerspective,
    updateClipTransformStyle,
    project,
  } = useProjectStore();

  const clip = useMemo(() => {
    const regularClip = getClip(clipId);
    if (regularClip) return regularClip;
    const textClip = getTextClip(clipId);
    if (textClip) return textClip;
    const shapeClip = getShapeClip(clipId);
    if (shapeClip) return shapeClip;
    const svgClip = getSVGClip(clipId);
    if (svgClip) return svgClip;
    const stickerClip = getStickerClip(clipId);
    if (stickerClip) return stickerClip;
    return null;
  }, [
    clipId,
    getClip,
    getTextClip,
    getShapeClip,
    getSVGClip,
    getStickerClip,
    project.modifiedAt,
  ]);

  const rotate3d = clip?.transform.rotate3d ?? { x: 0, y: 0, z: 0 };
  const perspective = clip?.transform.perspective ?? 1000;
  const transformStyle = clip?.transform.transformStyle ?? "flat";

  const handleRotateXChange = useCallback(
    (x: number) => {
      updateClipRotate3D(clipId, { ...rotate3d, x });
    },
    [clipId, rotate3d, updateClipRotate3D],
  );

  const handleRotateYChange = useCallback(
    (y: number) => {
      updateClipRotate3D(clipId, { ...rotate3d, y });
    },
    [clipId, rotate3d, updateClipRotate3D],
  );

  const handleRotateZChange = useCallback(
    (z: number) => {
      updateClipRotate3D(clipId, { ...rotate3d, z });
    },
    [clipId, rotate3d, updateClipRotate3D],
  );

  const handlePerspectiveChange = useCallback(
    (value: number) => {
      updateClipPerspective(clipId, value);
    },
    [clipId, updateClipPerspective],
  );

  const handleTransformStyleChange = useCallback(
    (style: "flat" | "preserve-3d") => {
      updateClipTransformStyle(clipId, style);
    },
    [clipId, updateClipTransformStyle],
  );

  if (!clip) {
    return (
      <Text type="supporting" color="secondary" className="py-8 text-center text-xs">{editorMessage("editor.transform3d.empty")}</Text>
    );
  }

  return (
    <div className="space-y-3">
      <PropertySlider
        label={editorMessage("editor.transform3d.x")}
        value={rotate3d.x}
        onChange={handleRotateXChange}
        min={-360}
        max={360}
        step={1}
        formatValue={(value) => `${Math.round(value)}°`}
      />

      <PropertySlider
        label={editorMessage("editor.transform3d.y")}
        value={rotate3d.y}
        onChange={handleRotateYChange}
        min={-360}
        max={360}
        step={1}
        formatValue={(value) => `${Math.round(value)}°`}
      />

      <PropertySlider
        label={editorMessage("editor.transform3d.z")}
        value={rotate3d.z}
        onChange={handleRotateZChange}
        min={-360}
        max={360}
        step={1}
        formatValue={(value) => `${Math.round(value)}°`}
      />

      <PropertySlider
        label={editorMessage("editor.transform3d.perspective")}
        value={perspective}
        onChange={handlePerspectiveChange}
        min={100}
        max={2000}
        step={10}
        formatValue={(value) => `${Math.round(value)}px`}
      />

      <div className="space-y-1">
        <Selector
          label={editorMessage("editor.transform3d.style")}
          size="sm"
          width="100%"
          value={transformStyle}
          options={[
            { label: editorMessage("editor.transform3d.flat"), value: "flat" },
            { label: editorMessage("editor.transform3d.preserve"), value: "preserve-3d" },
          ]}
          onChange={(value) =>
            handleTransformStyleChange(value as "flat" | "preserve-3d")
          }
        />
        <Text type="supporting" color="secondary" className="text-[9px]">
          {transformStyle === "flat" &&
            editorMessage("editor.transform3d.flatHelp")}
          {transformStyle === "preserve-3d" && editorMessage("editor.transform3d.preserveHelp")}
        </Text>
      </div>

      {(rotate3d.x !== 0 || rotate3d.y !== 0 || rotate3d.z !== 0) && (
        <Card variant="muted" padding={2} className="border border-primary/20 bg-primary/5">
          <Text type="supporting" color="secondary" className="text-[9px]">{editorMessage("editor.transform3d.tip")}</Text>
        </Card>
      )}
    </div>
  );
};
