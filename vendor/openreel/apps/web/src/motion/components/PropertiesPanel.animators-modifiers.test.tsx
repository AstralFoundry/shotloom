import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { DEFAULT_MOTION_TRANSFORM, addMotionTextAnimator, createMotionShapeModifier, createMotionTextAnimator, type MotionComposition, type MotionLayer, type MotionShapeLayer, type MotionTextLayer } from "@openreel/core";
import { configureShotloomLocale } from "../../shotloom-mode";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useMotionStore } from "../stores/motion-store";
import { PropertiesPanel } from "./PropertiesPanel";
const modifierCases = [
  ["trim-paths", "Trim Paths", "修剪路径"], ["repeater", "Repeater", "重复器"],
  ["zig-zag", "Zig Zag", "锯齿"], ["round-corners", "Round Corners", "圆角"],
  ["wiggle-paths", "Wiggle Paths", "摆动路径"], ["offset-paths", "Offset Paths", "偏移路径"],
  ["pucker-bloat", "Pucker & Bloat", "收缩与膨胀"], ["twist", "Twist", "扭转"],
] as const;
const animatorCases = [
  ["text-reveal-up", "Reveal Up", "向上揭示"], ["text-type-on", "Type On", "打字效果"],
  ["text-scale-in", "Scale In", "缩放进入"], ["text-reveal-down", "Reveal Down", "向下揭示"],
  ["text-slide-left", "Slide In Left", "从左滑入"], ["text-spin-in", "Spin In", "旋转进入"],
] as const;
function composition(kind: "text" | "shape"): MotionComposition {
  const base = { id: "test-layer", name: "My {layer}", startTime: 0, duration: 5, visible: true, locked: false, transform: DEFAULT_MOTION_TRANSFORM, keyframes: [] };
  const layer: MotionLayer = kind === "text"
    ? { ...base, type: "text", text: "Original {text}", style: { fontFamily: "Inter", fontSize: 64, color: "#ffffff" } }
    : { ...base, type: "shape", shapeType: "rectangle", width: 100, height: 100, style: { fill: { type: "solid", color: "#ffffff", opacity: 1 }, stroke: { color: "#000000", width: 2, opacity: 1 } } };
  return { id: "test-comp", name: "Comp", width: 1280, height: 720, duration: 5, frameRate: 30, backgroundColor: "#000000", layers: [layer], assets: [], variables: [], markers: [], createdAt: 1, modifiedAt: 1 };
}
function seed(kind: "text" | "shape") {
  useProjectStore.setState({ hasOpenProject: true, project: { ...createEmptyProject("Animation controls"), motionCompositions: [composition(kind)] } });
}
function stored() { return useProjectStore.getState().project.motionCompositions![0]; }
function rerenderStored() { cleanup(); render(<PropertiesPanel composition={stored()} />); }

describe.each(["en-US", "zh-CN"] as const)("animation and modifier controls (%s)", locale => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => {
    configureShotloomLocale(locale);
    useMotionStore.setState({ selectedLayerId: "test-layer", selectedLayerIds: ["test-layer"], selectedLightId: null, selectedProperty: null, playhead: 1, autoKeyframe: false });
  });
  afterEach(() => { cleanup(); configureShotloomLocale("en-US"); useProjectStore.setState({ hasOpenProject: false }); });

  it.each(modifierCases)("creates, toggles and removes %s through localized controls", async (type, en, zh) => {
    seed("shape"); render(<PropertiesPanel composition={stored()} />);
    fireEvent.click(screen.getByRole("button", { name: ui(`Add ${en}`, `添加${zh}`) }));
    const modifiers = () => (stored().layers[0] as MotionShapeLayer).modifiers!;
    await waitFor(() => expect(modifiers()).toHaveLength(1));
    const actual = modifiers()[0];
    expect(actual).toEqual({ ...createMotionShapeModifier(type, actual.id), name: ui(en, zh) });
    rerenderStored();
    expect(screen.getAllByText(ui(en, zh)).some(node => node.hasAttribute("data-shotloom-user-content"))).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: ui(`Disable ${en}`, `禁用${zh}`) }));
    await waitFor(() => expect(modifiers()[0].enabled).toBe(false));
    expect(modifiers()[0].name).toBe(ui(en, zh));
    rerenderStored();
    fireEvent.click(screen.getByRole("button", { name: ui(`Remove ${en}`, `移除${zh}`) }));
    await waitFor(() => expect((stored().layers[0] as MotionShapeLayer).modifiers ?? []).toHaveLength(0));
    expect(stored().layers[0].name).toBe("My {layer}");
  });

  it.each(animatorCases)("creates the %s preset without changing animation parameters", async (preset, en, zh) => {
    seed("text"); render(<PropertiesPanel composition={stored()} />);
    fireEvent.change(screen.getByRole("combobox", { name: ui("Add text animator preset", "添加文字动画预设") }), { target: { value: preset } });
    const animators = () => (stored().layers[0] as MotionTextLayer).textAnimators!;
    await waitFor(() => expect(animators()).toHaveLength(1));
    const actual = animators()[0];
    const baseline = addMotionTextAnimator(composition("text").layers[0] as MotionTextLayer, createMotionTextAnimator(preset, actual.id)).textAnimators![0];
    expect(actual).toEqual({ ...baseline, name: ui(en, zh) });
    rerenderStored();
    expect(screen.getAllByText(ui(en, zh)).some(node => node.hasAttribute("data-shotloom-user-content"))).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: ui("Disable Text Animator", "禁用文字动画器") }));
    await waitFor(() => expect(animators()[0].enabled).toBe(false));
    rerenderStored();
    fireEvent.click(screen.getByRole("button", { name: ui("Remove Text Animator", "移除文字动画器") }));
    await waitFor(() => expect((stored().layers[0] as MotionTextLayer).textAnimators ?? []).toHaveLength(0));
    expect((stored().layers[0] as MotionTextLayer).text).toBe("Original {text}");
  });

  it("writes modifier keyframes with original property IDs", async () => {
    seed("shape"); render(<PropertiesPanel composition={stored()} />);
    fireEvent.click(screen.getByRole("button", { name: ui("Add Repeater", "添加重复器") }));
    await waitFor(() => expect((stored().layers[0] as MotionShapeLayer).modifiers).toHaveLength(1));
    rerenderStored();
    const field = screen.getByText(ui("Copies", "副本数")).closest(".astryx-field") as HTMLElement;
    fireEvent.change(within(field).getByRole("spinbutton"), { target: { value: "7" } });
    await waitFor(() => expect((stored().layers[0] as MotionShapeLayer).modifiers![0]).toEqual(expect.objectContaining({ copies: 7 })));
    rerenderStored();
    fireEvent.click(screen.getByRole("button", { name: ui("Add Copies keyframe", "添加 副本数 关键帧") }));
    await waitFor(() => expect(stored().layers[0].keyframes).toHaveLength(1));
    const id = (stored().layers[0] as MotionShapeLayer).modifiers![0].id;
    expect(stored().layers[0].keyframes[0]).toEqual(expect.objectContaining({ property: `modifier.${id}.copies`, time: 1, value: 7 }));
  });
  it("edits selector enums and numeric animation values while preserving a custom name", async () => {
    const comp = composition("text");
    const layer = comp.layers[0] as MotionTextLayer;
    useProjectStore.setState({ hasOpenProject: true, project: { ...createEmptyProject("Custom animator"), motionCompositions: [{ ...comp, layers: [{ ...layer, textAnimators: [{ ...createMotionTextAnimator("text-reveal-up", "custom-animator"), name: "User {animator}" }] }] }] } });
    render(<PropertiesPanel composition={stored()} />);
    fireEvent.change(screen.getByRole("combobox", { name: ui("Based on", "依据") }), { target: { value: "words" } });
    await waitFor(() => expect((stored().layers[0] as MotionTextLayer).textAnimators![0].selector.basedOn).toBe("words"));
    rerenderStored();
    fireEvent.change(screen.getByRole("combobox", { name: ui("Direction", "方向") }), { target: { value: "center" } });
    await waitFor(() => expect((stored().layers[0] as MotionTextLayer).textAnimators![0].timing.direction).toBe("center"));
    rerenderStored();
    expect(screen.getByText(ui("Words · From center", "单词 · 从中心"))).toBeInTheDocument();
    const field = screen.getByText(ui("Initial Y", "初始 Y")).closest(".astryx-field") as HTMLElement;
    fireEvent.change(within(field).getByRole("spinbutton"), { target: { value: "84" } });
    await waitFor(() => expect((stored().layers[0] as MotionTextLayer).textAnimators![0].properties.position.y).toBe(84));
    const animator = (stored().layers[0] as MotionTextLayer).textAnimators![0];
    expect(animator.name).toBe("User {animator}");
    expect(animator.id).toBe("custom-animator");
    expect(screen.getByText("User {animator}")).toHaveAttribute("data-shotloom-user-content", "");
  });

});
