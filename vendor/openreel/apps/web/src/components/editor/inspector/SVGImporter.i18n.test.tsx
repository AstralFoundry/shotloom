import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { SVGImporter } from "./SVGImporter";
const bridge = vi.hoisted(() => ({ isInitialized: vi.fn(() => true), initialize: vi.fn(), validateSVG: vi.fn((_svg: string) => ({ valid: true, error: undefined as string | undefined })), importSVG: vi.fn((_options: unknown) => ({ id: "real-bridge-id" })) }));
vi.mock("../../../bridges", () => ({ getGraphicsBridge: () => bridge }));

describe.each(["en-US", "zh-CN"] as const)("SVG import (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => { configureShotloomLocale(locale); vi.clearAllMocks(); bridge.validateSVG.mockReturnValue({ valid: true, error: undefined }); });
  afterEach(() => { cleanup(); configureShotloomLocale("en-US"); });
  const select = (file: File) => fireEvent.change(screen.getByLabelText(ui("Import SVG file", "导入 SVG 文件")).parentElement!.querySelector("input")!, { target: { files: [file] } });

  it("rejects an incompatible extension with translated feedback and clears the error", () => {
    const error = vi.fn(); render(<SVGImporter trackId="track" startTime={2} onError={error} />);
    select(new File(["not svg"], "素材.png"));
    expect(error).toHaveBeenCalledWith(ui("Please select an SVG file (.svg)", "请选择 SVG 文件（.svg）"));
    expect(bridge.importSVG).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: ui("Clear SVG import error", "清除 SVG 导入错误") }));
    expect(screen.getByText(ui("Click or drag & drop", "点击或拖放文件"))).toBeInTheDocument();
  });

  it("imports the exact SVG, track and timing while preserving the file name", async () => {
    const imported = vi.fn(); render(<SVGImporter trackId="original-track" startTime={2.5} duration={7} onImport={imported} />);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>';
    const name = "原始文件 {name}.svg";
    select(new File([svg], name, { type: "image/svg+xml" }));
    await waitFor(() => expect(imported).toHaveBeenCalledWith("real-bridge-id"));
    expect(bridge.importSVG).toHaveBeenCalledWith({ trackId: "original-track", startTime: 2.5, duration: 7, svgContent: svg });
    expect(screen.getByText(name)).toBeInTheDocument();
    expect(screen.getByText(ui("SVG imported successfully", "SVG 导入成功"))).toBeInTheDocument();
  });

  it("keeps original validation details and does not import rejected SVG", async () => {
    bridge.validateSVG.mockReturnValueOnce({ valid: false, error: "original validator detail {name}" });
    const error = vi.fn(); render(<SVGImporter trackId="track" startTime={0} onError={error} />);
    select(new File(["<svg/>"], "valid.svg"));
    await waitFor(() => expect(error).toHaveBeenCalledWith("original validator detail {name}"));
    expect(screen.getByText("original validator detail {name}")).toBeInTheDocument();
    expect(bridge.importSVG).not.toHaveBeenCalled();
  });
});
