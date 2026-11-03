import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { applyMotionParticlePreset, createMotionParticleLayer, MOTION_PARTICLE_PRESETS, type MotionComposition, type MotionParticleLayer } from "@openreel/core";
import { configureShotloomLocale } from "../../shotloom-mode";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useMotionStore } from "../stores/motion-store";
import { PropertiesPanel } from "./PropertiesPanel";
const presetNames = { sparks: "火花", confetti: "彩纸", snow: "雪花", dust: "尘埃", "ui-burst": "界面爆发" };
function composition(): MotionComposition {
  const base = { id: "particle-comp", name: "Particles", width: 1280, height: 720, duration: 5, frameRate: 30,
    backgroundColor: "#000000", assets: [], variables: [], markers: [], createdAt: 1, modifiedAt: 1 };
  return { ...base, layers: [createMotionParticleLayer(base, { id: "particle-layer", name: "My {particles}" })] };
}
function stored() { return useProjectStore.getState().project.motionCompositions![0].layers[0] as MotionParticleLayer; }
describe.each(["en-US", "zh-CN"] as const)("particle inspector (%s)", locale => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => {
    configureShotloomLocale(locale);
    useProjectStore.setState({ hasOpenProject: true, project: { ...createEmptyProject("Particles"), motionCompositions: [composition()] } });
    useMotionStore.setState({ selectedLayerId: "particle-layer", selectedLayerIds: ["particle-layer"], selectedLightId: null, playhead: 0, autoKeyframe: false });
  });
  afterEach(() => { cleanup(); configureShotloomLocale("en-US"); useProjectStore.setState({ hasOpenProject: false }); });
  it.each(MOTION_PARTICLE_PRESETS)("applies $id without changing user names or rendering values", async preset => {
    const comp = composition();
    const expected = applyMotionParticlePreset(comp.layers[0] as MotionParticleLayer, preset.id);
    render(<PropertiesPanel composition={comp} />);
    const label = ui(`${preset.name} ${preset.emitter.emissionRate}/s`, `${presetNames[preset.id]} ${preset.emitter.emissionRate}/秒`);
    fireEvent.click(screen.getByRole("button", { name: label }));
    await waitFor(() => expect(stored().emitter).toEqual(expected.emitter));
    expect(stored().name).toBe("My {particles}");
    expect(stored().id).toBe("particle-layer");
  });
  it("edits a percentage and shape through localized controls", async () => {
    render(<PropertiesPanel composition={composition()} />);
    const field = screen.getByText(ui("Random", "随机程度")).closest(".astryx-field") as HTMLElement;
    fireEvent.change(within(field).getByRole("spinbutton"), { target: { value: "25" } });
    await waitFor(() => expect(stored().emitter.sizeRandomness).toBe(0.25));
    cleanup();
    const comp = useProjectStore.getState().project.motionCompositions![0];
    render(<PropertiesPanel composition={comp} />);
    const shape = screen.getByRole("combobox", { name: ui("Particle shape", "粒子形状") });
    expect(within(shape).getByRole("option", { name: ui("Square", "方形") })).toHaveValue("square");
    fireEvent.change(shape, { target: { value: "square" } });
    await waitFor(() => expect(stored().emitter.shape).toBe("square"));
    expect(stored().emitter.sizeRandomness).toBe(0.25);
  });
});
