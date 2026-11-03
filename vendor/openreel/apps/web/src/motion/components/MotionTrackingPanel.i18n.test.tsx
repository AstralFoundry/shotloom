import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MotionComposition } from "@openreel/core";
import { configureShotloomLocale } from "../../shotloom-mode";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useNotificationStore } from "../../stores/notification-store";
import { useMotionStore } from "../stores/motion-store";
import { createMotionLayerOfType } from "../motion-layer-factory";
import { MotionTrackingPanel } from "./MotionTrackingPanel";
function composition(): MotionComposition {
  const base: MotionComposition = { id: "tracking", name: "Original", width: 1280, height: 720, frameRate: 30, duration: 5, backgroundColor: "#000000", layers: [], assets: [], variables: [], markers: [], createdAt: 1, modifiedAt: 1 };
  return { ...base, layers: [createMotionLayerOfType(base, "shape", { id: "shape" })] };
}
function stored() { return useProjectStore.getState().project.motionCompositions![0]; }
function mount() {
  const comp = composition();
  useProjectStore.setState({ hasOpenProject: true, project: { ...createEmptyProject("Tracking"), motionCompositions: [comp] } });
  const view = render(<MotionTrackingPanel composition={comp} embedded />);
  return () => view.rerender(<MotionTrackingPanel composition={stored()} embedded />);
}
describe.each(["en-US", "zh-CN"] as const)("MotionTrackingPanel (%s)", locale => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => { configureShotloomLocale(locale); useMotionStore.setState({ selectedLayerId: "shape", selectedLayerIds: ["shape"], playhead: 0 }); useNotificationStore.getState().clearAll(); });
  afterEach(() => { cleanup(); configureShotloomLocale("en-US"); useProjectStore.setState({ hasOpenProject: false }); useNotificationStore.getState().clearAll(); });
  it("creates translated track names and adds independent points", async () => {
    const refresh = mount();
    expect(screen.getByText(ui("No motion tracks", "暂无运动轨迹"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ui("Add Track", "添加轨迹") }));
    await waitFor(() => expect(stored().tracks).toHaveLength(1));
    expect(stored().tracks![0].name).toBe(ui("Track 1", "轨迹 1"));
    expect(stored().tracks![0].points[0].name).toBe(ui("Track Point 1", "跟踪点 1"));
    refresh();
    fireEvent.click(screen.getByRole("button", { name: ui("Add Point", "添加跟踪点") }));
    await waitFor(() => expect(stored().tracks![0].points).toHaveLength(2));
    expect(stored().tracks![0].points[1].name).toBe(ui("Track Point 2", "跟踪点 2"));
    expect(stored().tracks![0].points[1].id).not.toBe(stored().tracks![0].points[0].id);
  });
  it("samples and applies the track using the original keyframe properties", async () => {
    const refresh = mount();
    fireEvent.click(screen.getByRole("button", { name: ui("Add Track", "添加轨迹") }));
    await waitFor(() => expect(stored().tracks).toHaveLength(1));
    refresh();
    fireEvent.click(screen.getByRole("button", { name: ui("Add Frame At Playhead", "在播放头处添加采样帧") }));
    await waitFor(() => expect(stored().tracks![0].points[0].frames).toHaveLength(1));
    refresh();
    act(() => useMotionStore.setState({ playhead: 1 }));
    fireEvent.change(screen.getAllByRole("spinbutton")[1], { target: { value: "800" } });
    fireEvent.click(screen.getByRole("button", { name: ui("Add Frame At Playhead", "在播放头处添加采样帧") }));
    await waitFor(() => expect(stored().tracks![0].points[0].frames).toHaveLength(2));
    refresh();
    expect(screen.getByRole("option", { name: ui("Position, scale, rotation", "位置、缩放和旋转") })).toHaveValue("position-scale-rotation");
    fireEvent.click(screen.getByRole("button", { name: ui("Apply", "应用") }));
    await waitFor(() => expect(stored().layers[0].keyframes.length).toBeGreaterThan(0));
    expect(stored().layers[0].keyframes.map(k => k.property)).toContain("transform.position.x");
    expect(useMotionStore.getState().rightTab).toBe("graph");
  });
  it("shows a localized error when no video exists", async () => {
    const refresh = mount();
    fireEvent.click(screen.getByRole("button", { name: ui("Add Track", "添加轨迹") }));
    await waitFor(() => expect(stored().tracks).toHaveLength(1));
    refresh();
    fireEvent.click(screen.getByRole("button", { name: ui("Auto-Track From Video", "从视频自动跟踪") }));
    expect(useNotificationStore.getState().notifications.at(-1)).toMatchObject({ title: ui("No video source", "暂无视频来源"), message: ui("Import a video clip to auto-track from.", "导入视频片段以进行自动跟踪。") });
  });
});
