import "../../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BACKGROUND_SETTINGS, type Clip } from "@openreel/core";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { useProjectStore } from "../../../stores/project-store";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { PiPSection } from "./PiPSection";
import { BackgroundRemovalSection } from "./BackgroundRemovalSection";
const engine = vi.hoisted(() => ({ getSettings: vi.fn(), isInitialized: vi.fn(() => true), setSettings: vi.fn(), setBackgroundImage: vi.fn() }));
vi.mock("@openreel/core", async (original) => ({ ...await original<typeof import("@openreel/core")>(), getBackgroundRemovalEngine: () => engine }));

describe.each(["en-US", "zh-CN"] as const)("picture and background (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => {
    configureShotloomLocale(locale); vi.clearAllMocks();
    engine.getSettings.mockReturnValue({ ...DEFAULT_BACKGROUND_SETTINGS, enabled: true });
    const project = createEmptyProject("Original project");
    const clip: Clip = { id: "clip", mediaId: "media", trackId: "track", startTime: 0, inPoint: 0, outPoint: 5, duration: 5, effects: [], audioEffects: [], keyframes: [], volume: 1, transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, anchor: { x: 0.5, y: 0.5 } } };
    useProjectStore.setState({ hasOpenProject: true, project: { ...project, timeline: { ...project.timeline, tracks: [{ id: "track", name: "Original track", type: "video", clips: [clip], transitions: [], muted: false, solo: false, locked: false, hidden: false }] } } });
  });
  afterEach(() => { cleanup(); configureShotloomLocale("en-US"); });

  it("applies named presets and resets the actual clip transform", async () => {
    render(<PiPSection clipId="clip" />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: ui("Top Left", "左上角") })); });
    expect(useProjectStore.getState().getClip("clip")?.transform).toMatchObject({ position: { x: -0.35, y: -0.35 }, scale: { x: 0.3, y: 0.3 } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: ui("Split Right", "右半屏") })); });
    expect(useProjectStore.getState().getClip("clip")?.transform).toMatchObject({ position: { x: 0.25, y: 0 }, scale: { x: 0.5, y: 1 } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: ui("Reset to Default", "恢复默认") })); });
    expect(useProjectStore.getState().getClip("clip")?.transform).toMatchObject({ position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, borderRadius: 0, opacity: 1 });
  });

  it("updates uniform scale using translated advanced controls", async () => {
    render(<PiPSection clipId="clip" />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: ui("Show Advanced Controls", "显示高级控制") })); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: ui("Edit Uniform Scale value", "编辑等比缩放数值") })); });
    const input = screen.getByRole("textbox", { name: ui("Uniform Scale value", "等比缩放数值") });
    await act(async () => { fireEvent.change(input, { target: { value: "0.6" } }); });
    await act(async () => { fireEvent.keyDown(input, { key: "Enter" }); });
    expect(useProjectStore.getState().getClip("clip")?.transform.scale).toEqual({ x: 0.6, y: 0.6 });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: ui("Hide Advanced Controls", "隐藏高级控制") })); });
    expect(screen.queryByText(ui("Uniform Scale", "等比缩放"))).not.toBeInTheDocument();
  });

  it("submits original background mode, color and fractional threshold", async () => {
    const change = vi.fn();
    render(<BackgroundRemovalSection clipId="clip" onSettingsChange={change} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: ui("Color background mode", "纯色背景模式") })); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: ui("Use #ff0000 background color", "使用 #ff0000 背景颜色") })); });
    expect(engine.setSettings).toHaveBeenLastCalledWith("clip", expect.objectContaining({ mode: "color", backgroundColor: "#ff0000" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: ui("Edit Detection Threshold value", "编辑检测阈值数值") })); });
    const input = screen.getByRole("textbox", { name: ui("Detection Threshold value", "检测阈值数值") });
    await act(async () => { fireEvent.change(input, { target: { value: "70" } }); });
    await act(async () => { fireEvent.keyDown(input, { key: "Enter" }); });
    expect(change).toHaveBeenLastCalledWith(expect.objectContaining({ mode: "color", threshold: 0.7 }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: ui("Transparent background mode", "透明背景模式") })); });
    expect(engine.setSettings).toHaveBeenLastCalledWith("clip", expect.objectContaining({ mode: "transparent" }));
  });
});
