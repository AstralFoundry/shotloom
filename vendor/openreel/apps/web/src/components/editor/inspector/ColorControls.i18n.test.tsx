import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { HSLControls, DEFAULT_HSL_VALUES } from "./HSLControls";
import { CurvesEditor, DEFAULT_CURVES } from "./CurvesEditor";
import { ScopesPanel } from "./ScopesPanel";
const bridge = vi.hoisted(() => ({ generateWaveform: vi.fn(async (_frame: unknown) => null), generateVectorscope: vi.fn(async (_frame: unknown, _size: number) => null), generateHistogram: vi.fn(async (_frame: unknown) => null) }));
vi.mock("../../../bridges/effects-bridge", () => ({ getEffectsBridge: () => bridge }));

describe.each(["en-US", "zh-CN"] as const)("color controls (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => { configureShotloomLocale(locale); vi.clearAllMocks(); });
  afterEach(() => { cleanup(); configureShotloomLocale("en-US"); });

  it("updates only the selected HSL range and resets without changing the array indices", () => {
    const change = vi.fn(); const reset = vi.fn();
    function Harness() {
      const [values, setValues] = useState({ ...DEFAULT_HSL_VALUES, hue: [12, 0, 0, 0, 0, 0, 0, 0] });
      return <HSLControls values={values} onChange={(next) => { change(next); setValues(next); }} onReset={reset} />;
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: ui("Blues", "蓝色") }));
    fireEvent.click(screen.getByRole("button", { name: ui("Edit Saturation value", "编辑饱和度数值") }));
    const input = screen.getByRole("textbox", { name: ui("Saturation value", "饱和度数值") });
    fireEvent.change(input, { target: { value: "35" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(change).toHaveBeenLastCalledWith({ hue: [12, 0, 0, 0, 0, 0, 0, 0], saturation: [0, 0, 0, 0, 0, 0.35, 0, 0], luminance: [0, 0, 0, 0, 0, 0, 0, 0] });
    expect(screen.getByTitle(ui("Blues (adjusted)", "蓝色（已调整）"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ui("Reset", "重置") }));
    expect(change.mock.lastCall?.[0].hue[0]).toBe(12);
    expect(change.mock.lastCall?.[0].saturation[5]).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: ui("Reset All", "全部重置") }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it("adds a point to the original red channel and resets that channel", () => {
    const change = vi.fn();
    function Harness() {
      const [values, setValues] = useState(DEFAULT_CURVES);
      return <CurvesEditor values={values} onChange={(next) => { change(next); setValues(next); }} />;
    }
    const { container } = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: ui("Select R curve channel", "选择 R 曲线通道") }));
    fireEvent.click(container.querySelector("svg.cursor-crosshair")!, { clientX: 100, clientY: 100 });
    expect(change.mock.lastCall?.[0].red).toEqual([{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }]);
    expect(change.mock.lastCall?.[0].rgb).toEqual(DEFAULT_CURVES.rgb);
    expect(screen.getByText(ui("Click to add point • Double-click to remove", "单击添加控制点 · 双击移除"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ui("Reset", "重置") }));
    expect(change.mock.lastCall?.[0].red).toEqual(DEFAULT_CURVES.red);
  });

  it("switches scope views with translated explanations and the original frame", async () => {
    const frame = { width: 2, height: 2 } as ImageBitmap;
    render(<ScopesPanel frameImage={frame} />);
    await waitFor(() => expect(bridge.generateWaveform).toHaveBeenCalledWith(frame));
    fireEvent.click(await screen.findByRole("button", { name: ui("Show RGB", "显示 RGB") }));
    expect(screen.getByText(ui("RGB Parade", "RGB 分量图"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ui("Vectorscope", "矢量示波器") }));
    await waitFor(() => expect(bridge.generateVectorscope).toHaveBeenCalledWith(frame, 256));
    expect(screen.getByText(ui("Vectorscope shows color saturation and hue distribution.", "矢量示波器显示色彩的饱和度与色相分布。"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ui("Histogram", "直方图") }));
    await waitFor(() => expect(bridge.generateHistogram).toHaveBeenCalledWith(frame));
  });

  it("shows the translated empty scope without starting analysis", () => {
    render(<ScopesPanel />);
    expect(screen.getByText(ui("No frame to analyze", "没有可分析的画面"))).toBeInTheDocument();
    expect(bridge.generateWaveform).not.toHaveBeenCalled();
  });
});
