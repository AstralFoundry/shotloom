import { editorMessage } from "../../../shotloom-mode";
import React, { useCallback } from "react";
import { ToolcraftSwitchControl } from "@openreel/ui";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftClickableCard as ClickableCard } from "@openreel/ui";
import { ToolcraftNumberInputControl } from "@openreel/ui";
import { ToolcraftSelectControl as Selector } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { ToolcraftTextInputControl as TextInput } from "@openreel/ui";
import { useSettingsStore, SERVICE_REGISTRY, type TtsProvider, type LlmProvider, type AggregatorProvider } from "../../../stores/settings-store";
import { useProjectStore } from "../../../stores/project-store";
import { EDITING_FRAME_RATE_OPTIONS } from "../editing-frame-rate";

const ASPECT_PRESETS: Array<{ label: string; width: number; height: number }> = [
  { get label() { return editorMessage("editor.general.preset0"); }, width: 1920, height: 1080 },
  { get label() { return editorMessage("editor.general.preset1"); }, width: 1080, height: 1920 },
  { get label() { return editorMessage("editor.general.preset2"); }, width: 1080, height: 1080 },
  { get label() { return editorMessage("editor.general.preset3"); }, width: 1080, height: 1350 },
  { get label() { return editorMessage("editor.general.preset4"); }, width: 1440, height: 1080 },
  { get label() { return editorMessage("editor.general.preset5"); }, width: 2560, height: 1080 },
  { get label() { return editorMessage("editor.general.preset6"); }, width: 3840, height: 2160 },
];

const BACKGROUND_SWATCHES = [
  "#000000",
  "#FFFFFF",
  "#1E1E1E",
  "#2563EB",
  "#DC2626",
  "#16A34A",
  "#F59E0B",
  "#9333EA",
  "#DB2777",
  "#0EA5E9",
];

export const GeneralPanel: React.FC = () => {
  const {
    autoSave,
    autoSaveInterval,
    defaultTtsProvider,
    defaultLlmProvider,
    llmBaseUrl,
    llmModel,
    defaultAggregator,
    configuredServices,
    setAutoSave,
    setAutoSaveInterval,
    setDefaultTtsProvider,
    setDefaultLlmProvider,
    setLlmBaseUrl,
    setLlmModel,
    setDefaultAggregator,
  } = useSettingsStore();

  const projectWidth = useProjectStore((s) => s.project.settings.width);
  const projectHeight = useProjectStore((s) => s.project.settings.height);
  const projectFrameRate = useProjectStore(
    (s) => s.project.settings.frameRate,
  );
  const updateProjectSettings = useProjectStore((s) => s.updateSettings);
  const backgroundFillMode = useProjectStore(
    (s) => s.project.timeline.backgroundFillMode,
  );
  const layoutBackgroundColor = useProjectStore(
    (s) => s.project.timeline.layoutBackgroundColor,
  );
  const setCanvasBackground = useProjectStore((s) => s.setCanvasBackground);

  const [draftWidth, setDraftWidth] = React.useState(String(projectWidth));
  const [draftHeight, setDraftHeight] = React.useState(String(projectHeight));

  React.useEffect(() => {
    setDraftWidth(String(projectWidth));
    setDraftHeight(String(projectHeight));
  }, [projectWidth, projectHeight]);

  const applyDimensions = useCallback(
    async (width: number, height: number) => {
      const w = Math.max(16, Math.min(7680, Math.round(width)));
      const h = Math.max(16, Math.min(7680, Math.round(height)));
      await updateProjectSettings({ width: w, height: h });
    },
    [updateProjectSettings],
  );

  const handleApplyCustom = useCallback(() => {
    const w = Number(draftWidth);
    const h = Number(draftHeight);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      applyDimensions(w, h);
    }
  }, [draftWidth, draftHeight, applyDimensions]);

  const ttsProviders = SERVICE_REGISTRY.filter((s) => s.id === "elevenlabs");

  const llmProviders = SERVICE_REGISTRY.filter(
    (s) => s.id === "openai-compatible" || s.id === "anthropic-compatible",
  );

  const aggregatorProviders = SERVICE_REGISTRY.filter(
    (s) =>
      s.id === "kie-ai" ||
      s.id === "freepik" ||
      configuredServices.includes(s.id),
  );
  return (
    <div className="space-y-6 pb-4">
      {/* Project Composition */}
      <div className="space-y-4">
        <div>
          <Text type="body" color="primary" className="text-sm font-medium">
            {editorMessage("editor.general.composition")}
          </Text>
          <Text type="supporting" color="secondary" className="mt-0.5 text-xs">
            {editorMessage("editor.general.compositionHelp")}
          </Text>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {ASPECT_PRESETS.map((preset) => {
            const isActive =
                preset.width === projectWidth && preset.height === projectHeight;
            return (
              <ClickableCard
                key={preset.label}
                label={preset.label}
                onClick={() => applyDimensions(preset.width, preset.height)}
                padding={3}
                variant={isActive ? "green" : "muted"}
                className={`text-left text-xs border ${
                  isActive
                    ? "border-primary bg-primary/10 text-text-primary"
                    : "border-border bg-background-tertiary text-text-secondary hover:text-text-primary hover:border-primary/40"
                }`}
              >
                <Text type="supporting" color="inherit" className="font-medium">
                  {preset.label}
                </Text>
                <Text type="supporting" color="secondary" className="mt-0.5 text-[10px]">
                  {preset.width} × {preset.height}
                </Text>
              </ClickableCard>
            );
          })}
        </div>

        <div className="flex items-end gap-2">
          <ToolcraftNumberInputControl
            label={editorMessage("editor.general.width")}
            size="md"
            width="100%"
            min={16}
            max={7680}
            value={Number.isFinite(Number(draftWidth)) ? Number(draftWidth) : null}
            onChange={(value) => setDraftWidth(String(value))}
          />
          <ToolcraftNumberInputControl
            label={editorMessage("editor.general.height")}
            size="md"
            width="100%"
            min={16}
            max={7680}
            value={Number.isFinite(Number(draftHeight)) ? Number(draftHeight) : null}
            onChange={(value) => setDraftHeight(String(value))}
          />
          <Button
            label={editorMessage("editor.general.apply")}
            onClick={handleApplyCustom}
            variant="primary"
            size="md"
          />
        </div>

        <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-background-tertiary p-3">
          <div>
            <Text type="supporting" color="primary" className="text-sm font-medium">
              {editorMessage("editor.general.frameRate")}
            </Text>
            <Text type="supporting" color="secondary" className="mt-0.5 block text-[11px]">
              {editorMessage("editor.general.frameRateHelp")}
            </Text>
          </div>
          <Selector
            label={editorMessage("editor.general.frameRate")}
            isLabelHidden
            size="md"
            width={160}
            value={String(projectFrameRate)}
            onChange={(value) => {
              const frameRate = Number(value);
              if (Number.isFinite(frameRate) && frameRate > 0) {
                void updateProjectSettings({ frameRate });
              }
            }}
            options={EDITING_FRAME_RATE_OPTIONS.map((option) => ({
              label: option.label,
              value: String(option.value),
            }))}
          />
        </div>

        <div className="space-y-2">
          <Text type="supporting" color="secondary" className="text-xs font-medium">
            {editorMessage("editor.general.background")}
          </Text>
          <Text type="supporting" color="secondary" className="text-[11px]">
            {editorMessage("editor.general.backgroundHelp")}
          </Text>
          <div className="flex flex-wrap items-center gap-2">
            <ClickableCard
              label={editorMessage("editor.general.noBackground")}
              onClick={() => setCanvasBackground(undefined, undefined)}
              padding={2}
              variant={!backgroundFillMode ? "green" : "muted"}
              className={`border px-3 py-1.5 text-xs ${
                !backgroundFillMode
                  ? "border-primary bg-primary/10 text-text-primary"
                  : "border-border bg-background-tertiary text-text-secondary hover:text-text-primary"
              }`}
            >
              {editorMessage("editor.general.none")}
            </ClickableCard>
            <ClickableCard
              label={editorMessage("editor.general.blurBackground")}
              onClick={() =>
                setCanvasBackground("blur", layoutBackgroundColor)
              }
              padding={2}
              variant={backgroundFillMode === "blur" ? "green" : "muted"}
              className={`border px-3 py-1.5 text-xs ${
                backgroundFillMode === "blur"
                  ? "border-primary bg-primary/10 text-text-primary"
                  : "border-border bg-background-tertiary text-text-secondary hover:text-text-primary"
              }`}
            >
              {editorMessage("editor.general.blur")}
            </ClickableCard>
            {BACKGROUND_SWATCHES.map((hex) => {
              const isActive =
                backgroundFillMode === "color" &&
                layoutBackgroundColor?.toLowerCase() === hex.toLowerCase();
              return (
                <ClickableCard
                  key={hex}
                  label={editorMessage("editor.general.color", { color: hex })}
                  onClick={() => setCanvasBackground("color", hex)}
                  padding={0}
                  variant="transparent"
                  style={{ backgroundColor: hex }}
                  className={`h-6 w-6 rounded-full border-2 transition-transform ${
                    isActive
                      ? "border-primary scale-110"
                      : "border-border hover:scale-105"
                  }`}
                />
              );
            })}
          </div>
        </div>
      </div>

      <div className="h-px bg-border" />

      {/* Auto-save */}
      <div className="space-y-4">
        <Text type="body" color="primary" className="text-sm font-medium">
          {editorMessage("editor.general.autoSave")}
        </Text>

        <div className="flex items-center justify-between">
          <div>
            <Text type="supporting" color="secondary" className="text-sm">
              {editorMessage("editor.general.enableAutoSave")}
            </Text>
            <Text type="supporting" color="secondary" className="mt-0.5 text-xs">
              {editorMessage("editor.general.autoSaveHelp")}
            </Text>
          </div>
          <ToolcraftSwitchControl
            ariaLabel={editorMessage("editor.general.enableAutoSave")}
            checked={autoSave}
            onCheckedChange={setAutoSave}
            showLabel={false}
          />
        </div>

        {autoSave && (
          <div className="flex items-center gap-3">
            <Text type="supporting" color="secondary" className="whitespace-nowrap text-sm">
              {editorMessage("editor.general.saveEvery")}
            </Text>
            <Selector
              label={editorMessage("editor.general.interval")}
              isLabelHidden
              size="md"
              width={150}
              value={String(autoSaveInterval)}
              onChange={(value) => setAutoSaveInterval(Number(value))}
              options={[
                { label: editorMessage("editor.general.minute"), value: "1" },
                { label: editorMessage("editor.general.minutes", { count: 2 }), value: "2" },
                { label: editorMessage("editor.general.minutes", { count: 5 }), value: "5" },
                { label: editorMessage("editor.general.minutes", { count: 10 }), value: "10" },
                { label: editorMessage("editor.general.minutes", { count: 15 }), value: "15" },
                { label: editorMessage("editor.general.minutes", { count: 30 }), value: "30" },
              ]}
            />
          </div>
        )}
      </div>

      <div className="h-px bg-border" />

      {/* AI connections */}
      <div className="space-y-4">
        <Text type="body" color="primary" className="text-sm font-medium">
          {editorMessage("editor.general.connections")}
        </Text>
        <Text type="supporting" color="secondary" className="text-xs">
          {editorMessage("editor.general.connectionsHelp")}
        </Text>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Text type="supporting" color="secondary" className="text-sm">
              {editorMessage("editor.general.speech")}
            </Text>
            <Selector
              label={editorMessage("editor.general.speechProvider")}
              isLabelHidden
              size="md"
              width={180}
              value={defaultTtsProvider}
              onChange={(value) => setDefaultTtsProvider(value as TtsProvider)}
              options={ttsProviders.map((s) => ({ label: s.label, value: s.id }))}
            />
          </div>

          <div className="flex items-center justify-between">
            <Text type="supporting" color="secondary" className="text-sm">
              {editorMessage("editor.general.format")}
            </Text>
            <Selector
              label={editorMessage("editor.general.format")}
              isLabelHidden
              size="md"
              width={180}
              value={defaultLlmProvider ?? ""}
              onChange={(value) =>
                setDefaultLlmProvider((value || null) as LlmProvider | null)
              }
              options={[
                { label: editorMessage("editor.general.chooseFormat"), value: "" },
                ...llmProviders.map((s) => ({ label: s.label, value: s.id })),
              ]}
            />
          </div>

          {defaultLlmProvider ? (
            <div className="space-y-3 rounded-lg border border-border bg-background-tertiary p-3">
              <div>
                <Text type="supporting" color="secondary" className="text-sm font-medium">
                  {defaultLlmProvider === "anthropic-compatible"
                    ? editorMessage("editor.general.anthropic")
                    : editorMessage("editor.general.openai")}
                </Text>
                <Text type="supporting" color="secondary" className="mt-0.5 block text-xs">
                  {editorMessage("editor.general.endpointHelp")}
                </Text>
              </div>
              <TextInput
                label={editorMessage("editor.general.url")}
                value={llmBaseUrl}
                onChange={setLlmBaseUrl}
                placeholder={
                  defaultLlmProvider === "anthropic-compatible"
                    ? "https://gateway.example/v1"
                    : "http://localhost:11434/v1"
                }
                width="100%"
              />
              <TextInput
                label={editorMessage("editor.general.model")}
                value={llmModel}
                onChange={setLlmModel}
                placeholder={editorMessage("editor.general.modelPlaceholder")}
                width="100%"
              />
              <Text type="supporting" color="secondary" className="block text-[11px] leading-relaxed">
                {editorMessage("editor.general.usage")}
              </Text>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-background-tertiary p-3">
              <Text type="supporting" color="secondary" className="block text-xs">
                {editorMessage("editor.general.chooseHelp")}
              </Text>
            </div>
          )}

          <div className="flex items-center justify-between">
            <div>
              <Text type="supporting" color="secondary" className="text-sm">
                {editorMessage("editor.general.aggregator")}
              </Text>
              <Text type="supporting" color="secondary" className="mt-0.5 text-xs">
                {editorMessage("editor.general.aggregatorHelp")}
              </Text>
            </div>
            <Selector
              label={editorMessage("editor.general.aggregatorProvider")}
              isLabelHidden
              size="md"
              width={180}
              value={defaultAggregator}
              onChange={(value) => setDefaultAggregator(value as AggregatorProvider)}
              options={aggregatorProviders.map((s) => ({ label: s.label, value: s.id }))}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
