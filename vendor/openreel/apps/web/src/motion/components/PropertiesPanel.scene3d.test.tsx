import { configureShotloomLocale } from "../../shotloom-mode";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  DEFAULT_MOTION_TRANSFORM,
  type MotionComposition,
  type MotionScene3DLayer,
} from "@openreel/core";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useMotionStore } from "../stores/motion-store";
import { PropertiesPanel } from "./PropertiesPanel";

function scene3dLayer(): MotionScene3DLayer {
  return {
    id: "layer-3d",
    type: "scene3d",
    name: "Hero 3D",
    startTime: 0,
    duration: 4,
    visible: true,
    locked: false,
    transform: DEFAULT_MOTION_TRANSFORM,
    keyframes: [],
    object: { kind: "box" },
  };
}

function composition(): MotionComposition {
  return {
    id: "comp-3d",
    name: "Comp",
    width: 1280,
    height: 720,
    frameRate: 30,
    duration: 4,
    backgroundColor: "#101820",
    layers: [scene3dLayer()],
    assets: [],
    variables: [],
    markers: [],
    createdAt: 1,
    modifiedAt: 1,
  };
}

describe.each(["en-US", "zh-CN"] as const)("PropertiesPanel scene3d lighting (%s)", locale => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  const upsert = vi.fn();

  beforeEach(() => {
    configureShotloomLocale(locale);
    upsert.mockReset();
    useProjectStore.setState({
      hasOpenProject: true,
      project: createEmptyProject("Scene3D lighting test"),
      upsertMotionComposition: upsert,
    });
    useMotionStore.setState({
      selectedLayerId: "layer-3d",
      selectedLayerIds: ["layer-3d"],
      selectedLightId: null,
      rightTab: "properties",
      playhead: 0,
    });
  });

  afterEach(() => {
    configureShotloomLocale("en-US");
    cleanup();
    useProjectStore.setState({ hasOpenProject: false });
  });

  it("renders the Lighting & Environment controls for a selected 3D layer", () => {
    render(<PropertiesPanel composition={composition()} />);
    expect(screen.getByText(ui("Lighting & Environment", "灯光与环境"))).toBeInTheDocument();
    expect(screen.getByText(ui("Environment", "环境"))).toBeInTheDocument();
    expect(screen.getByText(ui("HDRI map URL", "HDRI 贴图地址"))).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: ui("Show environment as backdrop", "将环境显示为背景") }),
    ).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: ui("Ground shadow", "地面阴影") })).toBeInTheDocument();
  });

  it("patches the layer lighting when the environment preset changes", () => {
    render(<PropertiesPanel composition={composition()} />);
    fireEvent.change(screen.getByRole("combobox", { name: ui("Environment", "环境") }), {
      target: { value: "sunset" },
    });

    expect(upsert).toHaveBeenCalledTimes(1);
    const next = upsert.mock.calls[0]![0] as MotionComposition;
    const layer = next.layers[0] as MotionScene3DLayer;
    expect(layer.lighting?.environment).toBe("sunset");
  });

  it("stores an HDRI url and the backdrop toggle", () => {
    render(<PropertiesPanel composition={composition()} />);
    fireEvent.change(screen.getByPlaceholderText("https://…/studio_2k.hdr"), {
      target: { value: "https://cdn.example/studio.hdr" },
    });
    const stored = upsert.mock.calls[0]![0] as MotionComposition;
    expect((stored.layers[0] as MotionScene3DLayer).lighting?.environmentUrl).toBe(
      "https://cdn.example/studio.hdr",
    );
  });
});
