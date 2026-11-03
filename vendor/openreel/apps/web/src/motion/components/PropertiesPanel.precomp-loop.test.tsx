import { configureShotloomLocale } from "../../shotloom-mode";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import {
  DEFAULT_MOTION_TRANSFORM,
  type MotionComposition,
  type MotionCompositionLayer,
} from "@openreel/core";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useMotionStore } from "../stores/motion-store";
import { PropertiesPanel } from "./PropertiesPanel";

function sourceComposition(): MotionComposition {
  return {
    id: "source-comp",
    name: "Reusable title",
    width: 1280,
    height: 720,
    frameRate: 30,
    duration: 2,
    backgroundColor: "#000000",
    layers: [],
    assets: [],
    variables: [],
    markers: [],
    createdAt: 1,
    modifiedAt: 1,
  };
}

function hostComposition(): MotionComposition {
  const layer: MotionCompositionLayer = {
    id: "precomp-layer",
    type: "composition",
    name: "Title instance",
    compositionId: "source-comp",
    width: 1280,
    height: 720,
    startTime: 0,
    duration: 6,
    timeOffset: 0,
    playbackRate: 1,
    visible: true,
    locked: false,
    transform: DEFAULT_MOTION_TRANSFORM,
    keyframes: [],
  };
  return {
    ...sourceComposition(),
    id: "host-comp",
    name: "Host",
    duration: 6,
    layers: [layer],
  };
}

describe.each(["en-US", "zh-CN"] as const)("PropertiesPanel precomposition playback (%s)", locale => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  const upsert = vi.fn();
  const host = hostComposition();

  beforeEach(() => {
    configureShotloomLocale(locale);
    upsert.mockReset();
    const project = {
      ...createEmptyProject("Precomp loop test"),
      motionCompositions: [sourceComposition(), host],
    };
    useProjectStore.setState({
      hasOpenProject: true,
      project,
      upsertMotionComposition: upsert,
    });
    useMotionStore.setState({
      selectedLayerId: "precomp-layer",
      selectedLayerIds: ["precomp-layer"],
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

  it("enables looping on the selected precomposition instance", () => {
    render(<PropertiesPanel composition={host} />);
    fireEvent.click(screen.getByRole("switch", { name: ui("Loop source", "循环播放源素材") }));

    expect(upsert).toHaveBeenCalledTimes(1);
    const next = upsert.mock.calls[0]![0] as MotionComposition;
    expect((next.layers[0] as MotionCompositionLayer).loop).toBe(true);
  });
  it("creates source-time keyframes with the original property and input value", () => {
    render(<PropertiesPanel composition={host} />);
    const source = screen.getByRole("option", { name: "Reusable title" });
    expect(source).toHaveAttribute("data-shotloom-user-content", "");
    const field = screen.getByText(ui("Source time at playhead", "播放头处的源时间")).closest(".astryx-field") as HTMLElement;
    fireEvent.change(within(field).getByRole("spinbutton"), { target: { value: "0.75" } });
    const next = upsert.mock.calls[0]![0] as MotionComposition;
    const layer = next.layers[0] as MotionCompositionLayer;
    expect(layer.keyframes).toEqual([expect.objectContaining({ property: "composition.time", time: 0, value: 0.75 })]);
    expect(layer.compositionId).toBe("source-comp");
    expect(layer.name).toBe("Title instance");
    expect(useMotionStore.getState().selectedProperty).toBe("composition.time");
  });

  it("freezes source time and reverses with unchanged timing and easing", () => {
    render(<PropertiesPanel composition={host} />);
    fireEvent.click(screen.getByRole("button", { name: ui("Freeze", "定格") }));
    const frozen = (upsert.mock.calls[0]![0] as MotionComposition).layers[0] as MotionCompositionLayer;
    expect(frozen.keyframes.map(({ property, time, value, easing }) => ({ property, time, value, easing }))).toEqual([
      { property: "composition.time", time: 0, value: 0, easing: "hold" },
      { property: "composition.time", time: 6, value: 0, easing: "hold" },
    ]);
    fireEvent.click(screen.getByRole("button", { name: ui("Reverse", "倒放") }));
    const reversed = (upsert.mock.calls[1]![0] as MotionComposition).layers[0] as MotionCompositionLayer;
    expect(reversed.keyframes.map(key => key.value)).toEqual([2, 0]);
    expect(reversed.keyframes.map(key => key.easing)).toEqual(["linear", "linear"]);
    expect(reversed.id).toBe("precomp-layer");
  });

});
