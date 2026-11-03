import "../../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getBeatDetectionEngine, type Clip, type MediaItem } from "@openreel/core";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import { getBeatSyncBridge } from "../../../bridges/beat-sync-bridge";
import { BeatSyncSection } from "./BeatSyncSection";

const clip: Clip = { id: "beat-clip", mediaId: "user-audio", trackId: "track", startTime: 3, duration: 8, inPoint: 0, outPoint: 8, effects: [], audioEffects: [], keyframes: [], volume: 1, transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, anchor: { x: 0.5, y: 0.5 } } };
const media: MediaItem = { id: "user-audio", name: "我的音乐.wav", type: "audio", fileHandle: null, blob: new Blob(["audio"]), thumbnailUrl: null, waveformData: null, metadata: { duration: 8, width: 0, height: 0, frameRate: 0, codec: "wav", sampleRate: 48000, channels: 2, fileSize: 5 } };

describe.each(["en-US", "zh-CN"] as const)("beat sync localization (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => {
    configureShotloomLocale(locale);
    getBeatSyncBridge().clearBeatMarkers();
    const project = createEmptyProject("User project");
    useProjectStore.setState({ hasOpenProject: true, project: { ...project, mediaLibrary: { ...project.mediaLibrary, items: [media] }, timeline: { ...project.timeline, duration: 11, tracks: [{ id: "track", name: "Original track", type: "audio", clips: [structuredClone(clip)], transitions: [], locked: false, hidden: false, muted: false, solo: false }] } } });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); getBeatSyncBridge().clearBeatMarkers(); configureShotloomLocale("en-US"); useProjectStore.setState({ hasOpenProject: false }); });

  it("generates and clears real manual beat grids using the original BPM values", () => {
    render(<BeatSyncSection clipId={clip.id} />);
    fireEvent.click(screen.getByRole("button", { name: ui("Show Manual BPM Settings", "展开手动 BPM 设置") }));
    expect(screen.getByRole("spinbutton", { name: ui("Manual BPM", "手动 BPM") })).toBeInTheDocument();
    for (const bpm of [80, 100, 120, 140]) {
      fireEvent.click(screen.getByRole("checkbox", { name: `${bpm} BPM` }));
      fireEvent.click(screen.getByRole("button", { name: ui(`Generate Beat Grid at ${bpm} BPM`, `以 ${bpm} BPM 生成节拍网格`) }));
      const state = getBeatSyncBridge().getState();
      expect(state.beatAnalysis?.bpm).toBe(bpm);
      expect(state.beatMarkers[1].time).toBe(60 / bpm);
      expect(state.beatMarkers.every(b => b.time < clip.duration)).toBe(true);
      expect(screen.getByText(ui("Detected BPM", "检测到的 BPM"))).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: ui("Clear Beat Markers", "清除节拍标记") }));
    expect(getBeatSyncBridge().getState().beatMarkers).toEqual([]);
    expect(useProjectStore.getState().getMediaItem(media.id)?.name).toBe(media.name);
  });

  it("displays analysis progress and preserves the original blob and source clip", async () => {
    let finish!: (result: { bpm: number; confidence: number; beats: { time: number; strength: number; index: number }[]; duration: number; downbeats: number[] }) => void;
    const analyze = vi.spyOn(getBeatDetectionEngine(), "analyzeFromBlob").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(<BeatSyncSection clipId={clip.id} />);
    fireEvent.click(screen.getByRole("button", { name: ui("Detect Beats from Audio", "从音频检测节拍") }));
    expect(screen.getByText(ui("Analyzing beats...", "正在分析节拍…"))).toBeInTheDocument();
    expect(analyze).toHaveBeenCalledWith(media.blob);
    await act(async () => finish({ bpm: 110, confidence: 0.87, beats: [{ time: 0.5, strength: 1, index: 0 }], duration: 8, downbeats: [0.5] }));
    expect(screen.getByText("87%")).toBeInTheDocument();
    expect(getBeatSyncBridge().getState().beatAnalysis?.sourceClipId).toBe(clip.id);
  });

  it("keeps upstream error details and localizes only its own failure fallback", async () => {
    const analyze = vi.spyOn(getBeatDetectionEngine(), "analyzeFromBlob").mockRejectedValue(new Error("decoder: 我的音乐.wav"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<BeatSyncSection clipId={clip.id} />);
    const detect = () => screen.getByRole("button", { name: ui("Detect Beats from Audio", "从音频检测节拍") });
    fireEvent.click(detect());
    await waitFor(() => expect(screen.getByText("decoder: 我的音乐.wav")).toBeInTheDocument());
    analyze.mockRejectedValue(null);
    fireEvent.click(detect());
    await waitFor(() => expect(screen.getByText(ui("Beat analysis failed", "节拍分析失败"))).toBeInTheDocument());
  });

  it("shows localized missing clip guidance without initializing analysis", () => {
    render(<BeatSyncSection clipId="missing" />);
    expect(screen.getByText(ui("No clip selected", "未选择片段"))).toBeInTheDocument();
    expect(getBeatSyncBridge().getState().beatMarkers).toEqual([]);
  });
});
