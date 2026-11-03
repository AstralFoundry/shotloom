import { editorMessage, editorItemCount } from "../../../shotloom-mode";
import React, { useCallback, useMemo, useState } from "react";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftClickableCard as ClickableCard } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { MockToggle } from "./shell/InspectorControls";
import { Route, Trash2, Plus, Eye, EyeOff } from "@/icons/lucide-compat";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { useEngineStore } from "../../../stores/engine-store";
import {
  getGSAPEngine,
  generateDefaultControlPoints,
  type GSAPMotionPathPoint,
} from "@openreel/core";

const pathTypeKeys = { "linear": "editor.motionPath.type.linear", "bezier": "editor.motionPath.type.bezier", "catmull-rom": "editor.motionPath.type.catmull-rom" } as const;

interface MotionPathSectionProps {
  clipId: string;
}

export const MotionPathSection: React.FC<MotionPathSectionProps> = ({
  clipId,
}) => {
  const { getClip, project } = useProjectStore();
  const { motionPathMode, motionPathClipId, setMotionPathMode } = useUIStore();
  const getGraphicsEngine = useEngineStore((state) => state.getGraphicsEngine);
  const getTitleEngine = useEngineStore((state) => state.getTitleEngine);
  const [forceUpdate, setForceUpdate] = useState(0);

  const clip = useMemo(() => {
    const timelineClip = getClip(clipId);
    if (timelineClip) return timelineClip;

    const graphicsEngine = getGraphicsEngine();
    const svgClip = graphicsEngine?.getSVGClip(clipId);
    if (svgClip) return svgClip;

    const shapeClip = graphicsEngine?.getShapeClip(clipId);
    if (shapeClip) return shapeClip;

    const stickerClip = graphicsEngine?.getStickerClip(clipId);
    if (stickerClip) return stickerClip;

    const titleEngine = getTitleEngine();
    const textClip = titleEngine?.getTextClip(clipId);
    if (textClip) return textClip;

    return undefined;
  }, [clipId, getClip, getGraphicsEngine, getTitleEngine, project.modifiedAt]);

  const gsapEngine = useMemo(() => getGSAPEngine(), []);

  const motionPath = useMemo(() => {
    return gsapEngine.getMotionPath(clipId);
  }, [clipId, gsapEngine, forceUpdate]);

  const isEditing = motionPathMode && motionPathClipId === clipId;

  const handleEnableToggle = useCallback(
    (enabled: boolean) => {
      if (enabled) {
        const existingPath = gsapEngine.getMotionPath(clipId);
        if (!existingPath) {
          const defaultPoints: GSAPMotionPathPoint[] = [
            { x: 0, y: 0, time: 0 },
            { x: 100, y: 0, time: 1 },
          ];
          gsapEngine.setMotionPath(clipId, {
            enabled: true,
            pathType: "bezier",
            points: generateDefaultControlPoints(defaultPoints),
            showPath: true,
            autoOrient: false,
            alignOrigin: [0.5, 0.5],
          });
        } else {
          gsapEngine.setMotionPath(clipId, { ...existingPath, enabled: true });
        }
      } else {
        const existingPath = gsapEngine.getMotionPath(clipId);
        if (existingPath) {
          gsapEngine.setMotionPath(clipId, { ...existingPath, enabled: false });
        }
      }
      setForceUpdate((v) => v + 1);
    },
    [clipId, gsapEngine]
  );

  const handleShowPathToggle = useCallback(
    (show: boolean) => {
      const path = gsapEngine.getMotionPath(clipId);
      if (path) {
        gsapEngine.setMotionPath(clipId, { ...path, showPath: show });
        setForceUpdate((v) => v + 1);
      }
    },
    [clipId, gsapEngine]
  );

  const handleAutoOrientToggle = useCallback(
    (autoOrient: boolean) => {
      const path = gsapEngine.getMotionPath(clipId);
      if (path) {
        gsapEngine.setMotionPath(clipId, { ...path, autoOrient });
        setForceUpdate((v) => v + 1);
      }
    },
    [clipId, gsapEngine]
  );

  const handlePathTypeChange = useCallback(
    (pathType: "linear" | "bezier" | "catmull-rom") => {
      const path = gsapEngine.getMotionPath(clipId);
      if (path) {
        gsapEngine.setMotionPath(clipId, { ...path, pathType });
        setForceUpdate((v) => v + 1);
      }
    },
    [clipId, gsapEngine]
  );

  const handleEditMode = useCallback(() => {
    if (isEditing) {
      setMotionPathMode(false);
    } else {
      setMotionPathMode(true, clipId);
    }
  }, [isEditing, clipId, setMotionPathMode]);

  const handleAddPoint = useCallback(() => {
    const path = gsapEngine.getMotionPath(clipId);
    if (!path) return;

    const lastPoint = path.points[path.points.length - 1];
    const newPoint: GSAPMotionPathPoint = {
      x: lastPoint.x + 50,
      y: lastPoint.y,
      time: Math.min(1, lastPoint.time + 0.2),
    };

    gsapEngine.addGSAPMotionPathPoint(clipId, newPoint);
    setForceUpdate((v) => v + 1);
  }, [clipId, gsapEngine]);

  const handleClearPath = useCallback(() => {
    gsapEngine.removeMotionPath(clipId);
    setMotionPathMode(false);
    setForceUpdate((v) => v + 1);
  }, [clipId, gsapEngine, setMotionPathMode]);

  if (!clip) {
    return (
      <Text type="supporting" color="secondary" className="py-8 text-center text-xs">
        {editorMessage("editor.motionPath.empty")}
      </Text>
    );
  }

  const isEnabled = motionPath?.enabled ?? false;
  const showPath = motionPath?.showPath ?? true;
  const autoOrient = motionPath?.autoOrient ?? false;
  const pathType = motionPath?.pathType ?? "bezier";
  const pointCount = motionPath?.points.length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Route size={14} className="text-primary" />
          <Text type="supporting" color="primary" className="text-xs font-medium">
            {editorMessage("editor.motionPath.title")}
          </Text>
        </div>
        <MockToggle
          ariaLabel={editorMessage("editor.motionPath.enable")}
          checked={isEnabled}
          onChange={handleEnableToggle}
        />
      </div>

      {isEnabled && (
        <>
          <Card variant="muted" padding={3} className="space-y-3">
            <div className="flex items-center justify-between">
              <Text type="supporting" color="secondary" className="text-[10px]">
                {editorMessage("editor.motionPath.show")}
              </Text>
              <div className="flex items-center gap-2">
                <IconButton
                  label={showPath ? editorMessage("editor.motionPath.hideAction") : editorMessage("editor.motionPath.showAction")}
                  icon={showPath ? <Eye size={12} /> : <EyeOff size={12} />}
                  variant={showPath ? "primary" : "secondary"}
                  size="sm"
                  onClick={() => handleShowPathToggle(!showPath)}
                  className={`p-1.5 rounded transition-colors ${
                    showPath
                      ? "bg-primary/20 text-primary"
                      : "bg-bg-elev text-fg-3"
                  }`}
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <Text type="supporting" color="secondary" className="text-[10px]">
                {editorMessage("editor.motionPath.orient")}
              </Text>
              <MockToggle
                ariaLabel={editorMessage("editor.motionPath.orient")}
                checked={autoOrient}
                onChange={handleAutoOrientToggle}
              />
            </div>

            <div className="space-y-1">
              <Text type="supporting" color="secondary" className="text-[10px]">
                {editorMessage("editor.motionPath.type")}
              </Text>
              <div className="grid grid-cols-3 gap-1">
                {(["linear", "bezier", "catmull-rom"] as const).map((type) => (
                  <ClickableCard
                    key={type}
                    label={editorMessage("editor.motionPath.selectType", { type: editorMessage(pathTypeKeys[type]) })}
                    onClick={() => handlePathTypeChange(type)}
                    className={`py-1.5 rounded text-[9px] capitalize transition-colors ${
                      pathType === type
                        ? "bg-primary text-white"
                        : "bg-bg-elev border border-border text-fg-2 hover:text-fg"
                    }`}
                  >
                    {editorMessage(pathTypeKeys[type])}
                  </ClickableCard>
                ))}
              </div>
            </div>
          </Card>

          <Card variant="muted" padding={3} className="flex items-center justify-between">
            <div className="flex flex-col gap-0.5">
              <Text type="supporting" color="secondary" className="text-[10px]">
                {editorMessage("editor.motionPath.points")}
              </Text>
              <Text type="body" color="primary" className="text-sm font-medium">
                {editorItemCount("points", pointCount)}
              </Text>
            </div>
            <div className="flex items-center gap-1">
              <IconButton
                label={editorMessage("editor.motionPath.addPoint")}
                icon={<Plus size={12} />}
                variant="primary"
                size="sm"
                onClick={handleAddPoint}
                className="p-1.5 rounded bg-primary/20 text-primary hover:bg-primary/30 transition-colors"
              />
              <IconButton
                label={editorMessage("editor.motionPath.clear")}
                icon={<Trash2 size={12} />}
                variant="secondary"
                size="sm"
                onClick={handleClearPath}
                className="p-1.5 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
              />
            </div>
          </Card>

          <Button
            label={isEditing ? editorMessage("editor.motionPath.exit") : editorMessage("editor.motionPath.edit")}
            icon={<Route size={14} />}
            variant={isEditing ? "primary" : "secondary"}
            size="sm"
            onClick={handleEditMode}
            className={`w-full ${
              isEditing
                ? "bg-primary text-white"
                : "bg-bg-2 text-fg border border-border hover:bg-bg-elev"
            }`}
          />

          {isEditing && (
            <Card variant="muted" padding={2} className="border border-primary/30 bg-primary/10">
              <Text type="supporting" className="text-[9px] text-primary">
                {editorMessage("editor.motionPath.editHint")}
              </Text>
            </Card>
          )}

          <Card variant="muted" padding={2} className="border border-border bg-bg-2/50">
            <Text type="supporting" color="secondary" className="text-[9px]">
              {editorMessage("editor.motionPath.tip")}
            </Text>
          </Card>
        </>
      )}
    </div>
  );
};

export default MotionPathSection;
