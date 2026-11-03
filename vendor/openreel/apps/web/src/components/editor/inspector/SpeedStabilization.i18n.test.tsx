import "../../../test/install-local-storage-mock";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Clip } from "@openreel/core";
import { getSpeedEngine } from "@openreel/core";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { useProjectStore } from "../../../stores/project-store";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { SpeedSection } from "./SpeedSection";
import { StabilizationSection } from "./StabilizationSection";

const engine = vi.hoisted(() => ({
  hasStabilized: vi.fn(() => false), isLoaded: vi.fn(() => false),
  load: vi.fn(async (_progress?: unknown) => {}), stabilize: vi.fn(async (..._args: unknown[]) => {}),
  removeStabilized: vi.fn(),
}));
vi.mock("@openreel/core", async (original) => ({ ...await original<typeof import("@openreel/core")>(), getVidstabEngine: () => engine }));

describe.each(["en-US", "zh-CN"] as const)("speed and stabilization (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  let clip: Clip;
  beforeEach(() => {
    vi.clearAllMocks();
    configureShotloomLocale(locale);
    clip = { id: `clip-${locale}`, mediaId: "media", trackId: "track", startTime: 0, inPoint: 0, outPoint: 5, duration: 5, effects: [], audioEffects: [], keyframes: [], volume: 1, transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, anchor: { x: 0.5, y: 0.5 } } };
    getSpeedEngine().setClipSpeed(clip.id, 1, 5);
    getSpeedEngine().setReverse(clip.id, false, 5);
    const project = createEmptyProject("Original project");
    useProjectStore.setState({ hasOpenProject: true, project: { ...project, timeline: { ...project.timeline, tracks: [{ id: "track", name: "Original track", type: "video", clips: [clip], transitions: [], muted: false, solo: false, locked: false, hidden: false }] } } });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); configureShotloomLocale("en-US"); });

  it("writes numeric speed and reverse through the original actions", async () => {
    const execute = vi.spyOn(useProjectStore.getState(), "executeAction");
    render(<SpeedSection clip={clip} />);
    fireEvent.click(screen.getByRole("button", { name: ui("Set speed to 0.5×", "将速度设为 0.5×") }));
    expect(getSpeedEngine().getClipSpeed(clip.id)).toBe(0.5);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ type: "clip/setSpeed", params: { clipId: clip.id, speed: 0.5 } }));
    const custom = screen.getByRole("textbox", { name: ui("Custom Speed", "自定义速度") });
    fireEvent.change(custom, { target: { value: "0.75" } });
    fireEvent.blur(custom);
    expect(getSpeedEngine().getClipSpeed(clip.id)).toBe(0.75);
    fireEvent.click(screen.getByRole("button", { name: ui("Reverse Clip", "倒放片段") }));
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ type: "clip/setReverse", params: { clipId: clip.id, reversed: true } }));
    expect(screen.getByText(ui("Speed: 0.75× • Reversed", "速度：0.75× · 已倒放"))).toBeInTheDocument();
    await waitFor(() => expect(useProjectStore.getState().getClip(clip.id)?.speed).toBe(0.75));
  });

  it("updates smooth-motion quality with the untranslated enum", () => {
    getSpeedEngine().setClipSpeed(clip.id, 0.5, 5);
    const smooth = { ...clip, smoothSlowMo: true };
    render(<SpeedSection clip={smooth} />);
    fireEvent.change(screen.getByRole("combobox", { name: ui("Quality", "质量") }), { target: { value: "high" } });
    expect(useProjectStore.getState().getClip(clip.id)?.interpolationQuality).toBe("high");
    expect(screen.getByText(ui("Uses optical flow to generate smooth in-between frames", "使用光流生成平滑的中间帧"))).toBeInTheDocument();
  });

  it("shows a translated fallback and preserves upstream errors on retry", async () => {
    vi.spyOn(useProjectStore.getState(), "getMediaItem").mockReturnValue({ id: "media", blob: new Blob(["video"]) } as ReturnType<ReturnType<typeof useProjectStore.getState>["getMediaItem"]>);
    vi.spyOn(console, "error").mockImplementation(() => {});
    engine.load.mockRejectedValueOnce("unknown failure").mockRejectedValueOnce(new Error("original decoder detail"));
    render(<StabilizationSection clip={clip} />);
    const toggle = screen.getByRole("switch", { name: ui("Enable stabilization", "启用视频防抖") });
    fireEvent.click(toggle);
    expect(await screen.findByText(ui("Stabilization failed", "视频防抖失败"))).toBeInTheDocument();
    expect(toggle).not.toBeDisabled();
    expect(engine.stabilize).not.toHaveBeenCalled();
    fireEvent.click(toggle);
    expect(await screen.findByText("original decoder detail")).toBeInTheDocument();
    expect(toggle).not.toBeDisabled();
  });

  it("localizes stabilization controls while preserving the strength payload", async () => {
    const execute = vi.spyOn(useProjectStore.getState(), "executeAction");
    render(<StabilizationSection clip={clip} />);
    expect(screen.getByText(ui("First use requires a one-time download (~65 MB)", "首次使用需下载引擎（约 65 MB）"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ui("Edit Strength value", "编辑强度数值") }));
    fireEvent.change(screen.getByRole("textbox", { name: ui("Strength value", "强度数值") }), { target: { value: "75" } });
    fireEvent.keyDown(screen.getByRole("textbox", { name: ui("Strength value", "强度数值") }), { key: "Enter" });
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ type: "clip/setStabilization", params: { clipId: clip.id, stabilization: { enabled: false, strength: 75, cropMode: "auto", analyzed: false } } }));
    await waitFor(() => expect(useProjectStore.getState().getClip(clip.id)?.stabilization?.strength).toBe(75));
  });
});
