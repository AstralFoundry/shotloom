import { configureShotloomLocale } from "../../shotloom-mode";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Clip, Keyframe } from "@openreel/core";
import { KeyframeEditorPanel } from "./KeyframeEditorPanel";

const frames: Keyframe[] = [
  { id: "kf-a", property: "position.x", time: 0, value: 0, easing: "linear" },
  { id: "kf-b", property: "position.x", time: 2, value: 100, easing: "easeInQuad" },
  { id: "kf-custom", property: "plugin.customProperty", time: 1, value: 5, easing: "linear" },
];
const clip: Clip = {
  id: "clip-original", mediaId: "media", trackId: "track", startTime: 0, duration: 4,
  inPoint: 0, outPoint: 4, effects: [], audioEffects: [], volume: 1, keyframes: frames,
  transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 },
};

describe.each(["en-US", "zh-CN"] as const)("keyframe panel (%s)", locale => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => {
    configureShotloomLocale(locale);
    // These tests cover control dispatch; pixel rendering is verified separately.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); configureShotloomLocale("en-US"); });
  const show = (selected = ["kf-a", "kf-b"], currentClip: Clip | null = clip) => {
    const callbacks = {
      onClose: vi.fn(), onUpdateKeyframe: vi.fn(), onDeleteKeyframe: vi.fn(),
      onCopyKeyframes: vi.fn(), onPasteKeyframes: vi.fn(), onSelectKeyframe: vi.fn(),
    };
    render(<KeyframeEditorPanel {...callbacks} clip={currentClip} selectedKeyframeIds={selected} copiedKeyframes={[frames[0]]} />);
    return callbacks;
  };
  it("shows the localized empty state", () => {
    show([], null);
    expect(screen.getByText(ui("Select a clip with keyframes to edit", "选择包含关键帧的片段以编辑"))).toBeInTheDocument();
  });
  it("uses translated labels while dispatching original easing and keyframe IDs", () => {
    const callbacks = show();
    const property = screen.getByRole("combobox", { name: ui("Property", "属性") });
    expect(within(property).getByRole("option", { name: ui("Position X", "位置 X") })).toHaveValue("position.x");
    expect(within(property).getByRole("option", { name: "plugin.customProperty" })).toBeInTheDocument();
    fireEvent.change(property, { target: { value: "position.x" } });
    const easing = screen.getByRole("combobox", { name: ui("Easing", "缓动") });
    expect(within(easing).getAllByRole("option")).toHaveLength(19);
    fireEvent.change(easing, { target: { value: "easeOutBounce" } });
    expect(callbacks.onUpdateKeyframe.mock.calls).toEqual([
      ["kf-a", { easing: "easeOutBounce" }], ["kf-b", { easing: "easeOutBounce" }],
    ]);
    fireEvent.click(screen.getByRole("button", { name: ui("Copy", "复制") }));
    expect(callbacks.onCopyKeyframes).toHaveBeenCalledWith(["kf-a", "kf-b"]);
    fireEvent.click(screen.getByRole("button", { name: ui("Paste", "粘贴") }));
    expect(callbacks.onPasteKeyframes).toHaveBeenCalledWith("clip-original", 0);
    fireEvent.click(screen.getByRole("button", { name: ui("Delete", "删除") }));
    expect(callbacks.onDeleteKeyframe.mock.calls).toEqual([["kf-a"], ["kf-b"]]);
    fireEvent.click(screen.getByRole("button", { name: ui("Close keyframe editor", "关闭关键帧编辑器") }));
    expect(callbacks.onClose).toHaveBeenCalledOnce();
  });
  it("selects table rows with original IDs and prevents actions without a selection", () => {
    const callbacks = show([]);
    fireEvent.change(screen.getByRole("combobox", { name: ui("Property", "属性") }), { target: { value: "position.x" } });
    expect(screen.getByRole("button", { name: ui("Copy", "复制") })).toBeDisabled();
    expect(screen.getByRole("button", { name: ui("Delete", "删除") })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: ui("Easing", "缓动") })).toBeDisabled();
    fireEvent.click(screen.getByText("100.000"), { shiftKey: true });
    expect(callbacks.onSelectKeyframe).toHaveBeenCalledWith("kf-b", true);
    expect(screen.getByRole("columnheader", { name: ui("Time", "时间") })).toBeInTheDocument();
  });
});
