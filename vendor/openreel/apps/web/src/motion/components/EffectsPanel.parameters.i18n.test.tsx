import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { DEFAULT_MOTION_TRANSFORM, createMotionEffect, type MotionComposition, type MotionEffect, type MotionTextLayer } from "@openreel/core";
import { configureShotloomLocale } from "../../shotloom-mode";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useMotionStore } from "../stores/motion-store";
import { EffectsPanel } from "./EffectsPanel";

const LAYER_ID = "layer-text";
const COMP_ID = "comp-controls";

function textLayer(): MotionTextLayer {
  return {
    id: LAYER_ID,
    type: "text",
    name: "Headline",
    startTime: 0,
    duration: 4,
    visible: true,
    locked: false,
    transform: DEFAULT_MOTION_TRANSFORM,
    keyframes: [],
    text: "Hello",
    style: {
      fontFamily: "Inter",
      fontSize: 64,
      color: "#ffffff",
    },
  };
}

function composition(): MotionComposition {
  return {
    id: COMP_ID,
    name: "Comp",
    width: 1280,
    height: 720,
    frameRate: 30,
    duration: 4,
    backgroundColor: "#101820",
    layers: [textLayer()],
    assets: [],
    variables: [],
    markers: [],
    createdAt: 1,
    modifiedAt: 1,
  };
}

function storedComposition(): MotionComposition {
  const project = useProjectStore.getState().project;
  const found = (project.motionCompositions ?? []).find(
    (entry) => entry.id === COMP_ID,
  );
  if (!found) throw new Error("composition not stored");
  return found;
}

function storedEffects(): readonly MotionEffect[] {
  return storedComposition().layers[0].effects ?? [];
}


describe.each(["en-US", "zh-CN"] as const)("Effect parameters (%s)", locale => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => {
    configureShotloomLocale(locale);
    const comp = composition();
    const selected = { ...comp.layers[0], effects: [
      { ...createMotionEffect("blur", "original-blur"), name: "User blur {name}" },
      createMotionEffect("slider-control", "original-slider"),
      createMotionEffect("checkbox-control", "original-checkbox"),
    ] };
    useProjectStore.setState({ hasOpenProject: true, project: {
      ...createEmptyProject("Original project"), motionCompositions: [{ ...comp, layers: [selected] }],
    } });
    useMotionStore.setState({ selectedLayerId: LAYER_ID, selectedLayerIds: [LAYER_ID], playhead: 0, autoKeyframe: false });
  });
  afterEach(() => {
    cleanup(); configureShotloomLocale("en-US");
    useProjectStore.setState({ hasOpenProject: false });
  });
  it("edits translated numeric fields and checkboxes through the actual project store", async () => {
    const { rerender } = render(<EffectsPanel composition={storedComposition()} />);
    expect(screen.getByText("User blur {name}")).toBeInTheDocument();
    const field = screen.getAllByText(ui("Radius", "半径"))
      .map(node => node.closest(".astryx-field"))
      .find(node => node && within(node as HTMLElement).queryByRole("spinbutton"));
    expect(field).toBeTruthy();
    fireEvent.change(within(field as HTMLElement).getByRole("spinbutton"), { target: { value: "24" } });
    await waitFor(() => expect(storedEffects().find(e => e.id === "original-blur")).toMatchObject({ type: "blur", radius: 24, name: "User blur {name}" }));
    rerender(<EffectsPanel composition={storedComposition()} />);
    fireEvent.click(screen.getByRole("switch", { name: ui("Checkbox", "复选框") }));
    await waitFor(() => expect(storedEffects().find(e => e.id === "original-checkbox")).toMatchObject({ type: "checkbox-control", value: 1 }));
    rerender(<EffectsPanel composition={storedComposition()} />);
    fireEvent.click(screen.getByRole("switch", { name: ui("Checkbox", "复选框") }));
    await waitFor(() => expect(storedEffects().find(e => e.id === "original-checkbox")).toMatchObject({ value: 0 }));
    expect(storedEffects().find(e => e.id === "original-blur")).toMatchObject({ radius: 24 });
  });
  it("uses translated parameter names for keyframe actions while retaining property IDs", async () => {
    render(<EffectsPanel composition={storedComposition()} />);
    fireEvent.click(screen.getByRole("button", { name: ui("Add Radius keyframe", "添加 半径 关键帧") }));
    await waitFor(() => expect(storedComposition().layers[0].keyframes).toContainEqual(expect.objectContaining({ property: "effect.original-blur.radius", time: 0, value: 8 })));
  });
});
