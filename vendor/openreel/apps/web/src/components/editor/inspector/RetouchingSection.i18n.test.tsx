import "../../../test/install-local-storage-mock";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { RetouchingSection } from "./RetouchingSection";

describe.each(["en-US", "zh-CN"] as const)("retouching properties (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => configureShotloomLocale(locale));
  afterEach(() => { cleanup(); configureShotloomLocale("en-US"); });
  const props = () => ({ activeTool: "cloneStamp" as const, brushConfig: { size: 30, hardness: 0.5, opacity: 0.8, flow: 0.6 }, cloneSource: { x: 12.4, y: 23.6, layerId: "original-layer" }, onToolChange: vi.fn(), onBrushSizeChange: vi.fn(), onBrushHardnessChange: vi.fn(), onBrushOpacityChange: vi.fn(), onBrushFlowChange: vi.fn(), onClearCloneSource: vi.fn() });
  it("selects stable tool IDs and clears the original clone source", () => {
    const p = props(); render(<RetouchingSection {...p} />);
    for (const [en, zh, id] of [["Spot Healing", "污点修复", "spotHeal"], ["Clone Stamp", "仿制图章", "cloneStamp"], ["Red-Eye Removal", "去除红眼", "redEyeRemoval"]]) {
      fireEvent.click(screen.getByRole("button", { name: ui(en, zh) })); expect(p.onToolChange).toHaveBeenLastCalledWith(id);
    }
    expect(screen.getByText("12")).toBeInTheDocument(); expect(screen.getByText("24")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ui("Clear", "清除") })); expect(p.onClearCloneSource).toHaveBeenCalledOnce();
  });
  it("normalizes hardness, opacity and flow independently of the translated labels", () => {
    const p = props(); render(<RetouchingSection {...p} />);
    for (const [en, zh, callback] of [["Hardness", "硬度", p.onBrushHardnessChange], ["Opacity", "不透明度", p.onBrushOpacityChange], ["Flow", "流量", p.onBrushFlowChange]] as const) {
      fireEvent.click(screen.getByRole("button", { name: ui(`Edit ${en} value`, `编辑${zh}数值`) }));
      const input = screen.getByRole("textbox", { name: ui(`${en} value`, `${zh}数值`) });
      fireEvent.change(input, { target: { value: "35" } }); fireEvent.keyDown(input, { key: "Enter" }); expect(callback).toHaveBeenLastCalledWith(0.35);
    }
  });
});
