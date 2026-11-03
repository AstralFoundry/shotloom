import { editorMessage } from "../../../shotloom-mode";
import React, { useState, useEffect, useCallback } from "react";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftCheckboxInput as CheckboxInput } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftNumberInputControl } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { PropertySlider } from "./shell/PropertySlider";
import {
  Target,
  X,
  Check,
  AlertTriangle,
  Move,
  RotateCcw,
  Maximize2,
  ChevronDown,
  ChevronRight,
  RefreshCw,
} from "@/icons/lucide-compat";
import {
  getMotionTrackingBridge,
  type MotionTrackingState,
} from "../../../bridges/motion-tracking-bridge";
import type { Rectangle } from "@openreel/core";

interface MotionTrackingSectionProps {
  clipId: string;
}

type TrackingAlgorithm = "correlation" | "optical-flow" | "feature";

const ALGORITHMS = [
  { id: "correlation", key: "editor.tracking.algorithm.correlation" },
  { id: "optical-flow", key: "editor.tracking.algorithm.opticalFlow" },
  { id: "feature", key: "editor.tracking.algorithm.feature" },
] as const;

const RegionInput: React.FC<{
  label: string;
  value: number;
  onChange: (value: number) => void;
}> = ({ label, value, onChange }) => (
  <ToolcraftNumberInputControl
    label={label}
    size="sm"
    width="100%"
    value={value}
    onChange={onChange}
    step={1}
  />
);

export const MotionTrackingSection: React.FC<MotionTrackingSectionProps> = ({
  clipId,
}) => {
  const [state, setState] = useState<MotionTrackingState>({
    isTracking: false,
    progress: 0,
    currentJob: null,
    trackingData: null,
    lostFrames: [],
    error: null,
  });

  const [region, setRegion] = useState<Rectangle>({
    x: 100,
    y: 100,
    width: 200,
    height: 200,
  });

  const [algorithm, setAlgorithm] = useState<TrackingAlgorithm>("correlation");
  const [confidenceThreshold, setConfidenceThreshold] = useState(70);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [applyScale, setApplyScale] = useState(true);
  const [applyRotation, setApplyRotation] = useState(true);
  const [smoothing, setSmoothing] = useState(0);
  const [isApplied, setIsApplied] = useState(false);

  const bridge = getMotionTrackingBridge();

  useEffect(() => {
    const unsubscribe = bridge.subscribe(setState);
    const existingData = bridge.getTrackingDataForClip(clipId);
    if (existingData.length > 0) {
      setState((prev) => ({
        ...prev,
        trackingData: existingData[existingData.length - 1],
      }));
    }
    return unsubscribe;
  }, [bridge, clipId]);

  const handleStartTracking = useCallback(async () => {
    try {
      await bridge.startTracking(clipId, region, {
        frameRate: 30,
        startFrame: 0,
        endFrame: 150,
        algorithm,
        confidenceThreshold: confidenceThreshold / 100,
      });
    } catch (error) {
      console.error("Failed to start tracking:", error);
    }
  }, [bridge, clipId, region, algorithm, confidenceThreshold]);

  const handleCancelTracking = useCallback(() => {
    if (state.currentJob) {
      bridge.cancelTracking(state.currentJob.id);
    }
  }, [bridge, state.currentJob]);

  const handleApplyTracking = useCallback(() => {
    const success = bridge.applyTrackingToClip(clipId, {
      x: offsetX,
      y: offsetY,
    });
    if (success) {
      bridge.setApplyScale(clipId, applyScale);
      bridge.setApplyRotation(clipId, applyRotation);
      setIsApplied(true);
    }
  }, [bridge, clipId, offsetX, offsetY, applyScale, applyRotation]);

  const handleRemoveTracking = useCallback(() => {
    bridge.removeAttachment(clipId);
    setIsApplied(false);
  }, [bridge, clipId]);

  const handleOffsetChange = useCallback(
    (axis: "x" | "y", value: number) => {
      if (axis === "x") {
        setOffsetX(value);
      } else {
        setOffsetY(value);
      }
      if (isApplied) {
        bridge.setTrackingOffset(clipId, {
          x: axis === "x" ? value : offsetX,
          y: axis === "y" ? value : offsetY,
        });
      }
    },
    [bridge, clipId, isApplied, offsetX, offsetY],
  );

  const hasTrackingData =
    state.trackingData !== null || bridge.hasTrackingData(clipId);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 p-2 bg-primary/10 rounded-lg border border-primary/30">
        <Target size={16} className="text-primary" />
        <div className="flex flex-1 flex-col gap-0.5">
          <Text type="supporting" color="primary" weight="medium">{editorMessage("editor.tracking.title")}</Text>
          <Text type="supporting" color="secondary" className="text-[9px]">{editorMessage("editor.tracking.description")}</Text>
        </div>
      </div>

      {!state.isTracking && !hasTrackingData && (
        <>
          <div className="space-y-2">
            <Text type="supporting" color="secondary" weight="medium">{editorMessage("editor.tracking.region")}</Text>
            <div className="grid grid-cols-2 gap-2">
              <RegionInput
                label={editorMessage("editor.tracking.x")}
                value={region.x}
                onChange={(x) => setRegion({ ...region, x })}
              />
              <RegionInput
                label={editorMessage("editor.tracking.y")}
                value={region.y}
                onChange={(y) => setRegion({ ...region, y })}
              />
              <RegionInput
                label={editorMessage("editor.tracking.width")}
                value={region.width}
                onChange={(width) => setRegion({ ...region, width })}
              />
              <RegionInput
                label={editorMessage("editor.tracking.height")}
                value={region.height}
                onChange={(height) => setRegion({ ...region, height })}
              />
            </div>
            <Text type="supporting" color="secondary" className="text-center text-[9px]">{editorMessage("editor.tracking.regionHint")}</Text>
          </div>

          <Button
            label={editorMessage("editor.tracking.advanced")}
            size="sm"
            variant="ghost"
            icon={showAdvanced ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="w-full flex items-center gap-2 py-1.5 text-[10px] text-fg-2 hover:text-fg transition-colors"
          />

          {showAdvanced && (
            <Card variant="muted" padding={3} className="space-y-3">
              <div className="space-y-1.5">
                <Text type="supporting" color="secondary" weight="medium">{editorMessage("editor.tracking.algorithm")}</Text>
                <div className="space-y-1">
                  {ALGORITHMS.map((algo) => (
                    <Button
                      key={algo.id}
                      label={editorMessage(algo.key)}
                      size="sm"
                      variant={algorithm === algo.id ? "primary" : "secondary"}
                      onClick={() => setAlgorithm(algo.id)}
                      className="w-full justify-start"
                    />
                  ))}
                </div>
              </div>

              <PropertySlider
                label={editorMessage("editor.tracking.confidence")}
                min={30}
                max={95}
                step={5}
                value={confidenceThreshold}
                onChange={setConfidenceThreshold}
                formatValue={(value) => `${value}%`}
                description={editorMessage("editor.tracking.confidenceHint")}
              />

              <PropertySlider
                label={editorMessage("editor.tracking.smoothing")}
                min={0}
                max={10}
                step={1}
                value={smoothing}
                onChange={setSmoothing}
                formatValue={(value) => String(value)}
                description={editorMessage("editor.tracking.smoothingHint")}
              />
            </Card>
          )}

          <Button
            label={editorMessage("editor.tracking.start")}
            size="md"
            variant="primary"
            icon={<Target size={14} />}
            onClick={handleStartTracking}
            className="w-full py-2.5 bg-primary hover:bg-primary-hover rounded-lg text-[11px] font-medium text-white flex items-center justify-center gap-2 transition-colors"
          />
        </>
      )}

      {state.isTracking && (
        <div className="space-y-3 p-3 bg-bg-2 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-primary rounded-full animate-pulse" />
              <Text type="supporting" color="primary" weight="medium">{editorMessage("editor.tracking.progress")}</Text>
            </div>
            <IconButton
              label={editorMessage("editor.tracking.cancel")}
              icon={<X size={14} />}
              size="sm"
              variant="ghost"
              onClick={handleCancelTracking}
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px]">
              <Text type="supporting" color="secondary">{editorMessage("editor.tracking.analyzing")}</Text>
              <Text type="supporting" color="primary" className="font-mono">
                {Math.round(state.progress)}%
              </Text>
            </div>
            <div className="w-full h-2 bg-bg-1 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-200"
                style={{ width: `${state.progress}%` }}
              />
            </div>
          </div>

          {state.lostFrames.length > 0 && (
            <div className="flex items-center gap-2 p-2 bg-amber-500/10 border border-amber-500/20 rounded text-[10px] text-amber-400">
              <AlertTriangle size={12} />
              {editorMessage("editor.tracking.lost", { count: state.lostFrames.length })}
            </div>
          )}
        </div>
      )}

      {state.error && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-[10px] text-red-400">
          <div className="flex items-center gap-2 font-medium mb-1">
            <AlertTriangle size={12} />{editorMessage("editor.tracking.failed")}</div>
          <Text type="supporting" className="text-[9px] text-red-300/80">
            {state.error}
          </Text>
        </div>
      )}

      {hasTrackingData && !state.isTracking && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 p-2 bg-green-500/10 border border-green-500/30 rounded-lg">
            <Check size={14} className="text-green-400" />
            <div className="flex flex-1 flex-col gap-0.5">
              <Text type="supporting" weight="medium" className="text-[10px] text-green-400">{editorMessage("editor.tracking.complete")}</Text>
              {state.trackingData && (
                <Text type="supporting" className="text-[9px] text-green-300/70">
                  {state.trackingData.lostFrames.length > 0
                    ? editorMessage("editor.tracking.capturedWithLoss", { count: state.trackingData.keyframes.length, lost: state.trackingData.lostFrames.length })
                    : editorMessage("editor.tracking.captured", { count: state.trackingData.keyframes.length })}
                </Text>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Text
              type="supporting"
              color="secondary"
              weight="medium"
              className="flex items-center gap-2"
            >
              <Move size={12} />{editorMessage("editor.tracking.offset")}</Text>
            <div className="grid grid-cols-2 gap-2">
              <RegionInput
                label={editorMessage("editor.tracking.offsetX")}
                value={offsetX}
                onChange={(value) => handleOffsetChange("x", value)}
              />
              <RegionInput
                label={editorMessage("editor.tracking.offsetY")}
                value={offsetY}
                onChange={(value) => handleOffsetChange("y", value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Text type="supporting" color="secondary" weight="medium">{editorMessage("editor.tracking.transform")}</Text>
            <div className="grid grid-cols-2 gap-2">
              <CheckboxInput
                label={editorMessage("editor.tracking.scale")}
                value={applyScale}
                labelIcon={<Maximize2 size={10} aria-hidden />}
                onChange={(value) => {
                  setApplyScale(value);
                  if (isApplied) {
                    bridge.setApplyScale(clipId, value);
                  }
                }}
              />
              <CheckboxInput
                label={editorMessage("editor.tracking.rotation")}
                value={applyRotation}
                labelIcon={<RotateCcw size={10} aria-hidden />}
                onChange={(value) => {
                  setApplyRotation(value);
                  if (isApplied) {
                    bridge.setApplyRotation(clipId, value);
                  }
                }}
              />
            </div>
          </div>

          {!isApplied ? (
            <Button
              label={editorMessage("editor.tracking.apply")}
              size="md"
              variant="secondary"
              onClick={handleApplyTracking}
              className="w-full py-2.5 bg-primary/20 border border-primary/30 rounded-lg text-[11px] font-medium text-primary hover:bg-primary/30 transition-colors"
            />
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2 p-2 bg-primary/10 border border-primary/20 rounded-lg">
                <Check size={12} className="text-primary" />
                <Text type="supporting" color="primary" className="text-[10px]">{editorMessage("editor.tracking.applied")}</Text>
              </div>
              <Button
                label={editorMessage("editor.tracking.remove")}
                size="sm"
                variant="destructive"
                onClick={handleRemoveTracking}
                className="w-full py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-[10px] text-red-400 hover:bg-red-500/20 transition-colors"
              />
            </div>
          )}

          <Button
            label={editorMessage("editor.tracking.retrack")}
            size="sm"
            variant="ghost"
            icon={<RefreshCw size={10} />}
            onClick={handleStartTracking}
            className="w-full flex items-center justify-center gap-2 py-1.5 text-[9px] text-fg-3 hover:text-fg-2 transition-colors"
          />
        </div>
      )}

      <div className="pt-2 border-t border-border">
        <Text type="supporting" color="secondary" className="text-center text-[9px]">{editorMessage("editor.tracking.hint")}</Text>
      </div>
    </div>
  );
};

export default MotionTrackingSection;
