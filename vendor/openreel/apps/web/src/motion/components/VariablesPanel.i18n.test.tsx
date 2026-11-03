import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DEFAULT_MOTION_TRANSFORM, createMotionVariable, type MotionComposition, type MotionShapeLayer } from "@openreel/core";
import { configureShotloomLocale } from "../../shotloom-mode";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useMotionStore } from "../stores/motion-store";
import { VariablesPanel } from "./VariablesPanel";

function composition(): MotionComposition {
  const layer: MotionShapeLayer = { id: "shape", type: "shape", name: "Color {keep}", startTime: 0, duration: 5, visible: true, locked: false, transform: DEFAULT_MOTION_TRANSFORM, keyframes: [], shapeType: "rectangle", width: 200, height: 100, style: { fill: { type: "solid", color: "#ffffff", opacity: 1 }, stroke: { color: "#000000", width: 1, opacity: 1 } } };
  return { id: "comp", name: "Comp", width: 1280, height: 720, duration: 5, frameRate: 30, backgroundColor: "#000000", layers: [layer], assets: [], variables: [], markers: [], createdAt: 1, modifiedAt: 1 };
}
function stored() { return useProjectStore.getState().project.motionCompositions![0]; }
function mount(comp = composition()) {
  useProjectStore.setState({ hasOpenProject: true, project: { ...createEmptyProject("Variables"), motionCompositions: [comp] } });
  const view = render(<VariablesPanel composition={comp} embedded />);
  return () => view.rerender(<VariablesPanel composition={stored()} embedded />);
}
const types = [["text", "Text", "文字"], ["number", "Number", "数值"], ["color", "Color", "颜色"], ["boolean", "Toggle", "开关"], ["media", "Media", "媒体"]] as const;
describe.each(["en-US", "zh-CN"] as const)("VariablesPanel (%s)", locale => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => { configureShotloomLocale(locale); useMotionStore.setState({ selectedLayerId: "shape", selectedLayerIds: ["shape"] }); });
  afterEach(() => { cleanup(); configureShotloomLocale("en-US"); useProjectStore.setState({ hasOpenProject: false }); });

  it.each(types)("creates and edits a %s variable using stable values", async (type, en, zh) => {
    const refresh = mount();
    fireEvent.click(screen.getByRole("button", { name: ui(`Add ${en} variable`, `添加${zh}变量`) }));
    await waitFor(() => expect(stored().variables).toHaveLength(1));
    expect(stored().variables[0]).toMatchObject({ type, name: ui(en, zh) });
    refresh();
    expect(screen.getByRole("option", { name: ui(en, zh) })).toHaveValue(type);
    const expected = type === "number" ? 42 : type === "boolean" ? true : type === "color" ? "#123456" : "Original {value} 原文";
    if (type === "number") fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "42" } });
    else if (type === "boolean") fireEvent.click(screen.getByRole("switch", { name: ui("Value", "值") }));
    else {
      const input = type === "media" ? screen.getByPlaceholderText(ui("Media placeholder id", "媒体占位符 ID")) : screen.getAllByRole("textbox")[1];
      fireEvent.change(input, { target: { value: expected } });
    }
    await waitFor(() => expect(stored().variables[0].value).toBe(expected));
    refresh();
    fireEvent.click(screen.getByRole("button", { name: ui("Remove variable", "移除变量") }));
    await waitFor(() => expect(stored().variables).toHaveLength(0));
  });

  it("binds to a numeric shape target and removes the original binding", async () => {
    const comp = { ...composition(), variables: [createMotionVariable("number", { id: "var", name: "Number {keep}", value: 75 })] };
    const refresh = mount(comp);
    expect(screen.getByText("Number {keep}")).toHaveAttribute("data-shotloom-user-content");
    expect(screen.getByRole("option", { name: ui("Shape width", "形状宽度") })).toHaveValue("shape.width");
    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "shape.width" } });
    fireEvent.click(screen.getByRole("button", { name: ui("Bind variable to selected layer", "将变量绑定到所选图层") }));
    await waitFor(() => expect(stored().layers[0].variableBindings?.[0]).toMatchObject({ variableId: "var", target: "shape.width" }));
    refresh();
    expect(screen.getByText("Color {keep}")).toHaveAttribute("data-shotloom-user-content");
    expect(stored().variables[0].name).toBe("Number {keep}");
    fireEvent.click(screen.getByRole("button", { name: ui("Remove binding", "移除绑定") }));
    await waitFor(() => expect(stored().layers[0].variableBindings ?? []).toHaveLength(0));
  });

  it("shows a translated prompt when no layer is selected", () => {
    useMotionStore.setState({ selectedLayerId: null });
    mount({ ...composition(), variables: [createMotionVariable("text", { name: "User {name}" })] });
    expect(screen.getByText(ui("Select a compatible layer to bind this variable.", "选择兼容图层以绑定此变量。"))).toBeInTheDocument();
    expect(screen.getByDisplayValue("User {name}")).toBeInTheDocument();
  });
});
