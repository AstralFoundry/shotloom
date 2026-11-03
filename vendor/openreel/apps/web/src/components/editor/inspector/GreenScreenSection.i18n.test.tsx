import "../../../test/install-local-storage-mock";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChromaKeyEngine, type Clip } from "@openreel/core";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { useEngineStore } from "../../../stores/engine-store";
import { useProjectStore } from "../../../stores/project-store";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { GreenScreenSection } from "./GreenScreenSection";

describe.each(["en-US", "zh-CN"] as const)("chroma key controls (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  let engine: ChromaKeyEngine;
  let original: ReturnType<typeof useEngineStore.getState>["getChromaKeyEngine"];
  beforeEach(() => {
    configureShotloomLocale(locale);
    engine = new ChromaKeyEngine({ width: 1920, height: 1080 });
    original = useEngineStore.getState().getChromaKeyEngine;
    useEngineStore.setState({ getChromaKeyEngine: async () => engine });
    const project = createEmptyProject("User project");
    const clip: Clip = { id: "original-clip", mediaId: "media", trackId: "track", startTime: 0, inPoint: 0, outPoint: 5, duration: 5, effects: [], audioEffects: [], keyframes: [], volume: 1, transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, anchor: { x: 0.5, y: 0.5 } } };
    useProjectStore.setState({ hasOpenProject: true, project: { ...project, modifiedAt: 1, timeline: { ...project.timeline, tracks: [{ id: "track", name: "User track", type: "video", clips: [clip], transitions: [], muted: false, solo: false, locked: false, hidden: false }] } } });
  });
  afterEach(() => {
    cleanup(); configureShotloomLocale("en-US");
    useEngineStore.setState({ getChromaKeyEngine: original });
    useProjectStore.setState({ hasOpenProject: false, project: createEmptyProject("Reset") });
  });
  it("displays the translated empty state and enables the original clip", async () => {
    render(<GreenScreenSection clipId="original-clip" />);
    expect(screen.getByText(ui("Enable to remove background color", "开启后可移除背景颜色"))).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: ui("Enable Green Screen", "开启绿幕抠像") }));
    await waitFor(() => expect(engine.isEnabled("original-clip")).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: ui("Disable chroma key", "关闭色度抠像") }));
    expect(engine.isEnabled("original-clip")).toBe(false);
  });
  it("keeps RGB values and normalized adjustments when choosing translated presets", async () => {
    engine.enableChromaKey("original-clip");
    render(<GreenScreenSection clipId="original-clip" />);
    for (const [en, zh, rgb] of [
      ["Blue", "蓝色", { r: 0, g: 0, b: 1 }],
      ["Magenta", "品红", { r: 1, g: 0, b: 1 }],
      ["Cyan", "青色", { r: 0, g: 1, b: 1 }],
      ["Green", "绿色", { r: 0, g: 1, b: 0 }],
    ] as const) {
      fireEvent.click(await screen.findByRole("checkbox", { name: ui(en, zh) }));
      await waitFor(() => expect(useProjectStore.getState().getClip("original-clip")?.chromaKey?.keyColor).toEqual(rgb));
    }
    fireEvent.keyDown(screen.getByRole("slider", { name: ui("Tolerance", "容差") }), { key: "ArrowRight" });
    await waitFor(() => expect(useProjectStore.getState().getClip("original-clip")?.chromaKey?.tolerance).toBe(0.31));
    fireEvent.click(screen.getAllByRole("button", { name: ui("Pick color from video", "从视频中取色") })[0]);
    expect(screen.getByText(ui("Click on the video preview to pick a color", "点击视频预览以选取颜色"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ui("Reset to Defaults", "恢复默认值") }));
    expect(engine.getSettings("original-clip")).toMatchObject({ enabled: true, tolerance: 0.3, keyColor: { r: 0, g: 1, b: 0 } });
  });
});
