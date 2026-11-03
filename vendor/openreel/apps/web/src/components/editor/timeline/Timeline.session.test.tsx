import { configureShotloomLocale } from "../../../shotloom-mode";
import { useUIStore } from "../../../stores/ui-store";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Timeline } from "../Timeline";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";

describe.each(["en-US", "zh-CN"] as const)("restored timeline viewport (%s)", locale => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => {
    configureShotloomLocale(locale);
    const empty = createEmptyProject("Saved viewport");
    const tracks = Array.from({ length: 10 }, (_, i) => ({
      id: `track-${i}`, name: `Track ${i}`, type: "video" as const,
      clips: [], transitions: [], locked: false, hidden: false, muted: false, solo: false,
    }));
    const project = { ...empty, timeline: { ...empty.timeline, tracks, duration: 60 } };
    useProjectStore.setState({ project, hasOpenProject: true });
    useTimelineStore.setState({
      pixelsPerSecond: 100, scrollX: 500, scrollY: 180,
      playbackState: "stopped", playheadPosition: 4,
    });
  });
  afterEach(() => { cleanup(); configureShotloomLocale("en-US"); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("restores both DOM axes and headers before accepting new scroll input", () => {
    const view = render(<Timeline />);
    const tracks = view.getByTestId("timeline-tracks-scroll");
    const headers = view.getByTestId("timeline-track-headers-scroll");
    expect([tracks.scrollLeft, tracks.scrollTop, headers.scrollTop]).toEqual([500, 180, 180]);

    act(() => useTimelineStore.setState({ scrollX: 900, scrollY: 250 }));
    expect([tracks.scrollLeft, tracks.scrollTop, headers.scrollTop]).toEqual([900, 250, 250]);

    tracks.scrollLeft = 300;
    tracks.scrollTop = 120;
    fireEvent.scroll(tracks);
    expect(useTimelineStore.getState()).toMatchObject({ scrollX: 300, scrollY: 120 });
    expect(headers.scrollTop).toBe(120);
  });
  it("localizes toolbar controls and preserves zoom, track layout and snapping actions", () => {
    const view = render(<Timeline />);
    const zoom = view.getByRole("slider", { name: ui("Timeline zoom", "时间线缩放") });
    expect(zoom).toHaveAttribute("aria-valuetext", ui("100 pixels per second", "每秒 100 像素"));
    fireEvent.change(zoom, { target: { value: "150" } });
    expect(useTimelineStore.getState().pixelsPerSecond).toBe(150);
    fireEvent.click(view.getByRole("button", { name: ui("Compact tracks", "紧凑轨道") }));
    expect(useTimelineStore.getState().trackHeight).toBe(40);
    fireEvent.click(view.getByRole("button", { name: ui("Large tracks", "大轨道") }));
    expect(useTimelineStore.getState().trackHeight).toBe(84);
    const enabled = useUIStore.getState().snapSettings.enabled;
    fireEvent.click(view.getByRole("button", { name: enabled ? ui("Snap on (N)", "吸附已开启 (N)") : ui("Snap off (N)", "吸附已关闭 (N)") }));
    expect(useUIStore.getState().snapSettings.enabled).toBe(!enabled);
    fireEvent.click(view.getByRole("button", { name: ui("Manage track layers", "管理轨道图层") }));
    const search = view.getByRole("searchbox", { name: ui("Search track layers", "搜索轨道图层") });
    fireEvent.change(search, { target: { value: "Track 9" } });
    expect(view.getByRole("button", { name: ui("Rename Track 9", "重命名Track 9") })).toBeInTheDocument();
    expect(view.queryByRole("button", { name: ui("Rename Track 0", "重命名Track 0") })).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: "no matching user name" } });
    expect(view.getByText(ui("No tracks match your filters", "没有符合筛选条件的轨道"))).toBeInTheDocument();
    expect(useProjectStore.getState().project.timeline.tracks[0]).toMatchObject({ id: "track-0", name: "Track 0" });
  });

});
