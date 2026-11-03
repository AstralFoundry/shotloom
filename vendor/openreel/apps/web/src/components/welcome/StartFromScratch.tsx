import { editorMessage } from "../../shotloom-mode";
import { useState, useCallback } from "react";
import {
  Smartphone,
  Monitor,
  Square,
  ChevronRight,
  Check,
  Info,
} from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftSelectableCard as SelectableCard } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { ToolcraftTextInputControl } from "@openreel/ui";
import { useProjectStore } from "../../stores/project-store";
import { useAnalytics, AnalyticsEvents } from "../../hooks/useAnalytics";
import {
  SOCIAL_MEDIA_PRESETS,
  SOCIAL_MEDIA_CATEGORY_INFO,
  createProjectSettingsFromPreset,
  type SocialMediaCategory,
} from "@openreel/core";

const presetKeys = {
  "tiktok": "editor.welcome.create.preset.tiktok",
  "instagram-reels": "editor.welcome.create.preset.instagram-reels",
  "instagram-stories": "editor.welcome.create.preset.instagram-stories",
  "instagram-post": "editor.welcome.create.preset.instagram-post",
  "youtube-shorts": "editor.welcome.create.preset.youtube-shorts",
  "youtube-video": "editor.welcome.create.preset.youtube-video",
  "facebook": "editor.welcome.create.preset.facebook",
  "twitter": "editor.welcome.create.preset.twitter",
  "linkedin": "editor.welcome.create.preset.linkedin",
  "pinterest": "editor.welcome.create.preset.pinterest",
  "custom": "editor.welcome.create.preset.custom",
} as const;

function presetLabel(id: SocialMediaCategory): string {
  return Object.hasOwn(presetKeys, id)
    ? editorMessage(presetKeys[id as keyof typeof presetKeys])
    : SOCIAL_MEDIA_CATEGORY_INFO.find(candidate => candidate.id === id)?.name ?? id;
}

const groupKeys = {
  "Vertical (9:16)": "editor.welcome.create.vertical",
  "Square (1:1)": "editor.welcome.create.square",
  "Horizontal (16:9)": "editor.welcome.create.horizontal",
  "Other": "editor.welcome.create.other",
} as const;

interface StartFromScratchProps {
  onProjectCreated?: () => void;
}

interface PresetGroup {
  platform: string;
  presets: SocialMediaCategory[];
}

const PRESET_GROUPS: PresetGroup[] = [
  {
    platform: "Vertical (9:16)",
    presets: [
      "tiktok",
      "instagram-reels",
      "instagram-stories",
      "youtube-shorts",
    ],
  },
  {
    platform: "Square (1:1)",
    presets: ["instagram-post", "facebook"],
  },
  {
    platform: "Horizontal (16:9)",
    presets: ["youtube-video", "twitter", "linkedin"],
  },
  {
    platform: "Other",
    presets: ["pinterest", "custom"],
  },
];

const PRESET_ICONS: Record<string, React.ElementType> = {
  "Vertical (9:16)": Smartphone,
  "Square (1:1)": Square,
  "Horizontal (16:9)": Monitor,
  Other: Square,
};

export const StartFromScratch: React.FC<StartFromScratchProps> = ({
  onProjectCreated,
}) => {
  const createNewProject = useProjectStore((state) => state.createNewProject);
  const updateSettings = useProjectStore((state) => state.updateSettings);
  const { track } = useAnalytics();
  const [selectedPreset, setSelectedPreset] =
    useState<SocialMediaCategory>("youtube-video");
  const [projectName, setProjectName] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const preset = SOCIAL_MEDIA_PRESETS[selectedPreset];
  const info = SOCIAL_MEDIA_CATEGORY_INFO.find((c) => c.id === selectedPreset);

  const handleCreate = useCallback(async () => {
    setIsCreating(true);

    const settings = createProjectSettingsFromPreset(preset);
    createNewProject(projectName.trim() || editorMessage("editor.welcome.create.defaultName", { name: info ? presetLabel(selectedPreset) : editorMessage("editor.welcome.create.new") }));
    await updateSettings(settings);

    track(AnalyticsEvents.PROJECT_CREATED, {
      preset: selectedPreset,
      width: preset.width,
      height: preset.height,
      frameRate: preset.frameRate || 30,
      source: "start_from_scratch",
    });

    setTimeout(() => {
      setIsCreating(false);
      onProjectCreated?.();
    }, 100);
  }, [
    createNewProject,
    updateSettings,
    preset,
    projectName,
    info,
    onProjectCreated,
    track,
    selectedPreset,
  ]);

  return (
    <div className="space-y-6">
      <div>
        <Text type="label" color="primary" weight="medium" className="text-sm text-text-primary mb-2 block">
          {editorMessage("editor.welcome.create.name")}
        </Text>
        <ToolcraftTextInputControl
          label={editorMessage("editor.welcome.create.name")}
          isLabelHidden
          value={projectName}
          onChange={setProjectName}
          placeholder={editorMessage("editor.welcome.create.namePlaceholder")}
          className="max-w-md bg-background-tertiary border-border text-text-primary"
        />
      </div>

      <div>
        <Text type="label" color="primary" weight="medium" className="text-sm text-text-primary mb-4">
          {editorMessage("editor.welcome.create.selectFormat")}
        </Text>

        <div className="grid md:grid-cols-2 gap-6">
          {PRESET_GROUPS.map((group) => {
            const GroupIcon = PRESET_ICONS[group.platform] || Square;

            return (
              <div key={group.platform} className="space-y-3">
                <div className="flex items-center gap-2 text-xs text-text-muted font-medium">
                  <GroupIcon size={14} />
                  <span>{editorMessage(groupKeys[group.platform as keyof typeof groupKeys])}</span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {group.presets.map((presetId) => {
                    const presetData = SOCIAL_MEDIA_PRESETS[presetId];
                    const isSelected = selectedPreset === presetId;

                    return (
                      <SelectableCard
                        key={presetId}
                        label={presetLabel(presetId)}
                        isSelected={isSelected}
                        onChange={() => setSelectedPreset(presetId)}
                        onClick={() => setSelectedPreset(presetId)}
                        variant={isSelected ? "green" : "muted"}
                        padding={3}
                        className={`flex items-center gap-3 p-3 rounded-lg border transition-all duration-200 text-left ${
                          isSelected
                            ? "border-primary bg-primary/10"
                            : "border-border bg-background hover:border-border-hover hover:bg-background-tertiary"
                        }`}
                      >
                        <div
                          className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                            isSelected
                              ? "border-primary bg-primary"
                              : "border-border"
                          }`}
                        >
                          {isSelected && (
                            <Check size={12} className="text-black" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <Text type="supporting" color="primary" weight="medium" className="text-xs text-text-primary truncate">
                            {presetLabel(presetId)}
                          </Text>
                          <Text type="supporting" color="secondary" className="text-[10px] text-text-muted">
                            {presetData.width}×{presetData.height}
                          </Text>
                        </div>
                      </SelectableCard>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-start gap-3 p-4 bg-background-tertiary rounded-xl border border-border">
        <Info size={16} className="text-primary flex-shrink-0 mt-0.5" />
        <div>
          <Text type="supporting" color="primary" weight="medium" className="text-sm text-text-primary">
            {editorMessage("editor.welcome.create.format", { name: presetLabel(selectedPreset) })}
          </Text>
          <Text type="supporting" color="secondary" className="text-xs text-text-muted mt-1">
            {preset.width}×{preset.height}px • {preset.frameRate || 30}fps
            {preset.maxDuration && editorMessage("editor.welcome.create.maxDuration", { seconds: preset.maxDuration })}
            {preset.recommendedDuration &&
              editorMessage("editor.welcome.create.recommended", { seconds: preset.recommendedDuration })}
          </Text>
          {preset.safeZone && (
            <Text type="supporting" color="secondary" className="text-xs text-text-muted mt-0.5">
              {editorMessage("editor.welcome.create.safeZone", { top: preset.safeZone.top, bottom: preset.safeZone.bottom })}
            </Text>
          )}
        </div>
      </div>

      <div className="flex items-center justify-end gap-3">
        <Button
          label={editorMessage(isCreating ? "editor.welcome.create.creating" : "editor.welcome.create.create")}
          icon={isCreating ? (
            <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
          ) : (
            <ChevronRight size={16} aria-hidden />
          )}
          variant="primary"
          onClick={handleCreate}
          isDisabled={isCreating}
          className="shadow-glow"
        />
      </div>
    </div>
  );
};

export default StartFromScratch;
