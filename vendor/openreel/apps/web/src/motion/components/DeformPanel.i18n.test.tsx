import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DEFAULT_MOTION_TRANSFORM, createMotionPuppetPin, type MotionComposition, type MotionShapeLayer } from "@openreel/core";
import { configureShotloomLocale } from "../../shotloom-mode";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useMotionStore } from "../stores/motion-store";
import { DeformPanel } from "./DeformPanel";

function layer(): MotionShapeLayer {
  return { id: "shape", type: "shape", name: "Rectangle {keep}", startTime: 0, duration: 5, visible: true, locked: false, transform: DEFAULT_MOTION_TRANSFORM, keyframes: [], shapeType: "rectangle", width: 200, height: 100, style: { fill: { type: "solid", color: "#ffffff", opacity: 1 }, stroke: { color: "#000000", width: 1, opacity: 1 } } };
}
function composition(shape = layer()): MotionComposition {
  return { id: "comp", name: "Comp", width: 1280, height: 720, duration: 5, frameRate: 30, backgroundColor: "#000000", layers: [shape], assets: [], variables: [], markers: [], createdAt: 1, modifiedAt: 1 };
}
function stored() { return useProjectStore.getState().project.motionCompositions![0]; }
function storedLayer() { return stored().layers[0] as MotionShapeLayer; }
function mount(shape = layer()) {
  const comp = composition(shape);
  useProjectStore.setState({ hasOpenProject: true, project: { ...createEmptyProject("Deform"), motionCompositions: [comp] } });
  const view = render(<DeformPanel composition={comp} embedded />);
  return () => view.rerender(<DeformPanel composition={stored()} embedded />);
}
function withPin() {
  return { ...layer(), puppetPins: [createMotionPuppetPin({ id: "pin", name: "Pin {keep}", bindPosition: { x: 0, y: 0 }, position: { x: 10, y: 20 }, radius: 50, strength: 1, color: "#22d3ee" })] };
}

describe.each(["en-US", "zh-CN"] as const)("DeformPanel (%s)", locale => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => {
    configureShotloomLocale(locale);
    useMotionStore.setState({ selectedLayerId: "shape", selectedLayerIds: ["shape"], playhead: 1, autoKeyframe: false });
  });
  afterEach(() => { cleanup(); configureShotloomLocale("en-US"); useProjectStore.setState({ hasOpenProject: false }); });

  it("shows a translated selection prompt and hides embedded empty content", () => {
    const comp = composition();
    useMotionStore.setState({ selectedLayerId: null });
    const view = render(<DeformPanel composition={comp} />);
    expect(screen.getByText(ui("Select a shape layer", "选择形状图层"))).toBeInTheDocument();
    view.rerender(<DeformPanel composition={comp} embedded />);
    expect(view.container).toBeEmptyDOMElement();
  });

  it("adds a localized pin and preserves the layer name", async () => {
    const refresh = mount();
    expect(screen.getByText("Rectangle {keep}")).toHaveAttribute("data-shotloom-user-content");
    expect(screen.getByText(ui("No pins", "暂无控制点"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ui("Add Puppet Pin", "添加 Puppet 控制点") }));
    await waitFor(() => expect(storedLayer().puppetPins).toHaveLength(1));
    expect(storedLayer().puppetPins![0].name).toBe(ui("Pin 1", "控制点 1"));
    expect(storedLayer().name).toBe("Rectangle {keep}");
    refresh();
    fireEvent.click(screen.getByRole("button", { name: ui("Clear pins", "清除控制点") }));
    await waitFor(() => expect(storedLayer().puppetPins ?? []).toHaveLength(0));
  });

  it("edits a pin, resets its position, disables and removes it", async () => {
    const refresh = mount(withPin());
    expect(screen.getByDisplayValue("Pin {keep}")).toBeInTheDocument();
    fireEvent.change(screen.getAllByRole("spinbutton")[0], { target: { value: "25" } });
    await waitFor(() => expect(storedLayer().puppetPins![0].bindPosition.x).toBe(25));
    refresh();
    fireEvent.click(screen.getByRole("button", { name: ui("Reset position to bind", "重置到绑定位置") }));
    await waitFor(() => expect(storedLayer().puppetPins![0].position).toEqual({ x: 25, y: 0 }));
    refresh();
    fireEvent.click(screen.getByRole("button", { name: ui("Disable pin", "禁用控制点") }));
    await waitFor(() => expect(storedLayer().puppetPins![0].enabled).toBe(false));
    refresh();
    fireEvent.click(screen.getByRole("button", { name: ui("Delete pin", "删除控制点") }));
    await waitFor(() => expect(storedLayer().puppetPins ?? []).toHaveLength(0));
  });

  it("writes the original keyframe property when auto-keyframing is on", async () => {
    useMotionStore.setState({ autoKeyframe: true });
    mount(withPin());
    fireEvent.change(screen.getAllByRole("spinbutton")[2], { target: { value: "40" } });
    await waitFor(() => expect(storedLayer().keyframes).toHaveLength(1));
    expect(storedLayer().keyframes[0]).toMatchObject({ property: "puppet.pin.position.x", value: 40, time: 1 });
    expect(storedLayer().puppetPins![0].name).toBe("Pin {keep}");
  });

  it("keeps locked layer controls disabled", () => {
    mount({ ...withPin(), locked: true });
    expect(screen.getByRole("button", { name: ui("Add Puppet Pin", "添加 Puppet 控制点") })).toBeDisabled();
    expect(screen.getByRole("button", { name: ui("Delete pin", "删除控制点") })).toBeDisabled();
    for (const input of screen.getAllByRole("spinbutton")) expect(input).toBeDisabled();
    expect(storedLayer().puppetPins).toHaveLength(1);
  });
});
