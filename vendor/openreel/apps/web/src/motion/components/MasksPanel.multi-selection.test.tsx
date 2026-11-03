import { configureShotloomLocale } from "../../shotloom-mode";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  DEFAULT_MOTION_TRANSFORM,
  createMotionMask,
  getMotionMaskKeyframeProperty,
  type MotionComposition,
  type MotionShapeLayer,
} from "@openreel/core";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useMotionStore } from "../stores/motion-store";
import { MasksPanel } from "./MasksPanel";

const COMPOSITION_ID = "mask-multi";
const LAYER_IDS = ["shape-a", "shape-b"] as const;

function shapeLayer(id: string): MotionShapeLayer {
  return {
    id,
    type: "shape",
    name: id,
    startTime: 0,
    duration: 5,
    visible: true,
    locked: false,
    transform: DEFAULT_MOTION_TRANSFORM,
    keyframes: [],
    shapeType: "rectangle",
    width: 320,
    height: 180,
    style: {
      fill: { type: "solid", color: "#8b5cf6", opacity: 1 },
      stroke: { color: "#ffffff", width: 0, opacity: 1 },
    },
  };
}

function composition(): MotionComposition {
  return {
    id: COMPOSITION_ID,
    name: "Mask selection",
    width: 1280,
    height: 720,
    frameRate: 30,
    duration: 5,
    backgroundColor: "transparent",
    layers: LAYER_IDS.map(shapeLayer),
    assets: [],
    variables: [],
    markers: [],
    createdAt: 1,
    modifiedAt: 1,
  };
}

describe.each(["en-US", "zh-CN"] as const)("MasksPanel multi-selection (%s)", locale => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => {
    configureShotloomLocale(locale);
    const comp = composition();
    useProjectStore.setState({
      hasOpenProject: true,
      project: {
        ...createEmptyProject("Mask batch"),
        motionCompositions: [comp],
      },
    });
    useMotionStore.setState({
      selectedLayerId: LAYER_IDS[0],
      selectedLayerIds: [...LAYER_IDS],
    });
  });

  afterEach(() => {
    cleanup();
    configureShotloomLocale("en-US");
    useProjectStore.setState({ hasOpenProject: false });
  });

  it("adds independent preset masks to every selected layer", async () => {
    render(<MasksPanel composition={composition()} />);

    expect(
      screen.getByText(ui("New preset masks will be added to all 2 selected layers.", "新预设蒙版将添加到全部 2 个所选图层。")),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ui("Add Ellipse Mask", "添加椭圆蒙版") }));

    await waitFor(() => {
      const stored = useProjectStore
        .getState()
        .project.motionCompositions?.find(
          (candidate) => candidate.id === COMPOSITION_ID,
        );
      expect(stored?.layers.map((layer) => layer.masks?.[0]?.shape)).toEqual([
        "ellipse",
        "ellipse",
      ]);
      expect(stored?.layers[0]?.masks?.[0]?.name).toBe(ui("Ellipse Mask", "椭圆蒙版"));
      expect(stored?.layers[0]?.masks?.[0]?.id).not.toBe(
        stored?.layers[1]?.masks?.[0]?.id,
      );
    });
  });

  it("replaces animated mask stacks across selected layers", async () => {
    const base = composition();
    const sourceMask = {
      ...createMotionMask("ellipse", "source-mask"),
      feather: 0.18,
    };
    const animated: MotionComposition = {
      ...base,
      layers: [
        {
          ...base.layers[0],
          masks: [sourceMask],
          keyframes: [
            {
              id: "source-opacity-keyframe",
              time: 1.25,
              property: getMotionMaskKeyframeProperty(
                sourceMask.id,
                "opacity",
              ),
              value: 0.45,
              easing: "ease-in-out",
            },
          ],
        },
        {
          ...base.layers[1],
          masks: [createMotionMask("rectangle", "old-mask")],
        },
      ],
    };
    useProjectStore.setState((state) => ({
      project: { ...state.project, motionCompositions: [animated] },
    }));
    render(<MasksPanel composition={animated} />);

    fireEvent.click(screen.getByRole("button", { name: ui("Copy mask stack", "复制蒙版堆栈") }));
    fireEvent.click(screen.getByRole("button", { name: ui("Replace masks", "替换蒙版") }));

    await waitFor(() => {
      const stored = useProjectStore
        .getState()
        .project.motionCompositions?.find(
          (candidate) => candidate.id === COMPOSITION_ID,
        );
      expect(stored?.layers.map((layer) => layer.masks?.[0]?.shape)).toEqual([
        "ellipse",
        "ellipse",
      ]);
      expect(stored?.layers[0]?.masks?.[0]?.feather).toBe(0.18);
      expect(stored?.layers[1]?.masks?.[0]?.feather).toBe(0.18);
      const firstMaskId = stored?.layers[0]?.masks?.[0]?.id;
      const secondMaskId = stored?.layers[1]?.masks?.[0]?.id;
      expect(firstMaskId).not.toBe(secondMaskId);
      expect(stored?.layers[1]?.keyframes[0]?.property).toBe(
        getMotionMaskKeyframeProperty(secondMaskId!, "opacity"),
      );
    });
  });
  it("selects and clears all track matte modes using stable protocol values", async () => {
    const initial = composition();
    initial.layers[1] = { ...initial.layers[1], name: "Source {keep}" };
    const view = render(<MasksPanel composition={initial} />);
    const stored = () => useProjectStore.getState().project.motionCompositions!.find(c => c.id === COMPOSITION_ID)!;
    const refresh = () => view.rerender(<MasksPanel composition={stored()} />);
    const sourceSelect = screen.getAllByRole("combobox")[0];
    expect(screen.getByRole("option", { name: "Source {keep}" })).toHaveValue(LAYER_IDS[1]);
    fireEvent.change(sourceSelect, { target: { value: LAYER_IDS[1] } });
    await waitFor(() => expect(stored().layers[0].trackMatte?.sourceLayerId).toBe(LAYER_IDS[1]));
    refresh();
    const modes = [["alpha", "Alpha", "透明度"], ["alpha-inverted", "Alpha Inverted", "反转透明度"], ["luma", "Luma", "亮度"], ["luma-inverted", "Luma Inverted", "反转亮度"]];
    for (const [value, en, zh] of modes) {
      expect(screen.getByRole("option", { name: ui(en, zh) })).toHaveValue(value);
      fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value } });
      await waitFor(() => expect(stored().layers[0].trackMatte?.type).toBe(value));
      refresh();
    }
    fireEvent.click(screen.getByRole("button", { name: ui("Clear track matte", "清除轨道遮罩") }));
    await waitFor(() => expect(stored().layers[0].trackMatte).toBeUndefined());
  });

});
