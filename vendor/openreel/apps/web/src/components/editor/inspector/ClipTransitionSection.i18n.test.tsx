import "../../../test/install-local-storage-mock";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Project } from "@openreel/core";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import { useNotificationStore } from "../../../stores/notification-store";
import { ClipTransitionSection } from "./ClipTransitionSection";

vi.mock("./TransitionInspector", () => ({ TransitionInspector: () => null }));

function projectWithClip(): Project {
  const project = createEmptyProject("Adjustment workflow");
  return {
    ...project,
    mediaLibrary: { items: [{ id: "media-1", name: "Original.mp4", type: "video", blob: new Blob(["video"]), fileHandle: null, waveformData: null, thumbnailUrl: null, metadata: { duration: 4, width: 1920, height: 1080, frameRate: 30, codec: "h264", sampleRate: 48000, channels: 2, fileSize: 5 } }] },
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

describe.each(["en-US", "zh-CN"] as const)("Clip animation (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  const clip = () => useProjectStore.getState().getClip("clip-1")!;
  const entry = (en: string, zh: string) => screen.getByRole("button", {
    name: ui(`Set entry animation to ${en}`, `将入场动画设为${zh}`),
  });
  const exit = (en: string, zh: string) => screen.getByRole("button", {
    name: ui(`Set exit animation to ${en}`, `将退场动画设为${zh}`),
  });
  const apply = () => fireEvent.click(screen.getByRole("button", {
    name: ui("Apply Entry/Exit Animations", "应用入场/退场动画"),
  }));
  beforeEach(() => {
    configureShotloomLocale(locale);
    useProjectStore.setState({ project: projectWithClip(), hasOpenProject: true });
    useNotificationStore.getState().clearAll();
  });
  afterEach(() => {
    cleanup();
    configureShotloomLocale("en-US");
    useNotificationStore.getState().clearAll();
    useProjectStore.setState({ project: createEmptyProject("Reset"), hasOpenProject: false });
  });
  it("renders translated controls and writes fade keyframes without changing user keyframes", () => {
    const custom = { id: "user-motion", time: 2, property: "rotation", value: 15, easing: "linear" as const };
    useProjectStore.getState().updateClipKeyframes("clip-1", [custom]);
    render(<ClipTransitionSection clipId="clip-1" />);
    expect(screen.getByText(ui("Entry Animation", "入场动画"))).toBeInTheDocument();
    expect(screen.getByText(ui("Single-Clip Transitions", "单片段转场"))).toBeInTheDocument();
    fireEvent.click(entry("Fade", "淡化"));
    fireEvent.click(exit("Fade", "淡化"));
    const selects = screen.getAllByRole("combobox", { name: ui("Easing", "缓动") });
    expect(selects).toHaveLength(2);
    fireEvent.change(selects[0], { target: { value: "linear" } });
    apply();
    expect(clip().keyframes).toContainEqual(custom);
    expect(clip().keyframes.filter(k => k.id.startsWith("kf-entry-"))).toEqual(expect.arrayContaining([
      expect.objectContaining({ time: 0, property: "opacity", value: 0, easing: "linear" }),
      expect.objectContaining({ time: 0.5, property: "opacity", value: 1 }),
    ]));
    expect(clip().keyframes.filter(k => k.id.startsWith("kf-exit-"))).toEqual(expect.arrayContaining([
      expect.objectContaining({ time: 3.5, property: "opacity", value: 1 }),
      expect.objectContaining({ time: 4, property: "opacity", value: 0 }),
    ]));
    expect(useNotificationStore.getState().notifications.at(-1)).toMatchObject({
      type: "success", title: ui("Clip Animation Applied", "片段动画已应用"),
      message: ui("Entry: Fade; Exit: Fade", "入场：淡化；退场：淡化"),
    });
    fireEvent.click(entry("None", "无")); fireEvent.click(exit("None", "无")); apply();
    expect(clip().keyframes).toEqual([custom]);
    expect(useNotificationStore.getState().notifications.at(-1)?.title).toBe(ui("Animations Cleared", "动画已清除"));
  });
  it("uses translated preset names in one-sided success receipts", () => {
    render(<ClipTransitionSection clipId="clip-1" />);
    fireEvent.click(entry("Slide Left", "向左滑动")); apply();
    expect(clip().keyframes.some(k => k.id.startsWith("kf-entry-") && k.property === "position.x")).toBe(true);
    expect(useNotificationStore.getState().notifications.at(-1)?.message).toBe(ui("Entry: Slide Left", "入场：向左滑动"));
    fireEvent.click(entry("None", "无")); fireEvent.click(exit("Zoom Out", "缩小")); apply();
    expect(clip().keyframes.some(k => k.id.startsWith("kf-entry-"))).toBe(false);
    expect(clip().keyframes.some(k => k.id.startsWith("kf-exit-") && k.property === "scale.x")).toBe(true);
    expect(useNotificationStore.getState().notifications.at(-1)?.message).toBe(ui("Exit: Zoom Out", "退场：缩小"));
  });
  it("labels edge and neighbouring transitions without altering clip identities", () => {
    const project = projectWithClip();
    const track = project.timeline.tracks[0];
    const current = track.clips[0];
    useProjectStore.setState({ project: { ...project, timeline: { ...project.timeline,
      tracks: [{ ...track, clips: [
        { ...current, id: "before", startTime: 0, duration: 1 },
        current,
        { ...current, id: "after", startTime: 5, duration: 2 },
      ] }],
    } } });
    render(<ClipTransitionSection clipId="clip-1" />);
    for (const [en, zh] of [
      ["Intro Transition", "片头转场"], ["Outro Transition", "片尾转场"],
      ["Incoming Transition", "接入转场"], ["Outgoing Transition", "接出转场"],
      ["From the previous clip into this clip", "从上一个片段过渡到此片段"],
      ["From this clip into the next clip", "从此片段过渡到下一个片段"],
    ]) expect(screen.getByText(ui(en, zh))).toBeInTheDocument();
    expect(useProjectStore.getState().project.timeline.tracks[0].clips.map(c => c.id)).toEqual(["before", "clip-1", "after"]);
    expect(useProjectStore.getState().project.mediaLibrary.items[0].name).toBe("Original.mp4");
  });
  it("explains an isolated clip and hides controls for a missing selection", () => {
    const { rerender } = render(<ClipTransitionSection clipId="clip-1" />);
    expect(screen.getByText(ui("No adjacent clips are available on this track.", "此轨道上没有相邻片段。"))).toBeInTheDocument();
    rerender(<ClipTransitionSection clipId="missing" />);
    expect(screen.queryByText(ui("Entry Animation", "入场动画"))).not.toBeInTheDocument();
  });

});
