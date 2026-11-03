import "../../../test/install-local-storage-mock";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PhotoLayer } from "@openreel/core";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { PhotoLayersSection } from "./PhotoLayersSection";
const layer = (id: string): PhotoLayer => ({ id, name: `Original {name} ${id}`, type: "image", content: null, opacity: 0.8, blendMode: "normal", visible: true, locked: false, mask: null, adjustments: [], transform: { x: 0, y: 0, scale: 1, rotation: 0, anchorX: 0.5, anchorY: 0.5 } });
const modes = [
  ["normal", "Normal", "正常"], ["multiply", "Multiply", "正片叠底"], ["screen", "Screen", "滤色"], ["overlay", "Overlay", "叠加"],
  ["softLight", "Soft Light", "柔光"], ["hardLight", "Hard Light", "强光"], ["colorDodge", "Color Dodge", "颜色减淡"], ["colorBurn", "Color Burn", "颜色加深"],
  ["difference", "Difference", "差值"], ["exclusion", "Exclusion", "排除"], ["hue", "Hue", "色相"], ["saturation", "Saturation", "饱和度"], ["color", "Color", "颜色"], ["luminosity", "Luminosity", "明度"],
] as const;
describe.each(["en-US", "zh-CN"] as const)("photo layers (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  const callbacks = () => ({ onSelectLayer: vi.fn(), onToggleVisibility: vi.fn(), onToggleLock: vi.fn(), onSetOpacity: vi.fn(), onSetBlendMode: vi.fn(), onReorderLayers: vi.fn(), onAddLayer: vi.fn(), onDeleteLayer: vi.fn(), onDuplicateLayer: vi.fn() });
  beforeEach(() => configureShotloomLocale(locale));
  afterEach(() => { cleanup(); configureShotloomLocale("en-US"); });
  it("selects all translated modes using original protocol values", () => {
    const actions = callbacks();
    render(<PhotoLayersSection layers={[layer("id")]} selectedLayerIndex={0} {...actions} />);
    fireEvent.click(screen.getByRole("button", { name: ui("Normal", "正常") }));
    for (const [value, en, zh] of modes) {
      fireEvent.click(screen.getByRole("button", { name: ui(`Set blend mode to ${en}`, `将混合模式设为${zh}`) }));
      expect(actions.onSetBlendMode).toHaveBeenLastCalledWith("id", value);
    }
  });
  it("preserves user names, layer IDs and fractional opacity across actions", () => {
    const actions = callbacks();
    render(<PhotoLayersSection layers={[layer("first"), layer("second")]} selectedLayerIndex={0} {...actions} />);
    expect(screen.getByText("Original {name} first")).toBeInTheDocument();
    expect(screen.getAllByText(ui("Image", "图像"))).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: ui("Hide layer", "隐藏图层") })[0]);
    expect(actions.onToggleVisibility).toHaveBeenCalledWith("second");
    expect(actions.onSelectLayer).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("button", { name: ui("Lock layer", "锁定图层") })[0]);
    expect(actions.onToggleLock).toHaveBeenCalledWith("second");
    fireEvent.click(screen.getByRole("button", { name: ui("Duplicate", "复制") }));
    expect(actions.onDuplicateLayer).toHaveBeenCalledWith("first");
    fireEvent.click(screen.getByRole("button", { name: ui("Delete", "删除") }));
    expect(actions.onDeleteLayer).toHaveBeenCalledWith("first");
    fireEvent.click(screen.getByRole("button", { name: ui("Edit Opacity value", "编辑不透明度数值") }));
    const input = screen.getByRole("textbox", { name: ui("Opacity value", "不透明度数值") });
    fireEvent.change(input, { target: { value: "45" } }); fireEvent.keyDown(input, { key: "Enter" });
    expect(actions.onSetOpacity).toHaveBeenLastCalledWith("first", 0.45);
  });
  it("offers a localized empty state and protects the last layer from deletion", () => {
    const actions = callbacks();
    const view = render(<PhotoLayersSection layers={[]} selectedLayerIndex={-1} {...actions} />);
    expect(screen.getByText(ui("No layers", "暂无图层"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ui("Add Layer", "添加图层") }));
    expect(actions.onAddLayer).toHaveBeenCalledOnce();
    view.rerender(<PhotoLayersSection layers={[{ ...layer("id"), locked: true, visible: false }]} selectedLayerIndex={0} {...actions} />);
    expect(screen.getByRole("button", { name: ui("Delete", "删除") })).toBeDisabled();
    expect(screen.getByRole("button", { name: ui("Unlock layer", "解锁图层") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ui("Show layer", "显示图层") })).toBeInTheDocument();
  });
});
