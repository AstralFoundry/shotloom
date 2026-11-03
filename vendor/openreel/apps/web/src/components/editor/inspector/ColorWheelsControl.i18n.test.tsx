import "../../../test/install-local-storage-mock";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { ColorWheelsControl, DEFAULT_COLOR_WHEEL_VALUES } from "./ColorWheelsControl";

describe.each(["en-US", "zh-CN"] as const)("color wheels (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => configureShotloomLocale(locale));
  afterEach(() => { cleanup(); configureShotloomLocale("en-US"); });
  it("translates tonal ranges and edits the original gamma parameter", () => {
    const onChange = vi.fn(); const onReset = vi.fn();
    render(<ColorWheelsControl values={DEFAULT_COLOR_WHEEL_VALUES} onChange={onChange} onReset={onReset} />);
    for (const [en, zh] of [["Shadows", "阴影"], ["Midtones", "中间调"], ["Highlights", "高光"]]) expect(screen.getByText(ui(en, zh))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ui("Edit Gamma (Midtones) value", "编辑伽马（中间调）数值") }));
    const input = screen.getByRole("textbox", { name: ui("Gamma (Midtones) value", "伽马（中间调）数值") });
    fireEvent.change(input, { target: { value: "1.7" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_COLOR_WHEEL_VALUES, midtonesGamma: 1.7 });
    fireEvent.click(screen.getByRole("button", { name: ui("Reset", "重置") })); expect(onReset).toHaveBeenCalledOnce();
  });
  it("keeps the wheel's RGB callback and double-click reset independent of language", () => {
    const onChange = vi.fn();
    render(<ColorWheelsControl values={{ ...DEFAULT_COLOR_WHEEL_VALUES, shadows: { r: 0.2, g: 0.1, b: 0.3 } }} onChange={onChange} />);
    const wheel = screen.getAllByTitle(ui("Drag to adjust color. Double-click to reset.", "拖动调整颜色，双击重置。"))[0];
    vi.spyOn(wheel, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.mouseDown(wheel, { clientX: 75, clientY: 50 }); fireEvent.mouseUp(document);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ shadows: { r: 0.5, g: -0.25, b: -0 } }));
    fireEvent.doubleClick(wheel);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ shadows: { r: 0, g: 0, b: 0 } }));
  });
});
