import "../../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureShotloomLocale } from "../../../shotloom-mode";
import type { MotionTrackingState } from "../../../bridges/motion-tracking-bridge";
import { MotionTrackingSection } from "./MotionTrackingSection";
const fixture = vi.hoisted(() => ({ listener: null as null | ((state: MotionTrackingState) => void), state: {} as MotionTrackingState, start: vi.fn(), cancel: vi.fn(), apply: vi.fn(() => true), scale: vi.fn(), rotation: vi.fn(), remove: vi.fn(), offset: vi.fn() }));
vi.mock("../../../bridges/motion-tracking-bridge", () => {
  const bridge = {
    subscribe: (listener: (state: MotionTrackingState) => void) => { fixture.listener = listener; listener(fixture.state); return () => { fixture.listener = null; }; },
    getTrackingDataForClip: () => [], hasTrackingData: () => false,
    startTracking: fixture.start, cancelTracking: fixture.cancel, applyTrackingToClip: fixture.apply,
    setApplyScale: fixture.scale, setApplyRotation: fixture.rotation, removeAttachment: fixture.remove, setTrackingOffset: fixture.offset,
  };
  return { getMotionTrackingBridge: () => bridge };
});
describe.each(["en-US", "zh-CN"] as const)("motion tracking (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => { configureShotloomLocale(locale); vi.clearAllMocks(); fixture.state = { isTracking: false, progress: 0, currentJob: null, trackingData: null, lostFrames: [], error: null }; });
  afterEach(() => { cleanup(); configureShotloomLocale("en-US"); });
  it("submits original algorithms, region and normalized confidence", async () => {
    render(<MotionTrackingSection clipId="original-clip" />);
    fireEvent.click(screen.getByRole("button", { name: ui("Advanced Options", "高级选项") }));
    fireEvent.click(screen.getByRole("button", { name: ui("Edit Confidence Threshold value", "编辑置信度阈值数值") }));
    const input = screen.getByRole("textbox", { name: ui("Confidence Threshold value", "置信度阈值数值") });
    fireEvent.change(input, { target: { value: "85" } }); fireEvent.keyDown(input, { key: "Enter" });
    for (const [id, en, zh] of [
      ["correlation", "Correlation: Best for high-contrast objects", "相关性：适合高对比度物体"],
      ["optical-flow", "Optical Flow: Good for smooth motion", "光流：适合平滑运动"],
      ["feature", "Feature Match: Works with complex textures", "特征匹配：适合复杂纹理"],
    ]) {
      fireEvent.click(screen.getByRole("button", { name: ui(en, zh) }));
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: ui("Start Tracking", "开始跟踪") })); });
      expect(fixture.start).toHaveBeenLastCalledWith("original-clip", { x: 100, y: 100, width: 200, height: 200 }, expect.objectContaining({ algorithm: id, confidenceThreshold: 0.85 }));
    }
  });
  it("shows progress and original error details and cancels the actual job", () => {
    render(<MotionTrackingSection clipId="original-clip" />);
    act(() => fixture.listener!({ ...fixture.state, isTracking: true, progress: 42, lostFrames: [1, 3], error: "Original failure {name}", currentJob: { id: "original-job", clipId: "original-clip", region: { x: 0, y: 0, width: 2, height: 2 }, status: "running", progress: 42, options: {}, startTime: 0 } }));
    expect(screen.getByText(ui("Tracking in Progress", "正在跟踪"))).toBeInTheDocument();
    expect(screen.getByText("42%")).toBeInTheDocument();
    expect(screen.getByText("Original failure {name}")).toBeInTheDocument();
    expect(screen.getByText(ui("Tracking Failed", "跟踪失败"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ui("Cancel Tracking", "取消跟踪") }));
    expect(fixture.cancel).toHaveBeenCalledWith("original-job");
  });
  it("applies and removes tracking using original clip and transform flags", () => {
    fixture.state.trackingData = { trackId: "original-track", clipId: "original-clip", keyframes: [], confidence: [], lostFrames: [], region: { x: 0, y: 0, width: 2, height: 2 }, frameRate: 30 };
    render(<MotionTrackingSection clipId="original-clip" />);
    expect(screen.getByText(ui("Tracking Complete", "跟踪完成"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: ui("Scale", "缩放") }));
    fireEvent.click(screen.getByRole("button", { name: ui("Apply Tracking to Clip", "将跟踪应用到片段") }));
    expect(fixture.apply).toHaveBeenCalledWith("original-clip", { x: 0, y: 0 });
    expect(fixture.scale).toHaveBeenCalledWith("original-clip", false);
    expect(fixture.rotation).toHaveBeenCalledWith("original-clip", true);
    expect(screen.getByText(ui("Tracking Applied", "已应用跟踪"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ui("Remove Tracking", "移除跟踪") }));
    expect(fixture.remove).toHaveBeenCalledWith("original-clip");
  });
});
