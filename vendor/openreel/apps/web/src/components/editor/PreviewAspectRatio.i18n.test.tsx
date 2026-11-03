import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureShotloomLocale } from "../../shotloom-mode";
import { AspectRatioControl } from "./Preview";

describe.each(["en-US", "zh-CN"] as const)("Preview aspect ratio (%s)", locale => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => configureShotloomLocale(locale));
  afterEach(() => { cleanup(); configureShotloomLocale("en-US"); });
  it("applies the original media dimensions and closes the localized menu", () => {
    const onChange = vi.fn();
    render(<AspectRatioControl width={1920} height={1080} sourceWidth={2048} sourceHeight={2048} onChange={onChange} />);
    fireEvent.click(screen.getByTitle(ui("Aspect ratio", "画面比例")));
    fireEvent.click(screen.getByRole("menuitemradio", { name: ui("Fit (Original)", "适应（原始）") }));
    expect(onChange).toHaveBeenCalledWith(2048, 2048);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
  it("applies all preset dimensions including the localized phone label", () => {
    const onChange = vi.fn();
    render(<AspectRatioControl width={1920} height={1080} onChange={onChange} />);
    for (const [name, width, height] of [
      ["16:9", 1920, 1080], ["4:3", 1440, 1080], ["2.35:1", 2538, 1080],
      ["2:1", 2160, 1080], ["1.85:1", 1998, 1080], ["9:16", 1080, 1920],
      ["3:4", 1080, 1440], [ui("5.8-inch", "5.8 英寸"), 1125, 2436],
      ["1:1", 1080, 1080], ["1:2", 1080, 2160],
    ] as const) {
      fireEvent.click(screen.getByTitle(ui("Aspect ratio", "画面比例")));
      fireEvent.click(screen.getByRole("menuitemradio", { name }));
      expect(onChange).toHaveBeenLastCalledWith(width, height);
    }
    expect(onChange).toHaveBeenCalledTimes(10);
  });
  it("validates custom dimensions and submits rounded pixel values", () => {
    const onChange = vi.fn();
    render(<AspectRatioControl width={1920} height={1080} onChange={onChange} />);
    fireEvent.click(screen.getByTitle(ui("Aspect ratio", "画面比例")));
    fireEvent.click(screen.getByRole("menuitem", { name: ui("Custom", "自定义") }));
    const width = screen.getByRole("spinbutton", { name: ui("Custom width", "自定义宽度") });
    const height = screen.getByRole("spinbutton", { name: ui("Custom height", "自定义高度") });
    fireEvent.change(width, { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: ui("Apply", "应用") }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(width, { target: { value: "1200.4" } });
    fireEvent.change(height, { target: { value: "900.6" } });
    fireEvent.keyDown(height, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(1200, 901);
  });
  it("disables original fit without source dimensions and supports Escape dismissal", () => {
    render(<AspectRatioControl width={1920} height={1080} onChange={vi.fn()} />);
    fireEvent.click(screen.getByTitle(ui("Aspect ratio", "画面比例")));
    expect(screen.getByRole("menuitemradio", { name: ui("Fit (Original)", "适应（原始）") })).toBeDisabled();
    expect(screen.getByRole("button", { name: ui("Close menu", "关闭菜单") })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
