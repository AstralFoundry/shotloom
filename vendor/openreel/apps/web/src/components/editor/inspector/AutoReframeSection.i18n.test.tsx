import "../../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { useProjectStore } from "../../../stores/project-store";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { AutoReframeSection } from "./AutoReframeSection";
const fixture = vi.hoisted(() => ({ available: true }));
vi.mock("@openreel/core", async (original) => ({
  ...await original<typeof import("@openreel/core")>(),
  getAutoReframeEngine: () => fixture.available ? { isInitialized: () => true } : null,
  initializeAutoReframeEngine: () => ({ initialize: async (progress: (n: number, message: string) => void) => { progress(10, "Initializing auto-reframe engine..."); progress(100, "Auto-reframe engine ready"); } }),
}));
describe.each(["en-US", "zh-CN"] as const)("auto reframe (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => {
    configureShotloomLocale(locale); fixture.available = true;
    useProjectStore.setState({ hasOpenProject: true, project: createEmptyProject("Original project") });
  });
  afterEach(() => { cleanup(); configureShotloomLocale("en-US"); });
  it("applies a translated ratio choice to actual project dimensions", async () => {
    const complete = vi.fn();
    render(<AutoReframeSection clipId="original-clip" onReframeComplete={complete} />);
    fireEvent.click(screen.getByRole("button", { name: ui("4:5 aspect ratio", "4:5 宽高比") }));
    expect(screen.getByText(ui("Output: 1080 x 1350", "输出：1080 × 1350"))).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: ui("Analyze & Reframe", "分析并重构图") })); });
    await waitFor(() => expect(complete).toHaveBeenCalledWith(expect.objectContaining({ success: true, outputWidth: 1080, outputHeight: 1350, message: ui("Configured for 4:5 (1080x1350)", "已配置为 4:5（1080×1350）") })));
    expect(useProjectStore.getState().project.settings).toMatchObject({ width: 1080, height: 1350 });
    expect(screen.getByRole("button", { name: ui("Applied - Click to Reanalyze", "已应用，点击重新分析") })).toBeEnabled();
  });
  it("preserves platform ratios and produces no success receipt when engine is missing", async () => {
    fixture.available = false;
    const complete = vi.fn();
    render(<AutoReframeSection clipId="original-clip" onReframeComplete={complete} />);
    fireEvent.click(screen.getByRole("button", { name: ui("Instagram Feed platform preset", "Instagram Feed 平台预设") }));
    expect(screen.getByText(ui("Output: 1080 x 1080", "输出：1080 × 1080"))).toBeInTheDocument();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: ui("Analyze & Reframe", "分析并重构图") })); });
    expect(complete).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: ui("Analyze & Reframe", "分析并重构图") })).toBeEnabled();
    expect(error).toHaveBeenCalledWith("Auto-reframe failed:", expect.objectContaining({ message: ui("Engine not available", "引擎不可用") }));
    error.mockRestore();
  });
});
