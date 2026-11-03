import { configureShotloomLocale } from "../../shotloom-mode";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { MotionComposition, MotionLayer } from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import { createMotionLayerOfType } from "../motion-layer-factory";
import { useMotionStore } from "../stores/motion-store";
import { StageCanvas } from "./StageCanvas";

function makeComposition(): MotionComposition {
  const base: MotionComposition = {
    id: "multi-selection",
    name: "Multi selection",
    width: 1280,
    height: 720,
    frameRate: 30,
    duration: 5,
    backgroundColor: "#111111",
    layers: [],
    assets: [],
    variables: [],
    markers: [],
    createdAt: 1,
    modifiedAt: 1,
  };
  const first = createMotionLayerOfType(base, "shape", { id: "shape-a" });
  const second = createMotionLayerOfType(base, "shape", { id: "shape-b" });
  return {
    ...base,
    layers: [
      {
        ...first,
        transform: {
          ...first.transform,
          position: { x: 320, y: 360 },
        },
      } as MotionLayer,
      {
        ...second,
        transform: {
          ...second.transform,
          position: { x: 800, y: 360 },
        },
      } as MotionLayer,
    ],
  };
}

describe.each(["en-US", "zh-CN"] as const)("StageCanvas multi-selection (%s)", locale => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  afterEach(() => { cleanup(); configureShotloomLocale("en-US"); });
  beforeEach(() => {
    configureShotloomLocale(locale);
    const composition = makeComposition();
    useProjectStore.setState({
      project: {
        ...useProjectStore.getState().project,
        motionCompositions: [composition],
      },
    } as never);
    useMotionStore.setState({
      activeCompositionId: composition.id,
      selectedLayerId: "shape-b",
      selectedLayerIds: ["shape-a", "shape-b"],
      activeTool: "select",
      previewResolution: "full", previewCameraView: "active", previewMode: "final", playbackRate: 1, autoKeyframe: false,
      playhead: 0,
    } as never);
  });

  it("shows one transform frame with resize and rotate controls", () => {
    render(<StageCanvas composition={makeComposition()} />);

    expect(screen.getByTestId("motion-composition-stage")).toHaveClass(
      "overflow-hidden",
    );
    expect(screen.getByText(ui("2 layers", "2 个图层"))).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: locale === "zh-CN" ? /缩放图层/ : /Resize layer/ })).toHaveLength(8);
    expect(screen.getByRole("button", { name: ui("Rotate layer", "旋转图层") })).toBeInTheDocument();
  });

  it("uses translated preview controls while preserving setting IDs and frame timing", () => {
    render(<StageCanvas composition={makeComposition()} />);
    fireEvent.change(screen.getByRole("combobox", { name: ui("Preview quality", "预览质量") }), { target: { value: "half" } });
    expect(useMotionStore.getState().previewResolution).toBe("half");
    expect(screen.getByRole("option", { name: ui("Balanced", "均衡") })).toHaveValue("half");
    fireEvent.change(screen.getByRole("combobox", { name: ui("Active camera", "当前摄像机") }), { target: { value: "default" } });
    expect(useMotionStore.getState().previewCameraView).toBe("default");
    fireEvent.change(screen.getByRole("combobox", { name: ui("Playback speed", "播放速度") }), { target: { value: "2" } });
    expect(useMotionStore.getState().playbackRate).toBe(2);
    fireEvent.change(screen.getByRole("combobox", { name: ui("Render mode", "渲染模式") }), { target: { value: "draft" } });
    expect(useMotionStore.getState().previewMode).toBe("draft");
    fireEvent.click(screen.getByRole("button", { name: ui("Auto keyframe", "自动关键帧") }));
    expect(useMotionStore.getState().autoKeyframe).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: ui("Next frame", "下一帧") }));
    expect(useMotionStore.getState().playhead).toBeCloseTo(1 / 30);
    fireEvent.click(screen.getByRole("button", { name: ui("To end", "跳到结尾") }));
    expect(useMotionStore.getState().playhead).toBe(5);
    fireEvent.click(screen.getByRole("button", { name: ui("Previous frame", "上一帧") }));
    expect(useMotionStore.getState().playhead).toBeCloseTo(5 - 1 / 30);
    fireEvent.click(screen.getByRole("button", { name: ui("To start", "跳到开头") }));
    expect(useMotionStore.getState().playhead).toBe(0);
  });

  it("moves every selected layer when one selected layer is dragged", async () => {
    const { container } = render(<StageCanvas composition={makeComposition()} />);
    const target = container.querySelector<HTMLElement>(
      '[data-motion-layer-id="shape-a"]',
    );
    if (!target) throw new Error("shape layer was not rendered");
    target.setPointerCapture = () => undefined;

    await act(async () => {
      dispatchPointer(target, "pointerdown", 10, 10);
      dispatchPointer(target, "pointermove", 20, 20);
      dispatchPointer(target, "pointerup", 20, 20);
      await Promise.resolve();
    });

    const stored = useProjectStore
      .getState()
      .project.motionCompositions?.find(
        (composition) => composition.id === "multi-selection",
      );
    const positions = stored?.layers.map((layer) => layer.transform.position);
    if (!positions?.[0] || !positions[1]) throw new Error("layers were not stored");
    expect(positions[0].x).toBeGreaterThan(320);
    expect(positions[0].y).toBeGreaterThan(360);
    expect(positions[1].x - positions[0].x).toBe(480);
    expect(positions[1].y - positions[0].y).toBe(0);
    expect(useMotionStore.getState().selectedLayerIds).toEqual([
      "shape-a",
      "shape-b",
    ]);
  });
});

function dispatchPointer(
  target: HTMLElement,
  type: "pointerdown" | "pointermove" | "pointerup",
  clientX: number,
  clientY: number,
): void {
  const event = new MouseEvent(type, { bubbles: true, clientX, clientY });
  Object.defineProperty(event, "pointerId", { value: 1 });
  target.dispatchEvent(event);
}
