import "../../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LUTData } from "@openreel/core";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { LUTLoader } from "./LUTLoader";

describe.each(["en-US", "zh-CN"] as const)("LUT import (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => {
    configureShotloomLocale(locale);
    vi.stubGlobal("DataTransfer", class {
      files: File[] = [];
      items = { add: (file: File) => this.files.push(file) };
    });
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); configureShotloomLocale("en-US"); });
  const select = (name: string, content: string, reject?: unknown) => {
    const file = new File([content], name);
    Object.defineProperty(file, "text", { value: reject === undefined ? async () => content : async () => { throw reject; } });
    fireEvent.change(screen.getByLabelText(ui("Load LUT file", "加载 LUT 文件")).parentElement!.querySelector("input")!, { target: { files: [file] } });
  };
  it("parses a real cube, preserves its filename and adjusts fractional intensity", async () => {
    const change = vi.fn();
    const view = render(<LUTLoader lutData={null} onChange={change} />);
    select("原始 {name}.cube", "TITLE original\nLUT_3D_SIZE 2\n" + Array(8).fill("0 0.5 1").join("\n"));
    await waitFor(() => expect(change).toHaveBeenCalledOnce());
    const lut = change.mock.calls[0][0] as LUTData;
    expect(lut).toMatchObject({ size: 2, intensity: 1 });
    expect([...lut.data]).toEqual(Array(8).fill([0, 128, 255]).flat());
    view.rerender(<LUTLoader lutData={lut} onChange={change} />);
    expect(screen.getByText("原始 {name}.cube")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ui("Edit Intensity value", "编辑强度数值") }));
    const input = screen.getByRole("textbox", { name: ui("Intensity value", "强度数值") });
    fireEvent.change(input, { target: { value: "35" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(change).toHaveBeenLastCalledWith({ ...lut, intensity: 0.35 });
    fireEvent.click(screen.getByRole("button", { name: ui("Remove LUT", "移除 LUT") }));
    expect(change).toHaveBeenLastCalledWith(null);
  });
  it("parses 3dl values without translating file contents", async () => {
    const change = vi.fn();
    render(<LUTLoader lutData={null} onChange={change} />);
    select("original.3dl", Array(8).fill("0 4095 0").join("\n"));
    await waitFor(() => expect(change).toHaveBeenCalledOnce());
    expect(change.mock.calls[0][0]).toMatchObject({ size: 2, intensity: 1, data: new Uint8Array(Array(8).fill([0, 255, 0]).flat()) });
  });
  it("reports localized structural errors and retains upstream read errors", async () => {
    const change = vi.fn(), error = vi.fn();
    render(<LUTLoader lutData={null} onChange={change} onError={error} />);
    for (const [name, content, expected] of [
      ["invalid.cube", "LUT_3D_SIZE 999", ui("Invalid LUT size: 999", "无效的 LUT 尺寸：999")],
      ["missing.cube", "0 0 0", ui("LUT size not specified in file", "文件中未指定 LUT 尺寸")],
      ["short.cube", "LUT_3D_SIZE 2\n0 0 0", ui("Invalid LUT data: expected 24 values, got 3", "无效的 LUT 数据：需要 24 个数值，实际为 3 个")],
      ["bad.png", "bad", ui("Unsupported file format. Please use .cube or .3dl files.", "不支持此文件格式，请使用 .cube 或 .3dl 文件。")],
    ]) {
      await act(async () => { select(name, content); });
      expect(error).toHaveBeenLastCalledWith(expected);
      expect(screen.getByText(expected)).toBeInTheDocument();
    }
    await act(async () => { select("read.cube", "", new Error("Original failure {name}")); });
    expect(error).toHaveBeenLastCalledWith("Original failure {name}");
    await act(async () => { select("read.cube", "", "failure"); });
    expect(error).toHaveBeenLastCalledWith(ui("Failed to parse LUT file", "解析 LUT 文件失败"));
    expect(change).not.toHaveBeenCalled();
  });
});
