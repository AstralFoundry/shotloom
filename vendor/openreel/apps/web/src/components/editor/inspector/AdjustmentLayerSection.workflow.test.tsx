import "../../../test/install-local-storage-mock";
import { configureShotloomLocale, editorMessage } from "../../../shotloom-mode";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AdjustmentLayerEngine, type AdjustmentLayer, type Project } from "@openreel/core";
import { useEngineStore } from "../../../stores/engine-store";
import { useProjectStore } from "../../../stores/project-store";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { AdjustmentLayerSection } from "./AdjustmentLayerSection";

function projectWithClip(): Project {
  const project = createEmptyProject("Adjustment workflow");
  return {
    ...project,
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

describe.each(["en-US", "zh-CN"] as const)("AdjustmentLayerSection workflow (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  const engine = new AdjustmentLayerEngine();
  const originalExecute = useProjectStore.getState().executeAction;
  const originalGetEngine = useEngineStore.getState().getAdjustmentLayerEngine;

  beforeEach(() => {
    configureShotloomLocale(locale);
    engine.clearAll();
    const project = projectWithClip();
    useEngineStore.setState({ getAdjustmentLayerEngine: async () => engine });
    useProjectStore.setState({
      hasOpenProject: true,
      project,
      executeAction: vi.fn(async (action) => {
        if (action.type === "adjustment/setAll") {
          useProjectStore.setState((state) => ({
            project: {
              ...state.project,
              adjustmentLayers: action.params.layers as AdjustmentLayer[],
              modifiedAt: Date.now(),
            },
          }));
        }
        return { success: true };
      }),
    });
  });

  afterEach(() => {
    cleanup();
    configureShotloomLocale("en-US");
    useEngineStore.setState({ getAdjustmentLayerEngine: originalGetEngine });
    useProjectStore.setState({ hasOpenProject: false, executeAction: originalExecute });
  });

  it("persists creation and exposes visible, editable effect defaults", async () => {
    render(<AdjustmentLayerSection clipId="clip-1" />);
    await waitFor(() => expect(screen.getByRole("button", { name: ui("Add Adjustment Layer", "添加调整图层") })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: ui("Add Adjustment Layer", "添加调整图层") }));

    await waitFor(() => {
      expect(useProjectStore.getState().project.adjustmentLayers).toHaveLength(1);
    });
    expect(engine.getAllLayers()[0]).toMatchObject({ startTime: 1, duration: 4 });
    expect(screen.getByText(ui("Start", "开始时间"))).toBeInTheDocument();
    expect(screen.getByText(ui("Duration", "时长"))).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: ui("+ Brightness", "+ 亮度") }));
    await waitFor(() => {
      expect(engine.getAllLayers()[0]?.effects[0]).toMatchObject({
        type: "brightness",
        params: { value: 12 },
      });
    });
    expect(screen.getByRole("button", { name: ui("Edit Brightness value", "编辑亮度数值") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ui("+ Grayscale", "+ 灰度") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ui("+ Sepia", "+ 褐色调") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ui("+ Invert", "+ 反相") })).toBeInTheDocument();
    expect(screen.getByTestId("adjustment-effect-preview-grayscale")).toBeInTheDocument();
    expect(screen.getByTestId("adjustment-effect-preview-sepia")).toBeInTheDocument();
    expect(screen.getByTestId("adjustment-effect-preview-invert")).toBeInTheDocument();
  });
  it("keeps all effect IDs and default parameters while adding and removing translated presets", async () => {
    render(<AdjustmentLayerSection clipId="clip-1" />);
    await waitFor(() => expect(engine.getAllLayers()).toEqual([]));
    await waitFor(() => expect(screen.getByRole("button", { name: ui("Add Adjustment Layer", "添加调整图层") })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: ui("Add Adjustment Layer", "添加调整图层") }));
    await waitFor(() => expect(engine.getAllLayers()).toHaveLength(1));
    for (const [type, name, params] of [
      ["brightness", "brightness", { value: 12 }], ["contrast", "contrast", { value: 1.15 }],
      ["saturation", "saturation", { value: 1.15 }], ["grayscale", "grayscale", { amount: 1 }],
      ["sepia", "sepia", { amount: 1 }], ["invert", "invert", { amount: 1 }],
      ["hue", "hue-rotate", { rotation: 20 }], ["blur", "blur", { radius: 6 }],
      ["sharpen", "sharpen", { amount: 0.6 }], ["vignette", "vignette", { amount: 0.45, midpoint: 0.55, feather: 0.35 }],
      ["temperature", "temperature", { value: 20 }], ["tint", "tint", { value: 15 }],
      ["grain", "film-grain", { amount: 0.08, size: 1 }],
    ] as const) {
      const label = editorMessage(`editor.adjustment.label.${name}`);
      fireEvent.click(screen.getByRole("button", { name: `+ ${label}` }));
      await waitFor(() => expect(useProjectStore.getState().project.adjustmentLayers?.[0].effects).toEqual([expect.objectContaining({ type, params, enabled: true })]));
      fireEvent.click(screen.getByRole("button", { name: editorMessage("editor.adjustment.disableEffect", { name: label }) }));
      expect(engine.getAllLayers()[0].effects[0].enabled).toBe(false);
      fireEvent.click(screen.getByRole("button", { name: editorMessage("editor.adjustment.removeEffect", { name: label }) }));
      await waitFor(() => expect(engine.getAllLayers()[0].effects).toEqual([]));
    }
  });

  it("persists normalized opacity, translated duplicate names and deletion", async () => {
    render(<AdjustmentLayerSection clipId="clip-1" />);
    await waitFor(() => expect(screen.getByRole("button", { name: ui("Add Adjustment Layer", "添加调整图层") })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: ui("Add Adjustment Layer", "添加调整图层") }));
    await waitFor(() => expect(engine.getAllLayers()).toHaveLength(1));
    const original = engine.getAllLayers()[0];
    expect(original).toMatchObject({ name: ui("Adjustment 1", "调整图层 1"), trackId: "video-track" });
    fireEvent.click(screen.getByRole("button", { name: ui("Edit Opacity value", "编辑不透明度数值") }));
    const opacity = screen.getByRole("textbox", { name: ui("Opacity value", "不透明度数值") });
    fireEvent.change(opacity, { target: { value: "35%" } }); fireEvent.blur(opacity);
    await waitFor(() => expect(engine.getLayer(original.id)?.opacity).toBe(0.35));
    fireEvent.click(screen.getByRole("button", { name: ui("Hide layer", "隐藏图层") }));
    expect(engine.getLayer(original.id)?.enabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: ui("Duplicate", "创建副本") }));
    await waitFor(() => expect(engine.getAllLayers()).toHaveLength(2));
    const duplicate = engine.getAllLayers().find(layer => layer.id !== original.id)!;
    expect(duplicate).toMatchObject({ name: ui("Adjustment 1 (Copy)", "调整图层 1（副本）"), opacity: 0.35, trackId: "video-track", startTime: 1, duration: 4 });
    fireEvent.click(screen.getByRole("button", { name: ui("Delete", "删除") }));
    await waitFor(() => expect(engine.getAllLayers().map(layer => layer.id)).toEqual([original.id]));
  });

  it("keeps all sixteen blend-mode enums when choosing translated menu options", async () => {
    render(<AdjustmentLayerSection clipId="clip-1" />);
    await waitFor(() => expect(screen.getByRole("button", { name: ui("Add Adjustment Layer", "添加调整图层") })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: ui("Add Adjustment Layer", "添加调整图层") }));
    await waitFor(() => expect(engine.getAllLayers()).toHaveLength(1));
    let current = "normal" as "normal" | "multiply" | "screen" | "overlay" | "darken" | "lighten" | "color-dodge" | "color-burn" | "hard-light" | "soft-light" | "difference" | "exclusion" | "hue" | "saturation" | "color" | "luminosity";
    for (const mode of ["normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity"] as const) {
      fireEvent.click(screen.getByRole("button", { name: editorMessage(`editor.motion.layers.blend.${current}`) }));
      const name = editorMessage(`editor.motion.layers.blend.${mode}`);
      fireEvent.click(await screen.findByRole("button", { name: editorMessage("editor.adjustment.useBlend", { name }) }));
      await waitFor(() => expect(useProjectStore.getState().project.adjustmentLayers?.[0].blendMode).toBe(mode));
      current = mode;
    }
  });

});
