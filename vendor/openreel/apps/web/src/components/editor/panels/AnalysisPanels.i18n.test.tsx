import "../../../test/install-local-storage-mock";
import { cleanup, fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@openreel/core";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { AutoEditPanel } from "./AutoEditPanel";
import { HighlightExtractorPanel } from "./HighlightExtractorPanel";

const mocks = vi.hoisted(() => ({ analyze: vi.fn(), cuts: vi.fn(), highlights: vi.fn(), apply: vi.fn() }));
vi.mock("@openreel/core", async importOriginal => ({
  ...await importOriginal<typeof import("@openreel/core")>(),
  getBeatDetectionEngine: () => ({ analyzeFromBlob: mocks.analyze }),
  getAutoEditService: () => ({ generateCuts: mocks.cuts }),
}));
vi.mock("../../../services/highlight-service", () => ({ extractHighlights: mocks.highlights }));
vi.mock("../../../services/highlight-apply", () => ({ applyHighlightRanges: mocks.apply }));

function projectWithClip(): Project {
  const project = createEmptyProject("Adjustment workflow");
  return {
    ...project,
    mediaLibrary: { items: [{ id: "media-1", name: "Original.mp4", type: "video", blob: new Blob(["video"]), fileHandle: null, waveformData: null, thumbnailUrl: null, metadata: { duration: 4, width: 1920, height: 1080, frameRate: 30, codec: "h264", sampleRate: 48000, channels: 2, fileSize: 5 } }] },
    timeline: {
      ...project.timeline,
      duration: 8,
      tracks: [{
        id: "video-track",
        type: "video",
        name: "Video",
        locked: false,
        hidden: false,
        muted: false,
        solo: false,
        transitions: [],
        clips: [{
          id: "clip-1",
          mediaId: "media-1",
          trackId: "video-track",
          startTime: 1,
          duration: 4,
          inPoint: 0,
          outPoint: 4,
          transform: {
            position: { x: 0, y: 0 },
            scale: { x: 1, y: 1 },
            rotation: 0,
            anchor: { x: 0.5, y: 0.5 },
            opacity: 1,
          },
          effects: [],
          audioEffects: [],
          volume: 1,
          keyframes: [],
        }],
      }],
    },
  };
}


describe.each(["en-US", "zh-CN"] as const)("Analysis panel text (%s)", locale => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => {
    configureShotloomLocale(locale); vi.clearAllMocks();
    const project = projectWithClip();
    Object.defineProperty(project.mediaLibrary.items[0].blob, "arrayBuffer", { value: async () => new ArrayBuffer(4) });
    useProjectStore.setState({ project, hasOpenProject: true });
    mocks.analyze.mockResolvedValue({ bpm: 120, confidence: 1, beats: [], duration: 4, downbeats: [] });
    mocks.cuts.mockReturnValue({ cuts: [{ sourceClipId: "clip-1", startTime: 0, duration: 2, inPoint: 1, outPoint: 3 }], totalDuration: 2 });
    mocks.highlights.mockResolvedValue([{ start: 1, end: 3, score: 9, title: "User {name} title", reason: "Original reason" }]);
    mocks.apply.mockResolvedValue(undefined);
  });
  afterEach(() => {
    cleanup(); configureShotloomLocale("en-US");
    useProjectStore.setState({ hasOpenProject: false });
  });
  it("submits each original cut mode and applies actual clip timing to the project store", async () => {
    const close = vi.fn();
    render(<AutoEditPanel onClose={close} />);
    expect(screen.getByRole("combobox", { name: ui("Audio Source", "音频来源") })).toHaveValue("clip-1");
    for (const [mode, en, zh] of [["beats", "Beats", "节拍"], ["downbeats", "Downbeats", "重拍"], ["segments", "Segments", "段落"]]) {
      fireEvent.click(screen.getByRole("radio", { name: ui(en, zh) }));
      fireEvent.click(screen.getByRole("button", { name: ui("Generate Auto-Edit", "生成自动剪辑") }));
      await waitFor(() => expect(mocks.cuts).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ cutMode: mode, sensitivity: 0.5, minClipDuration: 0.5 })));
    }
    fireEvent.click(screen.getByRole("button", { name: ui("Apply Auto-Edit", "应用自动剪辑") }));
    const clip = useProjectStore.getState().project.timeline.tracks[0].clips[0];
    expect(clip).toMatchObject({ mediaId: "media-1", startTime: 0, duration: 2, inPoint: 1, outPoint: 3 });
    expect(close).toHaveBeenCalledOnce();
  });
  it("explains missing audio and preserves analyzer error details", async () => {
    const { rerender } = render(<AutoEditPanel onClose={vi.fn()} />);
    mocks.analyze.mockRejectedValueOnce(new Error("Decode {name} $& failed"));
    fireEvent.click(screen.getByRole("button", { name: ui("Generate Auto-Edit", "生成自动剪辑") }));
    expect(await screen.findByText("Decode {name} $& failed")).toBeInTheDocument();
    act(() => useProjectStore.setState({ project: createEmptyProject("No audio") }));
    rerender(<AutoEditPanel onClose={vi.fn()} />);
    expect(screen.getByText(ui("Add an audio track to use auto-edit", "添加音频轨道以使用自动剪辑"))).toBeInTheDocument();
  });
  it("preserves highlight content and submits its exact range", async () => {
    render(<HighlightExtractorPanel clipId="clip-1" />);
    fireEvent.click(screen.getByRole("button", { name: ui("Find Highlights", "查找精彩片段") }));
    expect(await screen.findByText("User {name} title")).toBeInTheDocument();
    expect(screen.getByText("Original reason")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ui("Preview highlight", "预览精彩片段") }));
    expect(useTimelineStore.getState().playheadPosition).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: ui("Apply 1 Highlight", "应用 1 个精彩片段") }));
    expect(mocks.apply).toHaveBeenCalledWith("clip-1", [{ start: 1, end: 3 }]);
    expect(mocks.highlights).toHaveBeenCalledWith(expect.anything(), [], expect.objectContaining({ targetClipCount: 5, maxClipDuration: 60 }), expect.any(Function));
  });
  it("uses the service progress message rather than its protocol phase identifier", async () => {
    let finish!: (results: []) => void;
    mocks.highlights.mockImplementation((_audio, _words, _prefs, progress) => {
      progress("rank", 35, "Translated service message");
      return new Promise(resolve => { finish = resolve; });
    });
    render(<HighlightExtractorPanel clipId="clip-1" />);
    fireEvent.click(screen.getByRole("button", { name: ui("Find Highlights", "查找精彩片段") }));
    await waitFor(() => expect(screen.getByRole("button", { name: ui("Translated service message (35%)", "Translated service message（35%）") })).toBeDisabled());
    await act(async () => finish([]));
    expect(screen.getByRole("button", { name: ui("Find Highlights", "查找精彩片段") })).toBeEnabled();
  });
  it("updates singular, plural and empty highlight selection labels", async () => {
    mocks.highlights.mockResolvedValue([
      { start: 1, end: 2, score: 8, title: "First", reason: "Reason" },
      { start: 2, end: 3, score: 9, title: "Second", reason: "Reason" },
    ]);
    render(<HighlightExtractorPanel clipId="clip-1" />);
    fireEvent.click(screen.getByRole("button", { name: ui("Find Highlights", "查找精彩片段") }));
    const apply = await screen.findByRole("button", { name: ui("Apply 2 Highlights", "应用 2 个精彩片段") });
    fireEvent.click(apply);
    expect(mocks.apply).toHaveBeenCalledWith("clip-1", [{ start: 1, end: 2 }, { start: 2, end: 3 }]);
    fireEvent.click(screen.getByText("First"));
    expect(screen.getByRole("button", { name: ui("Apply 1 Highlight", "应用 1 个精彩片段") })).toBeEnabled();
    fireEvent.click(screen.getByText("Second"));
    expect(screen.getByRole("button", { name: ui("Apply 0 Highlights", "应用 0 个精彩片段") })).toBeDisabled();
  });
  it("translates missing highlight media and unknown analysis failures", async () => {
    const { unmount } = render(<HighlightExtractorPanel clipId="clip-1" />);
    mocks.highlights.mockRejectedValueOnce(null);
    fireEvent.click(screen.getByRole("button", { name: ui("Find Highlights", "查找精彩片段") }));
    expect(await screen.findByText(ui("Analysis failed", "分析失败"))).toBeInTheDocument();
    unmount();
    const project = projectWithClip();
    useProjectStore.setState({ project: { ...project, mediaLibrary: { items: [{ ...project.mediaLibrary.items[0], blob: null }] } } });
    render(<HighlightExtractorPanel clipId="clip-1" />);
    fireEvent.click(screen.getByRole("button", { name: ui("Find Highlights", "查找精彩片段") }));
    expect(screen.getByText(ui("Media not found or not loaded", "媒体不存在或尚未加载"))).toBeInTheDocument();
  });

});
