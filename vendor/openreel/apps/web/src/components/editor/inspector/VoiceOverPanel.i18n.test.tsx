import "../../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaItem } from "@openreel/core";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { VoiceOverPanel } from "./VoiceOverPanel";
class Recorder {
  static isTypeSupported = () => true;
  static current: Recorder;
  state = "inactive";
  ondataavailable?: (event: { data: Blob }) => void;
  onstop?: () => void;
  onerror?: () => void;
  constructor(public stream: unknown, public options: unknown) { Recorder.current = this; }
  start = vi.fn(() => { this.state = "recording"; });
  stop = vi.fn(() => { this.state = "inactive"; this.ondataavailable?.({ data: new Blob(["audio bytes"]) }); this.onstop?.(); });
}
describe.each(["en-US", "zh-CN"] as const)("voice-over UI (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  const trackStop = vi.fn();
  let mediaAccess: ReturnType<typeof vi.fn>;
  const original = { importMedia: useProjectStore.getState().importMedia, addClipToNewTrack: useProjectStore.getState().addClipToNewTrack, renameTrack: useProjectStore.getState().renameTrack };
  beforeEach(() => {
    configureShotloomLocale(locale); vi.clearAllMocks();
    vi.stubGlobal("MediaRecorder", Recorder);
    mediaAccess = vi.fn().mockResolvedValue({ getTracks: () => [{ stop: trackStop }] });
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: mediaAccess } });
    useProjectStore.setState({ hasOpenProject: true, project: createEmptyProject("User project") });
    useTimelineStore.setState({ playheadPosition: 2.5 });
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); configureShotloomLocale("en-US"); useProjectStore.setState({ ...original, hasOpenProject: false, project: createEmptyProject("Reset") }); });
  it("translates denied microphone access and preserves upstream failures", async () => {
    mediaAccess.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));
    render(<VoiceOverPanel />);
    fireEvent.click(screen.getByRole("button", { name: ui("Record Voice Over", "录制配音") }));
    expect(await screen.findByText(ui("Allow microphone access to record a voice over.", "请允许访问麦克风以录制配音。"))).toBeInTheDocument();
    mediaAccess.mockRejectedValueOnce(new Error("upstream microphone detail {name}"));
    fireEvent.click(screen.getByRole("button", { name: ui("Record Voice Over", "录制配音") }));
    expect(await screen.findByText("upstream microphone detail {name}")).toBeInTheDocument();
  });
  it("records with the original format and adds audio at the captured playhead", async () => {
    const importMedia = vi.fn(async (_file: File) => {
      useProjectStore.setState(state => ({ project: { ...state.project, mediaLibrary: { ...state.project.mediaLibrary, items: [{ id: "recorded-media" } as MediaItem] } } }));
      return { success: true };
    });
    const add = vi.fn(async (mediaId: string, startTime = 0) => {
      useProjectStore.setState(state => ({ project: { ...state.project, timeline: { ...state.project.timeline, tracks: [{
        id: "recording-track", name: "Audio", type: "audio", transitions: [], muted: false, solo: false, hidden: false, locked: false,
        clips: [{ id: "recording-clip", mediaId, trackId: "recording-track", startTime, duration: 1, inPoint: 0, outPoint: 1, effects: [], audioEffects: [], keyframes: [], volume: 1,
          transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, anchor: { x: 0.5, y: 0.5 } } }],
      }] } } }));
      return { success: true };
    });
    useProjectStore.setState({ importMedia, addClipToNewTrack: add });
    render(<VoiceOverPanel />);
    fireEvent.click(screen.getByRole("button", { name: ui("Record Voice Over", "录制配音") }));
    await screen.findByRole("button", { name: ui("Stop & Add to Timeline", "停止并添加到时间线") });
    expect(Recorder.current.options).toEqual({ mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 128000 });
    expect(mediaAccess).toHaveBeenCalledWith({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    act(() => useTimelineStore.setState({ playheadPosition: 9 }));
    fireEvent.click(screen.getByRole("button", { name: ui("Stop & Add to Timeline", "停止并添加到时间线") }));
    await waitFor(() => expect(add).toHaveBeenCalledWith("recorded-media", 2.5));
    await waitFor(() => expect(useProjectStore.getState().project.timeline.tracks[0]?.name).toBe(ui("Voice Over", "配音")));
    const file = importMedia.mock.calls[0][0];
    expect(file.name.startsWith(ui("Voice-over ", "配音 "))).toBe(true);
    expect(file.name.endsWith(".webm")).toBe(true); expect(file.type).toBe("audio/webm;codecs=opus"); expect(file.size).toBeGreaterThan(0);
    expect(trackStop).toHaveBeenCalledOnce();
  });
});
