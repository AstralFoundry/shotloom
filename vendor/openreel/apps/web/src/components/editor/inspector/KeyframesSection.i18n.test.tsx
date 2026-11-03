import "../../../test/install-local-storage-mock";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Project } from "@openreel/core";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { KeyframesSection } from "./KeyframesSection";

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

describe.each(["en-US", "zh-CN"] as const)("Keyframes inspector (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  const keyframes = () => useProjectStore.getState().getClip("clip-1")!.keyframes;
  let selectedLabel: string;
  beforeEach(() => {
    selectedLabel = ui("Select Property", "选择属性");
    configureShotloomLocale(locale);
    useProjectStore.setState({ hasOpenProject: true, project: projectWithClip() });
    useTimelineStore.setState({ playheadPosition: 1.25 });
  });
  afterEach(() => {
    cleanup(); configureShotloomLocale("en-US");
    useProjectStore.setState({ hasOpenProject: false, project: createEmptyProject("Reset") });
    useTimelineStore.setState({ playheadPosition: 0 });
  });
  function selectProperty(english: string, chinese: string) {
    fireEvent.click(screen.getByRole("button", { name: selectedLabel }));
    fireEvent.click(screen.getByRole("button", { name: ui(`Select ${english}`, `选择${chinese}`) }));
    selectedLabel = ui(english, chinese);
  }
  it("adds, edits, eases and deletes actual keyframes through localized controls", () => {
    render(<KeyframesSection clipId="clip-1" />);
    expect(screen.getByText(ui("Select a property to animate", "选择要添加动画的属性"))).toBeInTheDocument();
    selectProperty("Position X", "X 位置");
    fireEvent.click(screen.getByRole("button", { name: ui("Add Keyframe at 1.25s", "在 1.25 秒处添加关键帧") }));
    expect(keyframes()).toHaveLength(1);
    expect(keyframes()[0]).toMatchObject({ property: "position.x", time: 1.25, value: 0, easing: "linear" });
    fireEvent.change(screen.getByRole("spinbutton", { name: ui("Keyframe value", "关键帧数值") }), { target: { value: "42" } });
    expect(keyframes()[0].value).toBe(42);
    fireEvent.click(screen.getByRole("button", { name: ui("Linear", "线性") }));
    fireEvent.click(screen.getByRole("button", { name: ui("Use Ease In Out Quad easing", "使用二次缓入缓出缓动") }));
    expect(keyframes()[0].easing).toBe("easeInOutQuad");
    fireEvent.click(screen.getByRole("button", { name: ui("Delete keyframe", "删除关键帧") }));
    expect(keyframes()).toEqual([]);
    expect(screen.getByText(ui("No keyframes for this property. Add one to start animating.", "此属性尚无关键帧，添加一个即可开始制作动画。"))).toBeInTheDocument();
  });
  it("retains all twelve original property paths and their default values", () => {
    render(<KeyframesSection clipId="clip-1" />);
    const properties = [
      ["position.x", "Position X", "X 位置", 0], ["position.y", "Position Y", "Y 位置", 0],
      ["scale.x", "Scale X", "X 缩放", 1], ["scale.y", "Scale Y", "Y 缩放", 1],
      ["rotation", "Rotation", "旋转", 0], ["opacity", "Opacity", "不透明度", 1],
      ["effect.brightness", "Brightness", "亮度", 0], ["effect.contrast", "Contrast", "对比度", 1],
      ["effect.saturation", "Saturation", "饱和度", 1], ["effect.blur", "Blur", "模糊", 0],
      ["volume", "Volume", "音量", 1], ["pan", "Pan", "声像", 0],
    ] as const;
    for (const [property, english, chinese, value] of properties) {
      selectProperty(english, chinese);
      fireEvent.click(screen.getByRole("button", { name: ui("Add Keyframe at 1.25s", "在 1.25 秒处添加关键帧") }));
      expect(keyframes().find((entry) => entry.property === property)).toMatchObject({ property, time: 1.25, value });
    }
    expect(keyframes()).toHaveLength(12);
  });
  it("disables duplicates at the playhead and displays the new time after seeking", () => {
    render(<KeyframesSection clipId="clip-1" />);
    selectProperty("Opacity", "不透明度");
    fireEvent.click(screen.getByRole("button", { name: ui("Add Keyframe at 1.25s", "在 1.25 秒处添加关键帧") }));
    expect(screen.getByRole("button", { name: ui("Keyframe exists at 1.25s", "1.25 秒处已有关键帧") })).toBeDisabled();
    act(() => useTimelineStore.setState({ playheadPosition: 2 }));
    fireEvent.click(screen.getByRole("button", { name: ui("Add Keyframe at 2.00s", "在 2.00 秒处添加关键帧") }));
    expect(keyframes().map((entry) => entry.time)).toEqual([1.25, 2]);
  });
  it("shows a translated empty selection", () => {
    render(<KeyframesSection clipId="missing" />);
    expect(screen.getByText(ui("No clip selected", "未选择片段"))).toBeInTheDocument();
  });
});
