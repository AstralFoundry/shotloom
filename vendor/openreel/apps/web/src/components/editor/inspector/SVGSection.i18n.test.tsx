import "../../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GraphicsEngine, SVG_ANIMATION_PRESETS } from "@openreel/core";
import { configureShotloomLocale, editorMessage } from "../../../shotloom-mode";
import { useEngineStore } from "../../../stores/engine-store";
import { useProjectStore } from "../../../stores/project-store";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { SVGSection } from "./SVGSection";

describe.each(["en-US", "zh-CN"] as const)("SVG properties (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  let original: ReturnType<typeof useEngineStore.getState>["getGraphicsEngine"];
  let clipId: string;
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M0 0L100 100"/></svg>';
  beforeEach(() => {
    configureShotloomLocale(locale);
    const engine = new GraphicsEngine();
    original = useEngineStore.getState().getGraphicsEngine;
    useEngineStore.setState({ getGraphicsEngine: () => engine });
    const project = createEmptyProject("User project");
    useProjectStore.setState({ hasOpenProject: true, project: { ...project, timeline: { ...project.timeline, tracks: [{ id: "track", name: "User track", type: "video", clips: [], transitions: [], locked: false, hidden: false, muted: false, solo: false }] } } });
    clipId = useProjectStore.getState().importSVG(svg, "track", 2, 5)!.id;
  });
  afterEach(() => { cleanup(); configureShotloomLocale("en-US"); useEngineStore.setState({ getGraphicsEngine: original }); useProjectStore.setState({ hasOpenProject: false, project: createEmptyProject("Reset") }); });
  it("shows a translated empty state for an unknown ID", () => {
    render(<SVGSection clipId="missing" />);
    expect(screen.getByText(ui("No SVG clip selected", "未选择 SVG 片段"))).toBeInTheDocument();
  });
  it("keeps SVG source, color mode and normalized opacity when edited in either language", async () => {
    render(<SVGSection clipId={clipId} />);
    fireEvent.click(screen.getByRole("button", { name: ui("Set SVG color mode to Tint", "将 SVG 颜色模式设为着色") }));
    expect(useProjectStore.getState().getSVGClip(clipId)?.colorStyle?.colorMode).toBe("tint");
    fireEvent.click(screen.getByRole("button", { name: ui("Edit Opacity value", "编辑不透明度数值") }));
    const input = screen.getByRole("textbox", { name: ui("Opacity value", "不透明度数值") });
    fireEvent.change(input, { target: { value: "0.4" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(useProjectStore.getState().getSVGClip(clipId)?.colorStyle?.tintOpacity).toBe(0.4);
    expect(useProjectStore.getState().getSVGClip(clipId)?.svgContent).toBe(svg);
    expect(useProjectStore.getState().project.svgClips?.[0].colorStyle?.tintOpacity).toBe(0.4);
  });
  it("lists every translated preset and persists the original entry/exit animation IDs", async () => {
    render(<SVGSection clipId={clipId} />);
    const entry = screen.getByRole("combobox", { name: ui("Entry Animation", "入场动画") });
    const exit = screen.getByRole("combobox", { name: ui("Exit Animation", "退场动画") });
    for (const preset of SVG_ANIMATION_PRESETS) {
      const key = `editor.svgControls.preset.${preset.id}` as Parameters<typeof editorMessage>[0];
      expect(Array.from(entry.querySelectorAll("option")).some(o => o.value === preset.id && o.textContent === editorMessage(key))).toBe(true);
      await act(async () => fireEvent.change(entry, { target: { value: preset.id } }));
      expect(useProjectStore.getState().getSVGClip(clipId)?.entryAnimation?.type).toBe(preset.id);
    }
    fireEvent.click(screen.getByRole("button", { name: ui("Edit Duration value", "编辑时长数值") }));
    const duration = screen.getByRole("textbox", { name: ui("Duration value", "时长数值") });
    fireEvent.change(duration, { target: { value: "1.2" } }); fireEvent.keyDown(duration, { key: "Enter" });
    expect(useProjectStore.getState().getSVGClip(clipId)?.entryAnimation?.duration).toBe(1.2);
    await act(async () => fireEvent.change(exit, { target: { value: "draw" } }));
    expect(useProjectStore.getState().getSVGClip(clipId)?.exitAnimation).toMatchObject({ type: "draw", duration: 0.5, easing: "ease-in" });
  });
});
