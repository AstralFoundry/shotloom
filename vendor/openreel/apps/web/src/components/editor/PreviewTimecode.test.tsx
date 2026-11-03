import { configureShotloomLocale } from "../../shotloom-mode";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useTimelineStore } from "../../stores/timeline-store";
import { PreviewTimecode } from "./PreviewTimecode";
beforeEach(() => useTimelineStore.setState({ playheadPosition: 0, playbackState: "paused", playbackLockedReason: null, viewportWidth: 800, scrollX: 0 }));
afterEach(() => { cleanup(); configureShotloomLocale("en-US"); });
describe.each(["en-US", "zh-CN"] as const)("frame-accurate preview seeking (%s)", locale => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => configureShotloomLocale(locale));
  it("seeks to typed frames and clamps requests to the project end", () => {
    render(<PreviewTimecode position={0} duration={10} frameRate={24} />);
    const input = screen.getByRole("textbox", { name: ui("Playhead timecode", "播放头时码") });
    expect(input).toHaveAttribute("title", ui("Go to a frame · 24 fps · HH:MM:SS:FF (non-drop-frame). You can also enter seconds.", "跳转到指定帧 · 24 fps · HH:MM:SS:FF（非丢帧时码）。也可以输入秒数。"));
    expect(screen.getByLabelText(ui("Project duration", "工程时长"))).toHaveTextContent("00:10:00");
    act(() => input.focus());
    fireEvent.change(input, { target: { value: "00:00:02:12" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(useTimelineStore.getState().playheadPosition).toBe(2.5);
    act(() => input.focus()); fireEvent.change(input, { target: { value: "500" } }); fireEvent.blur(input);
    expect(useTimelineStore.getState().playheadPosition).toBe(10);
  });
  it("keeps invalid input from seeking and Escape discards a draft", () => {
    render(<PreviewTimecode position={0} duration={10} frameRate={30} />);
    const input = screen.getByRole("textbox", { name: ui("Playhead timecode", "播放头时码") });
    act(() => input.focus()); fireEvent.change(input, { target: { value: "bad time" } }); fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("alert")).toHaveTextContent(ui("Enter HH:MM:SS:FF or seconds, for example 12.5.", "请输入 HH:MM:SS:FF 格式的时码或秒数，例如 12.5。")); expect(useTimelineStore.getState().playheadPosition).toBe(0);
    act(() => input.focus()); fireEvent.change(input, { target: { value: "9" } }); fireEvent.keyDown(input, { key: "Escape" });
    expect(useTimelineStore.getState().playheadPosition).toBe(0);
  });
  it("steps one or ten frames from the draft without starting playback", () => {
    render(<PreviewTimecode position={0} duration={10} frameRate={60} />);
    const input = screen.getByRole("textbox", { name: ui("Playhead timecode", "播放头时码") });
    act(() => input.focus()); fireEvent.keyDown(input, { key: "ArrowUp", shiftKey: true });
    expect(useTimelineStore.getState().playheadPosition).toBeCloseTo(10 / 60);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(useTimelineStore.getState().playheadPosition).toBeCloseTo(9 / 60);
    expect(useTimelineStore.getState().playbackState).toBe("paused");
  });
});
