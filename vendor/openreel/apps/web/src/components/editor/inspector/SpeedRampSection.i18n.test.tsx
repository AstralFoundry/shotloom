import "../../../test/install-local-storage-mock";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSpeedEngine, SPEED_CURVE_PRESETS, type Clip } from "@openreel/core";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { SpeedRampSection } from "./SpeedRampSection";
const clip: Clip = { id: "ramp-clip", mediaId: "media", trackId: "track", startTime: 2, duration: 10, inPoint: 0, outPoint: 10, effects: [], audioEffects: [], keyframes: [], volume: 1, transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, anchor: { x: 0.5, y: 0.5 } } };
const presets = [ ["Flash", "闪速"], ["Smooth Slow-Mo", "平滑慢动作"], ["Jump Cut", "跳切"], ["Montage", "蒙太奇"], ["Hero Moment", "高光时刻"], ["Bullet Time", "子弹时间"] ];
describe.each(["en-US", "zh-CN"] as const)("speed ramp controls (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => {
    configureShotloomLocale(locale); getSpeedEngine().clear();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const project = createEmptyProject("User project");
    useProjectStore.setState({ hasOpenProject: true, project: { ...project, timeline: { ...project.timeline, duration: 12, tracks: [{ id: "track", name: "User track", type: "video", clips: [structuredClone(clip)], transitions: [], locked: false, hidden: false, muted: false, solo: false }] } } });
    useTimelineStore.setState({ playheadPosition: 5 });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); getSpeedEngine().clear(); configureShotloomLocale("en-US"); useProjectStore.setState({ hasOpenProject: false, project: createEmptyProject("Reset") }); });
  it("refreshes duration after speed changes with no pre-initialized engine data", async () => {
    render(<SpeedRampSection clip={clip} />);
    expect(screen.getByText(ui("Effective duration: 0:10.00", "实际时长：0:10.00"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "2x" }));
    await waitFor(() => expect(screen.getByText(ui("Effective duration: 0:05.00", "实际时长：0:05.00"))).toBeInTheDocument());
    expect(getSpeedEngine().getClipSpeed(clip.id)).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: ui("Reverse", "倒放") }));
    expect(getSpeedEngine().getClipSpeedData(clip.id)?.reverse).toBe(true);
  });
  it("applies the whole curve catalog with unchanged timing, speeds and easing", async () => {
    render(<SpeedRampSection clip={clip} />);
    for (const [index, preset] of SPEED_CURVE_PRESETS.entries()) {
      fireEvent.click(screen.getByRole("button", { name: ui(...presets[index] as [string, string]) }));
      const expected = preset.keyframes.map(k => ({ time: k.time * 10, speed: k.speed, easing: k.easing }));
      await waitFor(() => expect(useProjectStore.getState().getClip(clip.id)?.speedKeyframes?.map(({ time, speed, easing }) => ({ time, speed, easing }))).toEqual(expected));
      expect(screen.getByRole("button", { name: ui(`Speed Ramping (${expected.length} keyframes)`, `变速曲线（${expected.length} 个关键帧）`) })).toBeInTheDocument();
    }
    const before = getSpeedEngine().getClipSpeedData(clip.id)!.keyframes.map(k => k.id);
    fireEvent.click(screen.getAllByRole("button", { name: ui("Remove speed keyframe", "移除速度关键帧") })[0]);
    await waitFor(() => expect(useProjectStore.getState().getClip(clip.id)?.speedKeyframes).toHaveLength(before.length - 1));
    expect(getSpeedEngine().getClipSpeedData(clip.id)?.keyframes.map(k => k.id)).not.toContain(before[0]);
  });
  it("adds and removes a freeze frame at the original relative playhead", async () => {
    render(<SpeedRampSection clip={clip} />);
    fireEvent.click(screen.getByRole("button", { name: ui("Freeze Frames", "定格") }));
    fireEvent.click(screen.getByRole("button", { name: ui("Add Freeze Frame at Playhead", "在播放头处添加定格") }));
    await waitFor(() => expect(useProjectStore.getState().getClip(clip.id)?.freezeFrames).toHaveLength(1));
    expect(useProjectStore.getState().getClip(clip.id)?.freezeFrames?.[0]).toMatchObject({ startTime: 3, duration: 2 });
    expect(screen.getByRole("button", { name: ui("Freeze Frames (1 freeze)", "定格（1 处）") })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ui("Remove freeze frame", "移除定格") }));
    await waitFor(() => expect(useProjectStore.getState().getClip(clip.id)?.freezeFrames).toHaveLength(0));
  });
});
