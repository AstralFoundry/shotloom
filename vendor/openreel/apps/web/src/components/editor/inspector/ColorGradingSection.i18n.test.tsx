import "../../../test/install-local-storage-mock";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { VideoEffectsEngine, ColorGradingEngine, type Project } from "@openreel/core";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import { getEffectsBridge, disposeEffectsBridge } from "../../../bridges/effects-bridge";
import { ColorGradingSection } from "./ColorGradingSection";

function projectWithClip(): Project {
  const project = createEmptyProject("Adjustment workflow");
  return {
    ...project,
    timeline: {
      ...project.timeline,
      duration: 8,
      tracks: [{
        id: "video-track",
        type: "video",
        name: "Video",
        locked: false,
        hidden: false,
        muted: false,
        solo: false,
        transitions: [],
        clips: [{
          id: "clip-1",
          mediaId: "media-1",
          trackId: "video-track",
          startTime: 1,
          duration: 4,
          inPoint: 0,
          outPoint: 4,
          transform: {
            position: { x: 0, y: 0 },
            scale: { x: 1, y: 1 },
            rotation: 0,
            anchor: { x: 0.5, y: 0.5 },
            opacity: 1,
          },
          effects: [],
          audioEffects: [],
          volume: 1,
          keyframes: [],
        }],
      }],
    },
  };
}

describe.each(["en-US", "zh-CN"] as const)("ColorGradingSection (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(async () => {
    configureShotloomLocale(locale);
    vi.spyOn(VideoEffectsEngine.prototype, "initialize").mockResolvedValue(true);
    vi.spyOn(ColorGradingEngine.prototype, "initialize").mockImplementation(() => {});
    vi.spyOn(VideoEffectsEngine.prototype, "dispose").mockImplementation(() => {});
    vi.spyOn(ColorGradingEngine.prototype, "dispose").mockImplementation(() => {});
    await getEffectsBridge().initialize(320, 180);
    useProjectStore.setState({ project: projectWithClip(), hasOpenProject: true });
  });
  afterEach(() => {
    cleanup();
    disposeEffectsBridge();
    vi.restoreAllMocks();
    configureShotloomLocale("en-US");
    useProjectStore.setState({ project: createEmptyProject("Reset"), hasOpenProject: false });
  });
  const persisted = () => useProjectStore.getState().project.timeline.tracks[0].clips[0].colorGrading;
  function edit(label: string, value: string) {
    fireEvent.click(screen.getByRole("button", { name: ui(`Edit ${label} value`, `编辑${label}数值`) }));
    const input = screen.getByRole("textbox", { name: ui(`${label} value`, `${label}数值`) });
    fireEvent.change(input, { target: { value } });
    fireEvent.blur(input);
  }

  it.each([
    { en: "Tungsten", zh: "钨丝灯", temperature: -40, tint: 8 },
    { en: "Fluorescent", zh: "荧光灯", temperature: -15, tint: -10 },
    { en: "Daylight", zh: "日光", temperature: 0, tint: 0 },
    { en: "Cloudy", zh: "阴天", temperature: 15, tint: 0 },
    { en: "Shade", zh: "阴影", temperature: 30, tint: 5 },
  ])("applies the localized $en preset with original values", async ({ en, zh, temperature, tint }) => {
    render(<ColorGradingSection clipId="clip-1" />);
    fireEvent.click(screen.getByRole("button", { name: ui(`Apply ${en} white balance`, `应用${zh}白平衡`) }));
    await waitFor(() => expect(persisted()).toMatchObject({ temperature, tint }));
    expect(getEffectsBridge().getColorGrading("clip-1")).toMatchObject({ temperature, tint });
    expect(screen.getByRole("button", { name: ui("Edit Temperature value", "编辑色温数值") })).toHaveTextContent(`${temperature > 0 ? "+" : ""}${temperature}`);
  });

  it("edits and resets white balance without discarding other grading", async () => {
    await act(async () => { await useProjectStore.getState().updateColorGrading("clip-1", { hsl: { hue: [12,0,0,0,0,0,0,0], saturation: [0,0,0,0,0,0,0,0], luminance: [0,0,0,0,0,0,0,0] } }); });
    render(<ColorGradingSection clipId="clip-1" />);
    edit(ui("Temperature", "色温"), "23");
    await waitFor(() => expect(persisted()?.temperature).toBe(23));
    edit(ui("Tint", "色调"), "-17");
    await waitFor(() => expect(persisted()?.tint).toBe(-17));
    fireEvent.click(screen.getByRole("button", { name: ui("Reset white balance", "重置白平衡") }));
    await waitFor(() => expect(persisted()).toMatchObject({ temperature: 0, tint: 0 }));
    expect(persisted()?.hsl?.hue[0]).toBe(12);
    fireEvent.click(screen.getByRole("button", { name: ui("Reset All", "全部重置") }));
    await waitFor(() => expect(persisted()).toBeUndefined());
  });

  it("shows localized group titles and explanatory text", () => {
    render(<ColorGradingSection clipId="clip-1" />);
    expect(screen.getByText(ui("Warm up cool shots or cool down warm ones. Tint corrects green or magenta casts.", "调整画面的冷暖，使用色调校正偏绿或偏洋红的色彩。"))).toBeInTheDocument();
    for (const [en, zh] of [["White Balance", "白平衡"], ["Color Wheels", "色轮"], ["Curves", "曲线"]]) {
      expect(screen.getByRole("button", { name: ui(en, zh) })).toBeInTheDocument();
    }
  });
});
