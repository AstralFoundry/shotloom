import "../../../test/install-local-storage-mock";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Project } from "@openreel/core";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import * as audioBridge from "../../../bridges/audio-bridge-effects";
import { AudioEffectsSection } from "./AudioEffectsSection";

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

describe.each(["en-US", "zh-CN"] as const)("AudioEffectsSection (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => {
    configureShotloomLocale(locale);
    vi.spyOn(audioBridge, "initializeAudioBridgeEffects").mockResolvedValue(audioBridge.getAudioBridgeEffects());
    useProjectStore.setState({ project: projectWithClip(), hasOpenProject: true });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    configureShotloomLocale("en-US");
    useProjectStore.setState({ project: createEmptyProject("Reset"), hasOpenProject: false });
  });
  function edit(label: string, value: string) {
    fireEvent.click(screen.getByRole("button", { name: ui(`Edit ${label} value`, `编辑${label}数值`) }));
    const input = screen.getByRole("textbox", { name: ui(`${label} value`, `${label}数值`) });
    fireEvent.change(input, { target: { value } });
    fireEvent.blur(input);
  }
  const effects = () => useProjectStore.getState().getAudioEffects("clip-1");

  it("labels EQ bands and persists gain changes and bypass", async () => {
    render(<AudioEffectsSection clipId="clip-1" />);
    expect(screen.getByText(ui("Audio clip: clip-1…", "音频片段：clip-1…"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: ui("Equalizer enabled", "启用均衡器") }));
    await waitFor(() => expect(effects()[0]?.type).toBe("eq"));
    const slider = screen.getByRole("slider", { name: ui("1kHz band gain", "1kHz 频段增益") });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    await waitFor(() => {
      expect((effects()[0].params.bands as Array<{frequency: number; gain: number}>)[2]).toMatchObject({ frequency: 1000, gain: 1 });
    });
    fireEvent.click(screen.getByRole("switch", { name: ui("Equalizer enabled", "启用均衡器") }));
    await waitFor(() => expect(effects()[0].enabled).toBe(false));
    expect(screen.getByRole("button", { name: ui("Collapse Equalizer", "收起均衡器") })).toBeInTheDocument();
  });

  it.each([
    { type: "compressor", en: "Compressor", zh: "压缩器", fieldEn: "Attack", fieldZh: "启动时间", value: "25", param: "attack", saved: 0.025 },
    { type: "reverb", en: "Reverb", zh: "混响", fieldEn: "Wet/Dry", fieldZh: "干湿比", value: "65", param: "wetLevel", saved: 0.65 },
    { type: "delay", en: "Delay", zh: "延迟", fieldEn: "Time", fieldZh: "延迟时间", value: "750", param: "time", saved: 0.75 },
  ])("persists $type controls in either language", async ({ type, en, zh, fieldEn, fieldZh, value, param, saved }) => {
    const view = render(<AudioEffectsSection clipId="clip-1" />);
    const title = ui(en, zh);
    fireEvent.click(screen.getByRole("button", { name: ui(`Expand ${title}`, `展开${title}`) }));
    fireEvent.click(screen.getByRole("switch", { name: ui(`${title} enabled`, `启用${title}`) }));
    await waitFor(() => expect(effects()[0]?.type).toBe(type));
    edit(ui(fieldEn, fieldZh), value);
    await waitFor(() => expect(effects()[0].params[param]).toBe(saved));
    const id = effects()[0].id;
    view.unmount();
    render(<AudioEffectsSection clipId="clip-1" />);
    fireEvent.click(screen.getByRole("button", { name: ui(`Expand ${title}`, `展开${title}`) }));
    expect(screen.getByRole("switch", { name: ui(`${title} enabled`, `启用${title}`) })).toBeChecked();
    expect(effects()[0].id).toBe(id);
    fireEvent.click(screen.getByRole("switch", { name: ui(`${title} enabled`, `启用${title}`) }));
    await waitFor(() => expect(effects()[0].enabled).toBe(false));
  });
});
