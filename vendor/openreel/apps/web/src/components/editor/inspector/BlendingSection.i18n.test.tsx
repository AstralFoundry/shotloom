import "../../../test/install-local-storage-mock";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getAvailableBlendModes, type Project } from "@openreel/core";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import { BlendingSection } from "./BlendingSection";

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

describe.each(["en-US", "zh-CN"] as const)("BlendingSection (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => {
    configureShotloomLocale(locale);
    useProjectStore.setState({ project: projectWithClip(), hasOpenProject: true });
  });
  afterEach(() => {
    cleanup(); configureShotloomLocale("en-US");
    useProjectStore.setState({ project: createEmptyProject("Reset"), hasOpenProject: false });
  });
  const clip = () => useProjectStore.getState().project.timeline.tracks[0].clips[0];
  it("lists all actual blend modes and writes original enum values", async () => {
    render(<BlendingSection clipId="clip-1" />);
    expect(screen.getByText(ui("Blending", "混合"))).toBeInTheDocument();
    expect(screen.getByRole("option", { name: ui("Normal", "正常") })).toHaveValue("normal");
    expect(screen.getByRole("option", { name: ui("Multiply", "正片叠底") })).toHaveValue("multiply");
    const select = screen.getByRole("combobox", { name: ui("Blend mode", "混合模式") });
    expect(screen.getAllByRole("option")).toHaveLength(getAvailableBlendModes().length);
    for (const mode of getAvailableBlendModes()) {
      fireEvent.change(select, { target: { value: mode } });
      await waitFor(() => expect(clip().blendMode).toBe(mode));
    }
    fireEvent.keyDown(screen.getByRole("slider", { name: ui("Blend Opacity", "混合不透明度") }), { key: "ArrowLeft" });
    await waitFor(() => expect(clip().blendOpacity).toBe(99));
  });
  it("explains missing selection in the chosen language", () => {
    render(<BlendingSection clipId="missing" />);
    expect(screen.getByText(ui("No clip selected", "未选择片段"))).toBeInTheDocument();
  });
});
