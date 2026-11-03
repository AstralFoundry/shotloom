import "../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureShotloomLocale } from "../../shotloom-mode";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import { InspectorPanel } from "./InspectorPanel";

const subtitle = { id: "original-subtitle", text: "用户对白 · original", startTime: 1.25, endTime: 3.5, animationStyle: "none" as const,
  style: { fontFamily: "Inter", fontSize: 24, color: "#ffffff", backgroundColor: "#000000", position: "bottom" as const } };

describe.each(["en-US", "zh-CN"] as const)("subtitle inspector (%s)", locale => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  const originalGet = useProjectStore.getState().getSubtitle;
  const originalUpdate = useProjectStore.getState().updateSubtitle;
  const originalRemove = useProjectStore.getState().removeSubtitle;
  beforeEach(() => {
    configureShotloomLocale(locale);
    const project = createEmptyProject("用户工程");
    useProjectStore.setState({ project: { ...project, timeline: { ...project.timeline, subtitles: [subtitle] } }, getSubtitle: vi.fn(() => subtitle), updateSubtitle: vi.fn(), removeSubtitle: vi.fn() });
    useUIStore.getState().select({ type: "subtitle", id: subtitle.id });
  });
  afterEach(() => {
    cleanup(); useUIStore.getState().clearSelection(); configureShotloomLocale("en-US");
    useProjectStore.setState({ getSubtitle: originalGet, updateSubtitle: originalUpdate, removeSubtitle: originalRemove });
  });
  it("edits authored text and timing through translated controls using the original ID", async () => {
    render(<InspectorPanel />);
    await act(async () => {});
    fireEvent.click(screen.getByText(ui("Text Content", "文字内容")));
    fireEvent.click(screen.getByText(ui("Timing", "时序")));
    const text = screen.getByRole("textbox", { name: ui("Subtitle text", "字幕文字") });
    expect(text).toHaveValue(subtitle.text);
    expect(screen.getByText(ui("1.25s - 3.50s", "1.25 秒 - 3.50 秒"))).toBeInTheDocument();
    fireEvent.change(text, { target: { value: "新的对白" } });
    expect(useProjectStore.getState().updateSubtitle).toHaveBeenCalledWith(subtitle.id, { text: "新的对白" });
    const start = screen.getByRole("spinbutton", { name: ui("Start Time", "开始时间") });
    fireEvent.change(start, { target: { value: "2" } });
    expect(useProjectStore.getState().updateSubtitle).toHaveBeenCalledWith(subtitle.id, { startTime: 2 });
    fireEvent.click(screen.getByRole("button", { name: ui("Delete Subtitle", "删除字幕") }));
    expect(useProjectStore.getState().removeSubtitle).toHaveBeenCalledWith(subtitle.id);
  });
  it("translates position and animation while keeping protocol values", async () => {
    render(<InspectorPanel />);
    await act(async () => {});
    fireEvent.click(screen.getByText(ui("Position", "位置")));
    fireEvent.click(screen.getByRole("checkbox", { name: ui("top", "顶部") }));
    expect(useProjectStore.getState().updateSubtitle).toHaveBeenCalledWith(subtitle.id, { style: { ...subtitle.style, position: "top" } });
    fireEvent.click(screen.getByText(ui("Animation", "动画")));
    expect(screen.getByText(ui("Static text, no animation", "静态文字，无动画"))).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: ui("Animation style", "动画样式") })).toBeInTheDocument();
    fireEvent.click(screen.getByText(ui("Font", "字体")));
    expect(screen.getByRole("combobox", { name: ui("Font family", "字体名称") })).toBeInTheDocument();
  });

});
