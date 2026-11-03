import { configureShotloomLocale } from "../../../shotloom-mode";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Clip } from "@openreel/core";
import { KeyframeTrack } from "./KeyframeTrack";

const clip: Clip = {
  id: "clip-original", mediaId: "media", trackId: "track", startTime: 0, duration: 5,
  inPoint: 0, outPoint: 5, effects: [], audioEffects: [], volume: 1,
  transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 },
  keyframes: [
    { id: "original-keyframe", property: "position.x", time: 1, value: 20, easing: "linear" },
    { id: "plugin-keyframe", property: "plugin.customValue", time: 2, value: 5, easing: "linear" },
  ],
};
describe.each(["en-US", "zh-CN"] as const)("keyframe track (%s)", locale => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => configureShotloomLocale(locale));
  afterEach(() => { cleanup(); configureShotloomLocale("en-US"); });
  it("translates property and time labels while preserving selection, movement and deletion IDs", () => {
    const select = vi.fn(); const move = vi.fn(); const remove = vi.fn();
    render(<KeyframeTrack clip={clip} pixelsPerSecond={50} selectedKeyframeIds={["original-keyframe"]}
      onKeyframeSelect={select} onKeyframeMove={move} onKeyframeDelete={remove} />);
    expect(screen.getByText(ui("Position X", "位置 X"))).toBeInTheDocument();
    expect(screen.getByText("plugin.customValue")).toBeInTheDocument();
    expect(screen.getByText(ui("1.00s", "1.00 秒"))).toBeInTheDocument();
    const marker = screen.getByTitle(ui("position.x @ 1.00s", "position.x @ 1.00 秒"));
    fireEvent.mouseDown(marker, { clientX: 50, shiftKey: true });
    expect(select).toHaveBeenCalledWith("original-keyframe", true);
    fireEvent.mouseMove(window, { clientX: 150 });
    expect(move).toHaveBeenCalledWith("original-keyframe", 3);
    fireEvent.mouseUp(window);
    fireEvent.contextMenu(marker);
    expect(remove).toHaveBeenCalledWith("original-keyframe");
  });
  it("shows a localized empty track", () => {
    render(<KeyframeTrack clip={{ ...clip, keyframes: [] }} pixelsPerSecond={50} selectedKeyframeIds={[]}
      onKeyframeSelect={vi.fn()} onKeyframeMove={vi.fn()} onKeyframeDelete={vi.fn()} />);
    expect(screen.getByText(ui("No keyframes", "暂无关键帧"))).toBeInTheDocument();
  });
});
