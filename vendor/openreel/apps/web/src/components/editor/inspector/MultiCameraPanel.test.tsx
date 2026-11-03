import "../../../test/install-local-storage-mock";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { analyzeSileroVad, ActionExecutor, multicamEngine, type Clip } from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { useEngineStore } from "../../../stores/engine-store";
import { useUIStore } from "../../../stores/ui-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { MultiCameraPanel, multicamCutReasonLabel } from "./MultiCameraPanel";
import { InspectorPanel } from "../InspectorPanel";

import { loadAudioBuffer } from "../../../utils/load-audio-buffer";
import { analyzeMulticamSyncInWorker } from "./multicam-workflow";
vi.mock("../../../utils/load-audio-buffer", () => ({ loadAudioBuffer: vi.fn() }));
vi.mock("../../../services/multicam-analysis-store", () => ({ saveMulticamArtifact: vi.fn().mockResolvedValue("artifact"), loadMulticamArtifact: vi.fn() }));
vi.mock("@openreel/core", async (original) => ({ ...await original<typeof import("@openreel/core")>(), analyzeSileroVad: vi.fn() }));
vi.mock("./multicam-workflow", async (original) => ({ ...await original<typeof import("./multicam-workflow")>(), analyzeMulticamSyncInWorker: vi.fn() }));

const clip = (id: string): Clip => ({
  id, mediaId: id, trackId: id, startTime: 2, duration: 8, inPoint: 1, outPoint: 9,
  effects: [], audioEffects: [], keyframes: [], volume: 1,
  transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 },
});
const store = () => useProjectStore.getState();
describe.each(["en-US", "zh-CN"] as const)("Multicam locale (%s)", (locale) => {
const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
beforeEach(() => {
  configureShotloomLocale(locale);
  vi.clearAllMocks();
  multicamEngine.loadGroups([]);
  const project = createEmptyProject("Multicam");
  useProjectStore.setState({ hasOpenProject: true, actionExecutor: new ActionExecutor(), project: {
    ...project,
    mediaLibrary: { items: ["Camera A", "Camera B"].map((id) => ({
      id, name: `${id}.mp4`, type: "video" as const, blob: null, fileHandle: null, thumbnailUrl: null, waveformData: null,
      metadata: { duration: 12, width: 1920, height: 1080, frameRate: 30, codec: "h264", sampleRate: 48000, channels: 2, fileSize: 1 },
    })) },
    timeline: { ...project.timeline, duration: 10, tracks: ["Camera A", "Camera B"].map((id) => ({
      id, name: id, type: "audio" as const, clips: [clip(id)], transitions: [], locked: false, hidden: false, muted: false, solo: false,
    })) },
  } });
  useUIStore.getState().clearSelection();
  useTimelineStore.setState({ playheadPosition: 5 });
});
afterEach(() => { cleanup(); configureShotloomLocale("en-US"); multicamEngine.loadGroups([]); useUIStore.getState().clearSelection(); });

async function createGroup() {
  render(<MultiCameraPanel />);
  fireEvent.click(screen.getByRole("checkbox", { name: "Camera A.mp4 Camera A" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Camera B.mp4 Camera B" }));
  const button = screen.getByRole("button", { name: ui("Create Group (2 selected)", "创建机位组（已选 2 个）") });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await waitFor(() => expect(store().project.multicamGroups).toHaveLength(1));
}

describe("multicam inspector workflow", () => {
  it("localizes policy controls while retaining stable option values", async () => {
    render(<MultiCameraPanel />);
    await act(async () => {});
    fireEvent.click(screen.getByText(ui("Automatic edit settings", "自动剪辑设置")));
    const preset = screen.getByRole("combobox", { name: ui("Preset", "预设") });
    fireEvent.change(preset, { target: { value: "energetic" } });
    expect(preset).toHaveValue("energetic");
    expect(screen.getByRole("option", { name: ui("Energetic", "活跃") })).toHaveValue("energetic");
    fireEvent.change(screen.getByRole("combobox", { name: ui("Overlapping speakers", "多人同时说话") }), { target: { value: "composite" } });
    expect(preset).toHaveValue("custom");
    expect(screen.getByRole("combobox", { name: ui("Overlapping speakers", "多人同时说话") })).toHaveValue("composite");
    expect(screen.getByRole("checkbox", { name: ui("Sync cameras before Auto Edit (turn off to use manual offsets)", "自动剪辑前同步机位（关闭后使用手动偏移）") })).toBeChecked();
    expect(screen.getByText("Camera A.mp4")).toBeInTheDocument();
  });
  it("translates known reasons and preserves unknown or authored values", () => {
    expect(multicamCutReasonLabel()).toBe(ui("manual", "手动"));
    expect(multicamCutReasonLabel("speaker")).toBe(ui("speaker", "说话人"));
    for (const value of ["Custom reason", "__proto__", "constructor"]) {
      expect(multicamCutReasonLabel(value)).toBe(value);
    }
  });
  it("shows the local media relink error in the selected language", async () => {
    await createGroup();
    fireEvent.click(screen.getByRole("button", { name: ui("Sync Audio", "同步音频") }));
    await waitFor(() => expect(screen.getByText(ui("Angle 1 needs its source media relinked.", "机位 1需要重新链接源素材。"))).toBeInTheDocument());
  });
  it("preserves user camera names through rename and group persistence", async () => {
    await createGroup();
    fireEvent.doubleClick(screen.getByText(ui("Angle 1", "机位 1")));
    const input = screen.getByRole("textbox", { name: ui("Camera angle name", "机位名称") });
    fireEvent.change(input, { target: { value: "My custom camera" } });
    fireEvent.blur(input);
    await waitFor(() => expect(store().project.multicamGroups?.[0]?.angles[0]?.name).toBe("My custom camera"));
    expect(screen.getByRole("button", { name: ui("Cut to My custom camera at playhead", "在播放头处切换到My custom camera") })).toBeInTheDocument();
  });
  it("selects each source once and creates an undoable persisted group", async () => {
    await createGroup();
    expect(store().project.multicamGroups?.[0]?.angles.map((angle) => angle.clipId)).toEqual(["Camera A", "Camera B"]);
    expect(await useEngineStore.getState().getMultiCamEngine()).toBe(multicamEngine);
    await act(async () => { await store().undo(); });
    expect(multicamEngine.getAllGroups()).toHaveLength(0);
    await act(async () => { await store().redo(); });
    expect(multicamEngine.getAllGroups()).toHaveLength(1);
  });
  it("writes an actual camera cut at the playhead with trimmed source mapping and one-step undo", async () => {
    await createGroup();
    fireEvent.click(screen.getByRole("button", { name: ui("Cut to Angle 2 at playhead", "在播放头处切换到机位 2") }));
    await waitFor(() => expect(store().project.timeline.tracks).toHaveLength(3));
    const output = store().project.timeline.tracks[0]!;
    expect(output.clips.map((entry) => [entry.mediaId, entry.startTime, entry.duration, entry.inPoint, entry.outPoint])).toEqual([
      ["Camera A", 2, 3, 1, 4], ["Camera B", 5, 5, 4, 9],
    ]);
    expect(store().project.timeline.tracks.slice(1).every((track) => track.hidden && track.muted)).toBe(true);
    await act(async () => { await store().undo(); });
    expect(store().project.timeline.tracks).toHaveLength(2);
    expect(store().project.timeline.tracks.every((track) => !track.hidden && !track.muted)).toBe(true);
    expect(multicamEngine.getAllGroups()[0]?.switches).toEqual([]);
  });
  it("creates a playable automatic edit through the decode, sync, analysis, and timeline workflow", async () => {
    const project = store().project;
    useProjectStore.setState({ project: { ...project, mediaLibrary: { items: project.mediaLibrary.items.map((media) => ({ ...media, blob: new Blob([media.id]) })) } } });
    let channel = 0;
    vi.mocked(loadAudioBuffer).mockImplementation(async () => {
      const index = channel++;
      const samples = Float32Array.from({ length: 24000 }, (_, sample) => {
        const speaking = index === 0 ? sample < 12000 : sample >= 12000;
        return Math.sin(sample * 0.2) * (speaking ? 0.5 : 0.001);
      });
      return { sampleRate: 2000, length: samples.length, duration: 12, numberOfChannels: 1, getChannelData: () => samples } as unknown as AudioBuffer;
    });
    vi.mocked(analyzeMulticamSyncInWorker).mockImplementation(async (buffers) => ({
      results: new Map([...buffers.keys()].map((id) => [id, { offset: 0, confidence: 1, method: "audio" as const }])), drift: {},
    }));
    vi.mocked(analyzeSileroVad).mockResolvedValue({ windowMs: 50, probabilities: new Float32Array(240).fill(0.99) });
    await createGroup();
    fireEvent.click(screen.getByRole("button", { name: ui("Auto Edit", "自动剪辑") }));
    await waitFor(() => expect(store().project.timeline.tracks.length).toBeGreaterThan(2));
    const group = store().project.multicamGroups![0]!;
    expect(group.shotPlan?.shots.length).toBeGreaterThan(0);
    expect(group.outputTrackId).toBeTruthy();
    const output = store().project.timeline.tracks.find((track) => track.id === group.outputTrackId)!;
    expect(output.hidden).toBe(false);
    expect(output.muted).toBe(false);
    expect(output.clips.every((entry) => entry.inPoint >= 1 && entry.outPoint <= 9 && entry.duration > 0)).toBe(true);
    await act(async () => { await store().undo(); });
    expect(store().project.timeline.tracks).toHaveLength(2);
    expect(store().project.multicamGroups![0]!.outputTrackId).toBeUndefined();
  });

  it("restores saved groups when the panel opens and clears them for another project", async () => {
    await createGroup();
    const saved = structuredClone(store().project);
    cleanup();
    multicamEngine.loadGroups([]);
    store().loadProject(saved);
    render(<MultiCameraPanel />);
    await waitFor(() => expect(screen.getByRole("button", { name: ui("Multi-Cam 1", "多机位 1") })).toBeInTheDocument());
    await act(async () => { store().loadProject(createEmptyProject("Next project")); });
    expect(multicamEngine.getAllGroups()).toEqual([]);
    expect(screen.queryByRole("button", { name: ui("Multi-Cam 1", "多机位 1") })).not.toBeInTheDocument();
  });
  it("is discoverable in the inspector with no selection and preselects timeline cameras when opened", async () => {
    useUIStore.getState().selectMultiple(["Camera A", "Camera B"].map((id) => ({ type: "clip", id, trackId: id })));
    render(<InspectorPanel />);
    fireEvent.click(screen.getByRole("button", { name: ui("Expand Multi-Camera Editing section", "展开多机位剪辑区域") }));
    await waitFor(() => expect(screen.getByRole("button", { name: ui("Create Group (2 selected)", "创建机位组（已选 2 个）") })).toBeEnabled());
    await act(async () => { useUIStore.getState().clearSelection(); });
    expect(screen.getByRole("button", { name: ui("Collapse Multi-Camera Editing section", "收起多机位剪辑区域") })).toBeInTheDocument();
  });
});
});
