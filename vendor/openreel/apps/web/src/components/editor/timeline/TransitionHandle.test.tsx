import { configureShotloomLocale } from "../../../shotloom-mode";
import "../../../test/install-local-storage-mock";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import { getTransitionBridge } from "../../../bridges/transition-bridge";
import { toast } from "../../../stores/notification-store";
import type { Clip, Transition } from "@openreel/core";
import { TransitionHandle } from "./TransitionHandle";
import type { ResolvedTransitionHandle } from "./transition-handles";

function makeHandle(): ResolvedTransitionHandle {
  return {
    transition: {
      id: "tr-1",
      clipAId: "a",
      clipBId: "b",
      type: "crossfade",
      duration: 1.5,
      params: {},
    } as Transition,
    clipA: { id: "a", startTime: 0, duration: 2 } as unknown as Clip,
    clipB: { id: "b", startTime: 2, duration: 2 } as unknown as Clip,
    centerX: 100,
  };
}

function makeEdgeHandle(): ResolvedTransitionHandle {
  return {
    transition: {
      id: "tr-out",
      clipAId: "a",
      edge: "out",
      type: "crossfade",
      duration: 1,
      params: {},
    } as Transition,
    clipA: { id: "a", startTime: 0, duration: 2 } as unknown as Clip,
    edge: "out",
    centerX: 100,
  };
}

describe.each(["en-US", "zh-CN"] as const)("TransitionHandle (%s)", locale => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => configureShotloomLocale(locale));
  afterEach(() => { cleanup(); vi.restoreAllMocks(); configureShotloomLocale("en-US"); });
  it("renders a labeled button positioned on the cut", () => {
    render(
      <TransitionHandle
        handle={makeHandle()}
        trackId="track-1"
        isSelected={false}
        onSelect={() => {}}
      />,
    );
    const button = screen.getByRole("button", { name: locale === "zh-CN" ? /交叉淡化/ : /crossfade/i });
    expect(button).toBeTruthy();
    expect(button.getAttribute("title")).toContain(ui("1.5s", "1.5 秒"));
  });

  it("calls onSelect with transition id and track id on click", () => {
    const onSelect = vi.fn();
    render(
      <TransitionHandle
        handle={makeHandle()}
        trackId="track-1"
        isSelected={false}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: locale === "zh-CN" ? /交叉淡化/ : /crossfade/i }));
    expect(onSelect).toHaveBeenCalledWith("tr-1", "track-1");
  });

  it("opens a transition picker menu on click", () => {
    render(
      <TransitionHandle
        handle={makeHandle()}
        trackId="track-1"
        isSelected={false}
        onSelect={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: locale === "zh-CN" ? /交叉淡化/ : /crossfade/i }));
    expect(screen.getByText(ui("Remove transition", "移除转场"))).toBeTruthy();
    expect(screen.getByText(ui("Dip to Black", "淡入淡出黑场"))).toBeTruthy();
    expect(screen.getByText(ui("Wipe", "擦除"))).toBeTruthy();
  });

  it("labels single-clip edge transitions by edge", () => {
    render(
      <TransitionHandle
        handle={makeEdgeHandle()}
        trackId="track-1"
        isSelected={false}
        onSelect={() => {}}
      />,
    );
    expect(
      screen.getByRole("button", { name: locale === "zh-CN" ? /出场转场/ : /outro transition/i }),
    ).toBeTruthy();
  });
  it("updates and removes the original transition through the real project store", async () => {
    const handle = makeHandle();
    const empty = createEmptyProject("Transition fixture");
    useProjectStore.setState({ project: { ...empty, timeline: { ...empty.timeline, tracks: [{
      id: "track-1", name: "My original track", type: "video", clips: [handle.clipA, handle.clipB!], transitions: [handle.transition!],
      hidden: false, locked: false, muted: false, solo: false,
    }] } } });
    render(<TransitionHandle handle={handle} trackId="track-1" isSelected={false} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: locale === "zh-CN" ? /交叉淡化/ : /crossfade/i }));
    fireEvent.click(screen.getByRole("button", { name: locale === "zh-CN" ? /淡入淡出黑场/ : /Dip to Black/ }));
    await waitFor(() => expect(useProjectStore.getState().project.timeline.tracks[0].transitions[0]).toMatchObject({ id: "tr-1", type: "dipToBlack" }));
    fireEvent.click(screen.getByRole("button", { name: locale === "zh-CN" ? /交叉淡化/ : /crossfade/i }));
    fireEvent.click(screen.getByRole("button", { name: ui("Remove transition", "移除转场") }));
    await waitFor(() => expect(useProjectStore.getState().project.timeline.tracks[0].transitions).toEqual([]));
  });

  it("shows localized engine failure without creating a transition", async () => {
    const bridge = getTransitionBridge();
    vi.spyOn(bridge, "isInitialized").mockReturnValue(false);
    const create = vi.spyOn(bridge, "createTransition");
    const error = vi.spyOn(toast, "error");
    const handle = { ...makeHandle(), transition: undefined };
    render(<TransitionHandle handle={handle} trackId="track-1" isSelected={false} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: ui("Edit transition between clips: Add transition", "编辑片段间转场：添加转场") }));
    fireEvent.click(screen.getByRole("button", { name: locale === "zh-CN" ? /淡入淡出黑场/ : /Dip to Black/ }));
    await waitFor(() => expect(error).toHaveBeenCalledWith(ui("Transition engine not ready", "转场引擎尚未就绪"), ui("Try again in a moment.", "请稍后重试。")));
    expect(create).not.toHaveBeenCalled();
  });

});
