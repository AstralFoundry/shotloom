import { editorMessage } from "../../../shotloom-mode";
import React, { useState, useCallback, useEffect } from "react";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftClickableCard as ClickableCard } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { PropertySlider } from "./shell/PropertySlider";
import { MockToggle } from "./shell/InspectorControls";
import {
  Smartphone,
  Monitor,
  Square,
  Loader2,
  Play,
  CheckCircle,
} from "@/icons/lucide-compat";
import {
  getAutoReframeEngine,
  initializeAutoReframeEngine,
  type ReframeSettings,
  type AspectRatioPreset,
  type PlatformPreset,
  type ReframeResult,
  ASPECT_RATIO_PRESETS,
  PLATFORM_PRESETS,
  DEFAULT_REFRAME_SETTINGS,
} from "@openreel/core";
import { toast } from "../../../stores/notification-store";
import { useProjectStore } from "../../../stores/project-store";

interface AutoReframeSectionProps {
  clipId: string;
  onReframeComplete?: (result: ReframeResult) => void;
}

const PLATFORM_ICONS: Record<PlatformPreset, React.ElementType> = {
  youtube: Monitor,
  tiktok: Smartphone,
  "instagram-reels": Smartphone,
  "instagram-feed": Square,
  "instagram-stories": Smartphone,
  "youtube-shorts": Smartphone,
  facebook: Monitor,
  twitter: Monitor,
  linkedin: Monitor,
};

export const AutoReframeSection: React.FC<AutoReframeSectionProps> = ({
  clipId,
  onReframeComplete,
}) => {
  const updateProjectDimensions = useProjectStore(
    (state) => state.updateSettings,
  );
  const [reframeSettings, setReframeSettings] = useState<ReframeSettings>(
    DEFAULT_REFRAME_SETTINGS,
  );
  const [isInitializing, setIsInitializing] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isApplied, setIsApplied] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");
  const [selectedPlatform, setSelectedPlatform] =
    useState<PlatformPreset | null>("tiktok");

  useEffect(() => {
    const engine = getAutoReframeEngine();
    if (engine) {
      setIsInitialized(engine.isInitialized());
    }
  }, [clipId]);

  const handleInitialize = useCallback(async () => {
    setIsInitializing(true);
    try {
      const engine = initializeAutoReframeEngine();
      await engine.initialize((prog) => {
        setProgress(prog);
        setProgressMessage(editorMessage(prog < 100 ? "editor.reframe.engineInitializing" : "editor.reframe.engineReady"));
      });
      setIsInitialized(true);
    } catch (error) {
      console.error("Failed to initialize auto-reframe:", error);
    } finally {
      setIsInitializing(false);
    }
  }, []);

  const updateLocalSettings = useCallback(
    (updates: Partial<ReframeSettings>) => {
      setReframeSettings((prev) => ({ ...prev, ...updates }));
    },
    [],
  );

  const handleSelectPlatform = useCallback(
    (platform: PlatformPreset) => {
      setSelectedPlatform(platform);
      const config = PLATFORM_PRESETS[platform];
      const aspectRatio = Object.entries(ASPECT_RATIO_PRESETS).find(
        ([, v]) => Math.abs(v.ratio - config.ratio) < 0.01,
      );
      if (aspectRatio) {
        updateLocalSettings({
          targetAspectRatio: aspectRatio[0] as AspectRatioPreset,
        });
      }
    },
    [updateLocalSettings],
  );

  const handleSelectAspectRatio = useCallback(
    (ratio: AspectRatioPreset) => {
      setSelectedPlatform(null);
      updateLocalSettings({ targetAspectRatio: ratio });
    },
    [updateLocalSettings],
  );

  const handleAnalyze = useCallback(async () => {
    setIsProcessing(true);
    setProgress(0);
    setProgressMessage(editorMessage("editor.reframe.initializing"));

    try {
      if (!isInitialized) {
        setProgressMessage(editorMessage("editor.reframe.loading"));
        setProgress(10);
        await handleInitialize();
      }

      const engine = getAutoReframeEngine();
      if (!engine) {
        throw new Error(editorMessage("editor.reframe.unavailable"));
      }

      setProgressMessage(editorMessage("editor.reframe.configuring"));
      setProgress(30);

      await new Promise((resolve) => setTimeout(resolve, 300));

      setProgressMessage(editorMessage("editor.reframe.applying"));
      setProgress(60);

      const targetConfig =
        ASPECT_RATIO_PRESETS[reframeSettings.targetAspectRatio];

      await new Promise((resolve) => setTimeout(resolve, 300));

      setProgressMessage(editorMessage("editor.reframe.updating"));
      setProgress(80);

      await updateProjectDimensions({
        width: targetConfig.width,
        height: targetConfig.height,
      });

      setProgressMessage(editorMessage("editor.reframe.finalizing"));
      setProgress(90);

      await new Promise((resolve) => setTimeout(resolve, 200));

      setProgress(100);
      setProgressMessage(editorMessage("editor.reframe.complete"));
      setIsApplied(true);

      const result: ReframeResult = {
        keyframes: [],
        outputWidth: targetConfig.width,
        outputHeight: targetConfig.height,
        success: true,
        message: editorMessage("editor.reframe.configured", { name: reframeSettings.targetAspectRatio, width: targetConfig.width, height: targetConfig.height }),
      };

      onReframeComplete?.(result);

      const platformName = selectedPlatform
        ? PLATFORM_PRESETS[selectedPlatform].name
        : reframeSettings.targetAspectRatio;
      toast.success(
        editorMessage("editor.reframe.success"),
        editorMessage("editor.reframe.resized", { name: platformName, width: targetConfig.width, height: targetConfig.height }),
      );
    } catch (error) {
      console.error("Auto-reframe failed:", error);
      toast.error(
        editorMessage("editor.reframe.failed"),
        error instanceof Error ? error.message : editorMessage("editor.reframe.unknown"),
      );
      setIsApplied(false);
    } finally {
      setIsProcessing(false);
    }
  }, [
    isInitialized,
    handleInitialize,
    reframeSettings,
    selectedPlatform,
    onReframeComplete,
    updateProjectDimensions,
  ]);

  return (
    <div className="space-y-3">
      <div className="space-y-3">
        <div>
          <Text type="supporting" color="secondary" className="mb-2 block text-[10px]">{editorMessage("editor.reframe.platforms")}</Text>
            <div className="grid grid-cols-3 gap-1">
              {(Object.keys(PLATFORM_PRESETS) as PlatformPreset[]).map(
                (platform) => {
                  const PlatformIcon = PLATFORM_ICONS[platform];
                  return (
                    <ClickableCard
                      key={platform}
                      label={editorMessage("editor.reframe.platformPreset", { name: PLATFORM_PRESETS[platform].name })}
                      onClick={() => handleSelectPlatform(platform)}
                      className={`flex items-center gap-1 p-2 rounded text-[9px] transition-colors ${
                        selectedPlatform === platform
                          ? "bg-primary/20 border border-primary text-fg"
                          : "bg-bg-1 hover:bg-background-primary border border-transparent text-fg-2"
                      }`}
                    >
                      <PlatformIcon size={14} />
                      <Text type="supporting" className="truncate text-[9px]">
                        {PLATFORM_PRESETS[platform].name}
                      </Text>
                    </ClickableCard>
                  );
                },
            )}
          </div>
        </div>

        <div>
          <Text type="supporting" color="secondary" className="mb-2 block text-[10px]">{editorMessage("editor.reframe.aspect")}</Text>
          <div className="grid grid-cols-3 gap-1">
            {(Object.keys(ASPECT_RATIO_PRESETS) as AspectRatioPreset[])
              .filter((r) => r !== "custom")
              .map((ratio) => (
                <ClickableCard
                  key={ratio}
                  label={editorMessage("editor.reframe.aspectPreset", { ratio })}
                  onClick={() => handleSelectAspectRatio(ratio)}
                  className={`p-2 rounded text-[9px] transition-colors ${
                    reframeSettings.targetAspectRatio === ratio &&
                    !selectedPlatform
                      ? "bg-primary/20 border border-primary text-fg"
                      : "bg-bg-1 hover:bg-background-primary border border-transparent text-fg-2"
                  }`}
                >
                  {ratio}
                </ClickableCard>
              ))}
          </div>
        </div>

        <PropertySlider
          label={editorMessage("editor.reframe.tracking")}
          min={0}
          max={100}
          step={1}
          value={reframeSettings.trackingSpeed * 100}
          onChange={(value: number) =>
            updateLocalSettings({
              trackingSpeed: value / 100,
            })
          }
          formatValue={(value) => `${Math.round(value)}%`}
        />

        <PropertySlider
          label={editorMessage("editor.reframe.smoothing")}
          min={0}
          max={100}
          step={1}
          value={reframeSettings.smoothing * 100}
          onChange={(value: number) => updateLocalSettings({ smoothing: value / 100 })}
          formatValue={(value) => `${Math.round(value)}%`}
        />

        <PropertySlider
          label={editorMessage("editor.reframe.bias")}
          min={0}
          max={100}
          step={1}
          value={reframeSettings.centerBias * 100}
          onChange={(value: number) =>
            updateLocalSettings({
              centerBias: value / 100,
            })
          }
          formatValue={(value) => `${Math.round(value)}%`}
        />

        <div className="flex items-center justify-between">
          <Text type="supporting" color="secondary" className="text-[10px]">{editorMessage("editor.reframe.follow")}</Text>
          <MockToggle
            ariaLabel={editorMessage("editor.reframe.follow")}
            checked={reframeSettings.followSubject}
            onChange={() =>
              updateLocalSettings({
                followSubject: !reframeSettings.followSubject,
              })
            }
          />
        </div>

        {isProcessing && (
          <Card variant="muted" padding={2} className="space-y-1">
            <div className="flex items-center justify-between">
              <Text type="supporting" color="secondary" className="text-[9px]">
                {progressMessage}
              </Text>
              <Text type="supporting" color="secondary" className="text-[9px]">
                {progress}%
              </Text>
            </div>
            <div className="h-1 bg-bg-1 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </Card>
        )}

        <Button
          label={
            isInitializing || isProcessing
              ? isInitializing
                ? editorMessage("editor.reframe.initializing")
                : editorMessage("editor.reframe.analyzing")
              : isApplied
                ? editorMessage("editor.reframe.reanalyze")
                : editorMessage("editor.reframe.analyze")
          }
          icon={
            isInitializing || isProcessing ? (
              <Loader2 size={14} className="animate-spin" />
            ) : isApplied ? (
              <CheckCircle size={14} />
            ) : (
              <Play size={14} />
            )
          }
          variant="primary"
          size="sm"
          onClick={handleAnalyze}
          isDisabled={isInitializing || isProcessing}
          className="w-full justify-center"
        />

        <Text type="supporting" color="secondary" className="text-center text-[9px]">
          {editorMessage("editor.reframe.output", { width: ASPECT_RATIO_PRESETS[reframeSettings.targetAspectRatio].width, height: ASPECT_RATIO_PRESETS[reframeSettings.targetAspectRatio].height })}
        </Text>
      </div>
    </div>
  );
};

export default AutoReframeSection;
