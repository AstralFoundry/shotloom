import { configureShotloomLocale } from "../../../shotloom-mode";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useProjectStore } from "../../../stores/project-store";
import { GeneralPanel } from "./GeneralPanel";

describe.each(["en-US", "zh-CN"] as const)("GeneralPanel (%s)", locale => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  const originalUpdateSettings = useProjectStore.getState().updateSettings;
  const originalProject = useProjectStore.getState().project;
  const updateSettings = vi.fn();

  beforeEach(() => {
    configureShotloomLocale(locale);
    updateSettings.mockResolvedValue({ success: true });
    useProjectStore.setState({
      project: {
        ...originalProject,
        settings: { ...originalProject.settings, frameRate: 30 },
      },
      updateSettings: updateSettings as unknown as typeof originalUpdateSettings,
    });
  });

  afterEach(() => {
    cleanup(); configureShotloomLocale("en-US");
    updateSettings.mockReset();
    useProjectStore.setState({
      project: originalProject,
      updateSettings: originalUpdateSettings,
    });
  });

  it("changes the project editing timebase to 60 fps", () => {
    render(<GeneralPanel />);

    const selector = screen.getByRole("combobox", {
      name: ui("Editing frame rate", "编辑帧率"),
    });
    expect(selector).toHaveValue("30");
    expect(screen.getByRole("option", { name: "60 fps" })).toBeTruthy();

    fireEvent.change(selector, { target: { value: "60" } });

    expect(updateSettings).toHaveBeenCalledWith({ frameRate: 60 });
  });
  it("uses translated presets and dimension labels to submit original numeric values", () => {
    render(<GeneralPanel />);
    fireEvent.click(screen.getByRole("button", { name: ui("9:16 Vertical (TikTok/Reels)", "9:16 竖屏（TikTok/Reels）") }));
    expect(updateSettings).toHaveBeenCalledWith({ width: 1080, height: 1920 });
    fireEvent.change(screen.getByRole("spinbutton", { name: ui("Width", "宽度") }), { target: { value: "1280" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: ui("Height", "高度") }), { target: { value: "720" } });
    fireEvent.click(screen.getByRole("button", { name: ui("Apply", "应用") }));
    expect(updateSettings).toHaveBeenLastCalledWith({ width: 1280, height: 720 });
    expect(screen.getByRole("combobox", { name: ui("Creative tools API format", "创作工具 API 格式") })).toBeInTheDocument();
  });

});
