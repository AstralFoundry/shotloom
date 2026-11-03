import "../../../test/install-local-storage-mock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { Clip, Track } from "@openreel/core";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { getPresetLibrary } from "../../../services/motion-presets";
import { configureShotloomLocale, editorMessage } from "../../../shotloom-mode";
import { MotionPresetsPanel } from "./MotionPresetsPanel";

const CLIP_ID = "motion-preset-clip";

function makeClip(): Clip {
  return {
    id: CLIP_ID,
    mediaId: "image-1",
    trackId: "video-track-1",
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    effects: [],
    audioEffects: [],
    transform: {
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      anchor: { x: 0.5, y: 0.5 },
      opacity: 1,
    },
    volume: 1,
    keyframes: [],
  };
}

describe.each(["en-US", "zh-CN"] as const)("MotionPresetsPanel duration (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => {
    configureShotloomLocale(locale);
    const project = createEmptyProject("Motion preset duration");
    const track: Track = {
      id: "video-track-1",
      type: "video",
      name: "Video 1",
      clips: [makeClip()],
      transitions: [],
      locked: false,
      hidden: false,
      muted: false,
      solo: false,
    };
    useProjectStore.setState({
      hasOpenProject: true,
      project: {
        ...project,
        timeline: {
          ...project.timeline,
          tracks: [track],
          duration: 5,
        },
      },
    });
    useUIStore.getState().clearSelection();
  });

  afterEach(() => {
    cleanup();
    configureShotloomLocale("en-US");
    useProjectStore.setState({ hasOpenProject: false });
    useUIStore.getState().clearSelection();
  });

  it("shows localized empty and missing clip states without changing project data", () => {
    const before = useProjectStore.getState().project;
    const view = render(<MotionPresetsPanel />);
    expect(screen.getByText(ui("Select a clip to apply motion presets", "选择片段以应用动画预设"))).toBeInTheDocument();
    view.rerender(<MotionPresetsPanel clipId="missing-clip" />);
    expect(screen.getByText(ui("Clip not found", "未找到片段"))).toBeInTheDocument();
    expect(useProjectStore.getState().project).toBe(before);
  });

  it("updates the translated category description after changing motion tabs", () => {
    render(<MotionPresetsPanel clipId={CLIP_ID} />);
    expect(screen.getByText(editorMessage("editor.motion.durationHint", { category: editorMessage("editor.motion.entrance") }))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ui("Out", "出场") }));
    expect(screen.getByText(editorMessage("editor.motion.durationHint", { category: editorMessage("editor.motion.exit") }))).toBeInTheDocument();
    expect(screen.getByText(editorMessage("editor.motion.summary", { count: getPresetLibrary().exit.length, category: editorMessage("editor.motion.exit") }))).toBeInTheDocument();
    expect(useProjectStore.getState().project.timeline.tracks[0]?.clips[0]?.keyframes).toEqual([]);
  });

  it("reapplies the selected preset with the customized duration", async () => {
    render(<MotionPresetsPanel clipId={CLIP_ID} />);

    expect(
      screen.getByRole("slider", { name: ui("Motion preset duration", "动画预设时长") }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ui("Apply Fade In", "应用淡入") }));

    fireEvent.click(
      screen.getByRole("button", {
        name: ui("Edit Motion preset duration value", "编辑动画预设时长数值"),
      }),
    );
    const durationInput = screen.getByRole("textbox", {
      name: ui("Motion preset duration value", "动画预设时长数值"),
    });
    fireEvent.change(durationInput, { target: { value: "1.2s" } });
    fireEvent.blur(durationInput);

    await waitFor(() => {
      const clip = useProjectStore
        .getState()
        .project.timeline.tracks[0]?.clips.find(
          (candidate) => candidate.id === CLIP_ID,
        );
      const entranceKeyframes = (clip?.keyframes ?? []).filter((keyframe) =>
        keyframe.id.startsWith("motion-in-"),
      );
      expect(entranceKeyframes.length).toBeGreaterThan(0);
      expect(Math.max(...entranceKeyframes.map((keyframe) => keyframe.time))).toBe(
        1.2,
      );
    });
  });
  it("applies all preset categories with original keyframe properties, then removes their animations", async () => {
    render(<MotionPresetsPanel clipId={CLIP_ID} />);
    const library = getPresetLibrary();
    for (const [category, label, prefix] of [
      ["entrance", ui("In", "入场"), "motion-in-"],
      ["exit", ui("Out", "出场"), "motion-out-"],
      ["emphasis", ui("Emphasis", "强调"), "motion-emphasis-"],
      ["transition", ui("Transition", "转场"), "motion-emphasis-"],
    ] as const) {
      fireEvent.click(screen.getByRole("button", { name: label }));
      for (const preset of library[category]) {
        const key = `editor.motionPanel.preset.${preset.id}` as Parameters<typeof editorMessage>[0];
        const name = editorMessage("editor.motionPanel.applyPreset", { name: editorMessage(key) });
        fireEvent.click(screen.getByRole("button", { name }));
        await waitFor(() => {
          const frames = useProjectStore.getState().getClip(CLIP_ID)?.keyframes?.filter(k => k.id.startsWith(prefix)) ?? [];
          expect(frames).toHaveLength(preset.tracks.reduce((sum, t) => sum + t.keyframes.length, 0));
          expect(new Set(frames.map(k => k.property))).toEqual(new Set(preset.tracks.map(t => t.property)));
        });
      }
      fireEvent.click(screen.getByRole("button", { name: category === "entrance" ? ui("Entry x", "移除入场动画") : category === "exit" ? ui("Exit x", "移除出场动画") : ui("Emphasis x", "移除强调动画") }));
      await waitFor(() => expect(useProjectStore.getState().getClip(CLIP_ID)?.keyframes?.filter(k => k.id.startsWith(prefix))).toHaveLength(0));
    }
  });

});
