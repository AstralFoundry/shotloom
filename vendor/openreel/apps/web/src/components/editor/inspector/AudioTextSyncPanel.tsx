import { editorMessage } from "../../../shotloom-mode";
import React, { useCallback, useEffect, useState, useMemo } from "react";
import { Music, Loader2, AlertCircle, Check, Settings2, Image, Type, Video } from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftClickableCard as ClickableCard } from "@openreel/ui";
import { ToolcraftProgressBar as ProgressBar } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { PropertySlider } from "./shell/PropertySlider";
import {
  getBeatSyncBridge,
  type BeatSyncState,
  DEFAULT_BEAT_SYNC_CONFIG,
} from "../../../bridges/audio-text-sync-bridge";
import { useProjectStore } from "../../../stores/project-store";
import type { SyncMode } from "@openreel/core";

interface BeatSyncPanelProps {
  clipId: string;
}

const TRACK_ICONS: Record<string, React.ReactNode> = {
  video: <Video size={12} aria-hidden />,
  image: <Image size={12} aria-hidden />,
  text: <Type size={12} aria-hidden />,
  graphics: <Type size={12} aria-hidden />,
};

export const AudioTextSyncPanel: React.FC<BeatSyncPanelProps> = ({ clipId }) => {
  const project = useProjectStore((store) => store.project);
  const [state, setState] = useState<BeatSyncState | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const bridge = useMemo(() => getBeatSyncBridge(), []);

  useEffect(() => {
    const unsubscribe = bridge.subscribe(setState);
    bridge.setSelectedAudioClip(clipId);
    return unsubscribe;
  }, [bridge, clipId]);

  useEffect(() => {
    bridge.refreshProject();
  }, [bridge, project]);

  const availableTracks = bridge.getAvailableTracks();

  const handleAnalyzeBeats = useCallback(() => {
    bridge.analyzeBeats();
  }, [bridge]);

  const handleToggleTrack = useCallback(
    (trackId: string) => {
      bridge.toggleTrackSelection(trackId);
    },
    [bridge],
  );

  const handleApply = useCallback(async () => {
    await bridge.applySync();
  }, [bridge]);

  const handleUpdateConfig = useCallback(
    (updates: Partial<typeof DEFAULT_BEAT_SYNC_CONFIG>) => {
      bridge.updateConfig(updates);
    },
    [bridge],
  );

  if (!state) {
    return (
      <div className="p-4 flex items-center justify-center">
        <Loader2 size={20} className="animate-spin text-primary" aria-hidden />
      </div>
    );
  }

  const {
    isProcessing,
    progress,
    beatAnalysis,
    selectedTrackIds,
    clipsToSync,
    previewTimings,
    config,
    error,
  } = state;

  return (
    <fieldset disabled={isProcessing} className="space-y-4 min-w-0">
      <div className="flex items-center gap-2 text-fg-2">
        <Music size={14} aria-hidden />
        <Text type="supporting" color="secondary" className="text-[10px]">{editorMessage("editor.sync.help")}</Text>
      </div>

      {error && (
        <Card
          variant="red"
          padding={3}
          className="flex items-center gap-2 border border-red-500/30"
        >
          <AlertCircle size={14} className="text-red-400 shrink-0" aria-hidden />
          <Text type="supporting" className="text-[10px] text-red-400">
            {error}
          </Text>
        </Card>
      )}

      {!beatAnalysis ? (
        <div className="space-y-3">
          {isProcessing && progress ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Loader2 size={12} className="animate-spin text-primary" aria-hidden />
                <Text type="supporting" color="primary" className="text-[10px]">
                  {progress.message}
                </Text>
              </div>
              <ProgressBar
                label={editorMessage("editor.sync.progress")}
                isLabelHidden
                value={progress.percent}
                max={100}
                hasValueLabel
              />
            </div>
          ) : (
            <Button
              label={editorMessage("editor.sync.detect")}
              icon={<Music size={14} aria-hidden />}
              variant="primary"
              size="sm"
              onClick={handleAnalyzeBeats}
              className="w-full"
            />
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <Card
            variant="green"
            padding={3}
            className="flex items-center justify-between border border-primary/30"
          >
            <div>
              <Text type="supporting" color="secondary" className="block text-[10px]">{editorMessage("editor.sync.bpm")}</Text>
              <Text type="body" color="primary" weight="bold" className="text-lg">
                {beatAnalysis.bpm}
              </Text>
            </div>
            <div className="text-right">
              <Text type="supporting" color="secondary" className="block text-[10px]">{editorMessage("editor.sync.beats")}</Text>
              <Text type="body" color="primary" weight="bold" className="text-sm">
                {beatAnalysis.beats.length}
              </Text>
            </div>
          </Card>

          <div className="space-y-2">
            <Text type="supporting" color="secondary" className="block text-[10px]">{editorMessage("editor.sync.selectTracks")}</Text>

            {availableTracks.length === 0 ? (
              <Card variant="muted" padding={3}>
                <Text type="supporting" color="secondary" className="text-[10px]">{editorMessage("editor.sync.noTracks")}</Text>
              </Card>
            ) : (
              <div className="space-y-1">
                {availableTracks.map((track) => (
                  <ClickableCard
                    key={track.id}
                    label={editorMessage(selectedTrackIds.includes(track.id) ? "editor.sync.deselectTrack" : "editor.sync.selectTrack", { name: track.name })}
                    onClick={() => handleToggleTrack(track.id)}
                    padding={2}
                    variant={selectedTrackIds.includes(track.id) ? "green" : "muted"}
                    className={`w-full border ${
                      selectedTrackIds.includes(track.id)
                        ? "border-primary/50"
                        : "border-transparent"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {TRACK_ICONS[track.type] || <Video size={12} aria-hidden />}
                        <Text type="supporting" color="primary" className="text-[11px]">
                          {track.name}
                        </Text>
                      </div>
                      <Text type="supporting" color="secondary" className="text-[9px]">
                        {editorMessage(track.clipCount === 1 ? "editor.sync.clipOne" : "editor.sync.clipMany", { count: track.clipCount })}
                      </Text>
                    </div>
                  </ClickableCard>
                ))}
              </div>
            )}
          </div>

          {config.syncMode === "cut-to-beats" && (
            <div className="space-y-2">
              <Text type="supporting" color="secondary" className="block text-[10px]">
                {editorMessage("editor.sync.cutEvery")}
              </Text>
              <div className="flex gap-1">
                {([1, 2, 4, 8] as const).map((beats) => (
                  <Button key={beats} label={editorMessage(beats === 1 ? "editor.sync.beatOne" : "editor.sync.beatMany", { count: beats })}
                    variant={(config.beatsPerClip ?? 4) === beats ? "primary" : "secondary"}
                    size="sm" isDisabled={isProcessing}
                    onClick={() => handleUpdateConfig({ beatsPerClip: beats })} />
                ))}
              </div>
              <Text type="supporting" color="secondary" className="block text-[10px]">{editorMessage("editor.sync.cutHelp")}</Text>
            </div>
          )}

          {clipsToSync.length > 0 && (
            <Card variant="muted" padding={2}>
              <Text type="supporting" color="secondary" className="text-[9px]">
                {editorMessage("editor.sync.summary", { clips: clipsToSync.length, beats: beatAnalysis.beats.length })}
              </Text>
            </Card>
          )}

          <div className="border-t border-border pt-3">
            <Button
              label={editorMessage("editor.sync.settings")}
              icon={<Settings2 size={12} aria-hidden />}
              variant="ghost"
              size="sm"
              onClick={() => setShowSettings(!showSettings)}
              className="mb-3"
            />

            {showSettings && (
              <Card variant="muted" padding={3} className="space-y-3">
                <div>
                  <Text type="supporting" color="secondary" className="block mb-2 text-[10px]">{editorMessage("editor.sync.mode")}</Text>
                  <div className="space-y-1">
                    {([
                      { value: "cut-to-beats", label: editorMessage("editor.sync.cut"), desc: editorMessage("editor.sync.cutDescription") },
                      { value: "smart", label: editorMessage("editor.sync.smart"), desc: editorMessage("editor.sync.smartDescription") },
                      { value: "one-per-beat", label: editorMessage("editor.sync.one"), desc: editorMessage("editor.sync.oneDescription") },
                      { value: "preserve-duration", label: editorMessage("editor.sync.preserve"), desc: editorMessage("editor.sync.preserveDescription") },
                    ] as const).map((mode) => (
                      <ClickableCard
                        key={mode.value}
                        label={editorMessage("editor.sync.useMode", { mode: mode.label })}
                        onClick={() => handleUpdateConfig({ syncMode: mode.value as SyncMode })}
                        padding={2}
                        variant={config.syncMode === mode.value ? "green" : "default"}
                        className={`w-full border ${
                          config.syncMode === mode.value
                            ? "border-primary/50"
                            : "border-transparent"
                        }`}
                      >
                        <Text type="supporting" color="primary" className="block text-[10px]">
                          {mode.label}
                        </Text>
                        <Text type="supporting" color="secondary" className="text-[9px]">
                          {mode.desc}
                        </Text>
                      </ClickableCard>
                    ))}
                  </div>
                </div>

                {config.syncMode !== "cut-to-beats" && <div className="flex items-center justify-between gap-2">
                  <Text type="supporting" color="secondary" className="text-[10px]">{editorMessage("editor.sync.subdivision")}</Text>
                  <div className="flex gap-1">
                    {([1, 2, 4] as const).map((sub) => (
                      <Button
                        key={sub}
                        label={`1/${sub}`}
                        variant={config.beatSubdivision === sub ? "primary" : "secondary"}
                        size="sm"
                        onClick={() => handleUpdateConfig({ beatSubdivision: sub })}
                      />
                    ))}
                  </div>
                </div>}

                <PropertySlider
                  label={editorMessage("editor.sync.offset")}
                  value={config.offsetMs}
                  onChange={(value: number) => handleUpdateConfig({ offsetMs: value })}
                  min={-500}
                  max={500}
                  step={10}
                  formatValue={(value) => `${Math.round(value)} ms`}
                />

                {config.syncMode !== "cut-to-beats" && <div className="flex items-center justify-between gap-2">
                  <Text type="supporting" color="secondary" className="text-[10px]">{editorMessage("editor.sync.downbeatsOnly")}</Text>
                  <div className="flex gap-1">
                    <Button
                      label={editorMessage("editor.sync.all")}
                      variant={!config.snapToDownbeats ? "primary" : "secondary"}
                      size="sm"
                      onClick={() => handleUpdateConfig({ snapToDownbeats: false })}
                    />
                    <Button
                      label={editorMessage("editor.sync.downbeats")}
                      variant={config.snapToDownbeats ? "primary" : "secondary"}
                      size="sm"
                      onClick={() => handleUpdateConfig({ snapToDownbeats: true })}
                    />
                  </div>
                </div>}
              </Card>
            )}
          </div>

          {previewTimings.length > 0 && (
            <div className="space-y-2">
              <Text type="supporting" color="secondary" className="text-[9px]">{editorMessage("editor.sync.preview")}</Text>
              <Card variant="muted" padding={2} className="max-h-24 overflow-y-auto space-y-1">
                {previewTimings.slice(0, 5).map((timing, idx) => (
                  <div
                    key={timing.clipId}
                    className="flex items-center justify-between text-[9px]"
                  >
                    <Text type="supporting" color="secondary" className="text-[9px]">
                      {editorMessage("editor.sync.previewClip", { index: idx + 1 })}
                    </Text>
                    <Text type="supporting" color="primary" className="text-[9px]">
                      {timing.newStartTime.toFixed(2)}s – {(timing.newStartTime + timing.newDuration).toFixed(2)}s
                    </Text>
                  </div>
                ))}
                {previewTimings.length > 5 && (
                  <Text type="supporting" color="secondary" className="text-[9px]">
                    {editorMessage("editor.sync.more", { count: previewTimings.length - 5 })}
                  </Text>
                )}
              </Card>
            </div>
          )}

          {progress?.phase === "complete" && (
            <Card
              variant="green"
              padding={2}
              className="flex items-center gap-2 border border-green-500/30"
            >
              <Check size={14} className="text-green-400" aria-hidden />
              <Text type="supporting" className="text-[10px] text-green-400">
                {progress.message}
              </Text>
            </Card>
          )}

          <Button
            label={
              isProcessing
                ? editorMessage("editor.sync.syncing")
                : config.syncMode === "cut-to-beats"
                  ? editorMessage("editor.sync.applyCuts", { count: previewTimings.length })
                  : editorMessage("editor.sync.applySync", { count: previewTimings.length })
            }
            icon={
              isProcessing ? (
                <Loader2 size={14} className="animate-spin" aria-hidden />
              ) : undefined
            }
            variant="primary"
            size="sm"
            onClick={handleApply}
            isDisabled={isProcessing || previewTimings.length === 0}
            isLoading={isProcessing}
            className="w-full"
          />

          <Button
            isDisabled={isProcessing}
            label={editorMessage("editor.sync.reanalyze")}
            variant="secondary"
            size="sm"
            onClick={handleAnalyzeBeats}
            className="w-full"
          />
        </div>
      )}
    </fieldset>
  );
};
