import { editorMessage } from "../../shotloom-mode";
import React, { useEffect, useRef } from "react";
import {
  Monitor,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Camera,
  Circle,
  Settings,
  AlertCircle,
} from "@/icons/lucide-compat";
import { useRecorderStore } from "../../stores/recorder-store";
import {
  ScreenRecorderService,
  type VideoResolution,
  type FrameRate,
  type WebcamResolution,
} from "../../services/screen-recorder";
import { RecordingCountdown } from "./RecordingCountdown";
import { RecordingControls } from "./RecordingControls";
import { ToolcraftSwitchControl } from "@openreel/ui";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftDialog as Dialog, ToolcraftDialogHeader as DialogHeader } from "@openreel/ui";
import { ToolcraftLayout as Layout, ToolcraftLayoutContent as LayoutContent, ToolcraftLayoutFooter as LayoutFooter } from "@openreel/ui";
import { ToolcraftSelectableCard as SelectableCard } from "@openreel/ui";
import { ToolcraftSelectControl as Selector } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";

interface ScreenRecorderProps {
  isOpen: boolean;
  onClose: () => void;
  onRecordingComplete: (screenBlob: Blob, webcamBlob?: Blob) => void;
}

const getResolutionOptions = (): {
  value: VideoResolution;
  label: string;
  desc: string;
}[] => [
  { value: "720p", label: editorMessage("editor.recording.720label"), desc: editorMessage("editor.recording.720desc") },
  { value: "1080p", label: editorMessage("editor.recording.1080label"), desc: editorMessage("editor.recording.1080desc") },
  { value: "1440p", label: editorMessage("editor.recording.1440label"), desc: editorMessage("editor.recording.1440desc") },
  { value: "4k", label: editorMessage("editor.recording.4klabel"), desc: editorMessage("editor.recording.4kdesc") },
];

const FRAMERATE_OPTIONS: FrameRate[] = [30, 60];

const WEBCAM_RESOLUTION_OPTIONS: { value: WebcamResolution; label: string }[] =
  [
    { value: "480p", label: "480p" },
    { value: "720p", label: "720p" },
    { value: "1080p", label: "1080p" },
  ];

export const ScreenRecorder: React.FC<ScreenRecorderProps> = ({
  isOpen,
  onClose,
  onRecordingComplete,
}) => {
  const resolutionOptions = getResolutionOptions();
  const {
    status,
    options,
    webcamStream,
    error,
    setVideoOption,
    setAudioOption,
    setWebcamOption,
    requestPermissions,
    startRecording,
    stopRecording,
    cancelRecording,
    pauseRecording,
    resumeRecording,
    reset,
  } = useRecorderStore();

  const webcamVideoRef = useRef<HTMLVideoElement>(null);
  const isSupported = ScreenRecorderService.isSupported();
  const features = ScreenRecorderService.getSupportedFeatures();

  useEffect(() => {
    if (webcamVideoRef.current && webcamStream) {
      webcamVideoRef.current.srcObject = webcamStream;
    }
  }, [webcamStream]);

  useEffect(() => {
    if (!isOpen) {
      if (status === "idle" || status === "error") {
        reset();
      }
    }
  }, [isOpen, status, reset]);

  const handleStartRecording = async () => {
    const hasPermissions = await requestPermissions();
    if (hasPermissions) {
      await startRecording();
    }
  };

  const handleStopRecording = async () => {
    const result = await stopRecording();
    if (result) {
      onRecordingComplete(result.screenBlob, result.webcamBlob);
      onClose();
    }
  };

  const handleCancel = () => {
    cancelRecording();
    onClose();
  };

  if (!isOpen) return null;

  if (status === "countdown") {
    return <RecordingCountdown />;
  }

  if (status === "recording" || status === "paused") {
    return (
      <RecordingControls
        onStop={handleStopRecording}
        onPause={pauseRecording}
        onResume={resumeRecording}
        onCancel={handleCancel}
      />
    );
  }

  return (
    <Dialog isOpen onOpenChange={(open) => !open && handleCancel()} width={672} purpose="form">
      <Layout
        header={
          <DialogHeader
            title={editorMessage("editor.recording.title")}
            onOpenChange={(open) => !open && handleCancel()}
            startContent={<Circle size={20} className="text-error fill-error animate-pulse" aria-hidden />}
          />
        }
        content={
          <LayoutContent className="space-y-6">
          {!isSupported && (
            <Card variant="muted" padding={4} className="flex items-start gap-3 border border-error/30 bg-error/10">
              <AlertCircle
                size={20}
                className="text-error flex-shrink-0 mt-0.5"
                aria-hidden
              />
              <div>
                <Text type="body" weight="bold" display="block" className="text-error">
                  {editorMessage("editor.recording.unsupported")}
                </Text>
                <Text type="supporting" color="secondary" display="block" className="mt-1">
                  {editorMessage("editor.recording.unsupportedHint")}
                </Text>
              </div>
            </Card>
          )}

          {error && (
            <Card variant="muted" padding={4} className="flex items-start gap-3 border border-error/30 bg-error/10">
              <AlertCircle
                size={20}
                className="text-error flex-shrink-0 mt-0.5"
                aria-hidden
              />
              <div>
                <Text type="body" weight="bold" display="block" className="text-error">
                  {editorMessage("editor.recording.errorTitle")}
                </Text>
                <Text type="supporting" color="secondary" display="block" className="mt-1">
                  {error}
                </Text>
              </div>
            </Card>
          )}

          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Monitor size={16} aria-hidden />
              <Text type="body" weight="bold">
                {editorMessage("editor.recording.video")}
              </Text>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Selector
                  label={editorMessage("editor.recording.resolution")}
                  value={options.video.resolution}
                  onChange={(value) => setVideoOption("resolution", value as VideoResolution)}
                  isDisabled={!isSupported}
                  options={resolutionOptions.map((opt) => ({
                    value: opt.value,
                    label: opt.label,
                  }))}
                  size="sm"
                  width="100%"
                />
                <Text type="supporting" color="secondary" display="block" className="mt-1 text-[10px]">
                  {
                    resolutionOptions.find(
                      (o) => o.value === options.video.resolution,
                    )?.desc
                  }
                </Text>
              </div>

              <div>
                <Selector
                  label={editorMessage("editor.recording.frameRate")}
                  value={String(options.video.frameRate)}
                  onChange={(value) => setVideoOption("frameRate", parseInt(value, 10) as FrameRate)}
                  isDisabled={!isSupported}
                  options={FRAMERATE_OPTIONS.map((opt) => ({
                    value: String(opt),
                    label: editorMessage("editor.recording.fps", { rate: opt }),
                  }))}
                  size="sm"
                  width="100%"
                />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Settings size={16} aria-hidden />
              <Text type="body" weight="bold">
                {editorMessage("editor.recording.audio")}
              </Text>
            </div>

            <div className="flex gap-4">
              <SelectableCard
                label={editorMessage("editor.recording.systemAudio")}
                isSelected={options.audio.systemAudio}
                onChange={() => setAudioOption("systemAudio", !options.audio.systemAudio)}
                isDisabled={!isSupported || !features.systemAudio}
                padding={3}
                variant={options.audio.systemAudio ? "green" : "muted"}
                className="flex-1"
              >
                {options.audio.systemAudio ? (
                  <Volume2 size={18} aria-hidden />
                ) : (
                  <VolumeX size={18} aria-hidden />
                )}
                <Text type="body" className="ml-2 text-sm">
                  {editorMessage("editor.recording.systemAudio")}
                </Text>
              </SelectableCard>

              <SelectableCard
                label={editorMessage("editor.recording.microphone")}
                isSelected={options.audio.microphone}
                onChange={() => setAudioOption("microphone", !options.audio.microphone)}
                isDisabled={!isSupported}
                padding={3}
                variant={options.audio.microphone ? "green" : "muted"}
                className="flex-1"
              >
                {options.audio.microphone ? (
                  <Mic size={18} aria-hidden />
                ) : (
                  <MicOff size={18} aria-hidden />
                )}
                <Text type="body" className="ml-2 text-sm">
                  {editorMessage("editor.recording.microphone")}
                </Text>
              </SelectableCard>
            </div>

            {!features.systemAudio && (
              <Text type="supporting" color="secondary" display="block" className="text-[10px]">
                {editorMessage("editor.recording.systemAudioHint")}
              </Text>
            )}
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Camera size={16} aria-hidden />
                <Text type="body" weight="bold">
                  {editorMessage("editor.recording.webcam")}
                </Text>
              </div>
              <ToolcraftSwitchControl
                ariaLabel={editorMessage("editor.recording.webcamToggle")}
                checked={options.webcam.enabled}
                onCheckedChange={(enabled) => setWebcamOption("enabled", enabled)}
                disabled={!isSupported || !features.webcam}
                showLabel={false}
              />
            </div>

            {options.webcam.enabled && (
              <div className="flex gap-4">
                <div className="flex-1">
                  <Selector
                    label={editorMessage("editor.recording.webcamResolution")}
                    value={options.webcam.resolution}
                    onChange={(value) => setWebcamOption("resolution", value as WebcamResolution)}
                    options={WEBCAM_RESOLUTION_OPTIONS.map((opt) => ({
                      value: opt.value,
                      label: opt.label,
                    }))}
                    size="sm"
                    width="100%"
                  />
                </div>

                {webcamStream && (
                  <div className="w-32 h-24 bg-background-tertiary rounded-lg overflow-hidden border border-border">
                    <video
                      ref={webcamVideoRef}
                      autoPlay
                      muted
                      playsInline
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
              </div>
            )}

            <Text type="supporting" color="secondary" display="block" className="text-[10px]">
              {editorMessage("editor.recording.webcamHint")}
            </Text>
          </div>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider>
            <div className="flex items-center justify-between gap-4">
              <Text type="supporting" color="secondary" className="text-xs">
                {editorMessage("editor.recording.countdownHint")}
              </Text>

              <div className="flex gap-3">
                <Button
                  label={editorMessage("editor.recording.cancel")}
                  variant="ghost"
                  onClick={handleCancel}
                />
                <Button
                  label={status === "requesting" ? editorMessage("editor.recording.requesting") : editorMessage("editor.recording.start")}
                  variant="primary"
                  icon={
                    status === "requesting" ? (
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    ) : (
                      <Circle size={14} className="fill-current" aria-hidden />
                    )
                  }
                  onClick={handleStartRecording}
                  isDisabled={!isSupported || status === "requesting"}
                  className="bg-red-600 font-bold text-white hover:bg-red-700"
                />
              </div>
            </div>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
};
