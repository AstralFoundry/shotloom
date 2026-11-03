import "../../../test/install-local-storage-mock";
import { configureShotloomLocale, editorMessage } from "../../../shotloom-mode";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Clip, Transition } from "@openreel/core";
import { getTransitionBridge, TransitionBridge } from "../../../bridges/transition-bridge";
import { useNotificationStore } from "../../../stores/notification-store";
import { TransitionInspector } from "./TransitionInspector";

const clip = (id: string, startTime: number): Clip => ({
  id,
  mediaId: `media-${id}`,
  trackId: "track-1",
  startTime,
  duration: 4,
  inPoint: 0,
  outPoint: 4,
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
});

describe.each(["en-US", "zh-CN"] as const)("TransitionInspector (%s)", (locale) => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    getTransitionBridge().clearAllTransitions();
    useNotificationStore.getState().clearAll();
    configureShotloomLocale("en-US");
  });
  beforeEach(() => {
    configureShotloomLocale(locale);
    const bridge = getTransitionBridge();
    if (!bridge.isInitialized()) bridge.initialize(320, 180);
  });

  it.each(["push", "whipPan"] as const)(
    "exposes and persists direction for %s",
    (type) => {
      const onTransitionUpdate = vi.fn();
      const transition: Transition = {
        id: `transition-${type}`,
        clipAId: "clip-a",
        clipBId: "clip-b",
        type,
        duration: 0.8,
        params: { direction: "left" },
      };

      render(
        <TransitionInspector
          clipA={clip("clip-a", 0)}
          clipB={clip("clip-b", 4)}
          transition={transition}
          onTransitionUpdate={onTransitionUpdate}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: editorMessage("editor.transitionInspector.right") }));

      expect(onTransitionUpdate).toHaveBeenCalledWith(transition.id, {
        params: { direction: "right" },
      });
    },
  );

  it("exposes renderer-backed blur and radial wipe parameters", () => {
    const onTransitionUpdate = vi.fn();
    const transition: Transition = {
      id: "transition-radial",
      clipAId: "clip-a",
      clipBId: "clip-b",
      type: "radialWipe",
      duration: 0.8,
      params: { startAngle: -90, clockwise: true },
    };
    const view = render(
      <TransitionInspector
        clipA={clip("clip-a", 0)}
        clipB={clip("clip-b", 4)}
        transition={transition}
        onTransitionUpdate={onTransitionUpdate}
      />,
    );

    fireEvent.click(screen.getByRole("switch", { name: editorMessage("editor.transitionInspector.clockwise") }));
    expect(onTransitionUpdate).toHaveBeenCalledWith(transition.id, {
      params: { startAngle: -90, clockwise: false },
    });

    view.rerender(
      <TransitionInspector
        clipA={clip("clip-a", 0)}
        clipB={clip("clip-b", 4)}
        transition={{ ...transition, type: "blur", params: { intensity: 1 } }}
        onTransitionUpdate={onTransitionUpdate}
      />,
    );
    expect(screen.getByText(editorMessage("editor.transitionInspector.blurStrength"))).toBeInTheDocument();
  });

  it.each(["zoom", "circleReveal", "diamondReveal"] as const)(
    "exposes focal center controls for %s",
    (type) => {
      const onTransitionUpdate = vi.fn();
      const transition: Transition = {
        id: `transition-${type}`,
        clipAId: "clip-a",
        clipBId: "clip-b",
        type,
        duration: 0.8,
        params: {
          ...(type === "zoom" ? { scale: 2 } : {}),
          center: { x: 0.5, y: 0.5 },
        },
      };
      render(
        <TransitionInspector
          clipA={clip("clip-a", 0)}
          clipB={clip("clip-b", 4)}
          transition={transition}
          onTransitionUpdate={onTransitionUpdate}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: locale === "zh-CN" ? "编辑中心 X数值" : "Edit Center X value" }));
      const input = screen.getByRole("textbox", { name: locale === "zh-CN" ? "中心 X数值" : "Center X value" });
      fireEvent.change(input, { target: { value: "25" } });
      fireEvent.blur(input);

      expect(onTransitionUpdate).toHaveBeenCalledWith(transition.id, {
        params: {
          ...(type === "zoom" ? { scale: 2 } : {}),
          center: { x: 0.25, y: 0.5 },
        },
      });
    },
  );

  it("exposes Film Burn previews and renderer-backed controls", () => {
    render(
      <TransitionInspector
        clipA={clip("clip-a", 0)}
        clipB={clip("clip-b", 4)}
        transition={{
          id: "transition-film-burn",
          clipAId: "clip-a",
          clipBId: "clip-b",
          type: "filmBurn",
          duration: 0.8,
          params: { intensity: 1, warmth: 0.75 },
        }}
      />,
    );

    expect(
      screen.getByRole("button", { name: editorMessage("editor.transitions.catalog.filmBurn.name") }),
    ).toBeInTheDocument();
    expect(screen.getByText(editorMessage("editor.transitionInspector.burnIntensity"))).toBeInTheDocument();
    expect(screen.getByText(editorMessage("editor.transitionInspector.warmth"))).toBeInTheDocument();
    const preview = screen
      .getByRole("button", { name: editorMessage("editor.transitions.catalog.flash.name") })
      .querySelector('[data-transition-preview="flash"]');
    expect(preview).toHaveAttribute("data-preview-progress", "0.45");
  });

  it("authors an explicit clip-to-clip audio smoothing envelope", () => {
    const onTransitionUpdate = vi.fn();
    const transition: Transition = {
      id: "transition-audio",
      clipAId: "clip-a",
      clipBId: "clip-b",
      type: "crossfade",
      duration: 1,
      params: { curve: "ease" },
    };
    render(
      <TransitionInspector
        clipA={clip("clip-a", 0)}
        clipB={clip("clip-b", 4)}
        transition={transition}
        onTransitionUpdate={onTransitionUpdate}
      />,
    );

    fireEvent.click(
      screen.getByRole("switch", { name: editorMessage("editor.transitionInspector.smoothAudio") }),
    );
    expect(onTransitionUpdate).toHaveBeenCalledWith(transition.id, {
      params: { curve: "ease", audioFade: true },
    });
  });
  it("creates and removes a real transition with localized notifications", () => {
    const onTransitionCreate = vi.fn();
    const onTransitionRemove = vi.fn();
    const view = render(<TransitionInspector
      clipA={clip("clip-a", 0)} clipB={clip("clip-b", 4)}
      onTransitionCreate={onTransitionCreate}
    />);
    fireEvent.click(screen.getByRole("button", {
      name: locale === "zh-CN" ? "应用转场" : "Apply Transition",
    }));
    expect(onTransitionCreate).toHaveBeenCalledOnce();
    const transition = onTransitionCreate.mock.calls[0][0] as Transition;
    expect(transition).toMatchObject({
      clipAId: "clip-a", clipBId: "clip-b", type: "crossfade", duration: 1,
    });
    expect(getTransitionBridge().getTransition(transition.id)).toEqual(transition);
    expect(useNotificationStore.getState().notifications.at(-1)).toMatchObject({
      title: locale === "zh-CN" ? "转场已应用" : "Transition Applied",
      message: locale === "zh-CN" ? "已添加交叉淡化转场（1秒）" : "Crossfade transition added (1s)",
    });
    view.rerender(<TransitionInspector
      clipA={clip("clip-a", 0)} clipB={clip("clip-b", 4)}
      transition={transition} onTransitionRemove={onTransitionRemove}
    />);
    fireEvent.click(screen.getByRole("button", {
      name: locale === "zh-CN" ? "移除转场" : "Remove Transition",
    }));
    expect(onTransitionRemove).toHaveBeenCalledWith(transition.id);
    expect(getTransitionBridge().getTransition(transition.id)).toBeUndefined();
    expect(useNotificationStore.getState().notifications.at(-1)?.title).toBe(
      locale === "zh-CN" ? "转场已移除" : "Transition Removed",
    );
  });

  it("explains a missing second clip and disables application", () => {
    render(<TransitionInspector clipA={clip("original-clip-name", 0)} />);
    expect(screen.getByText(locale === "zh-CN"
      ? "片段间转场需要第二个片段"
      : "A second clip is required for clip-to-clip transitions",
    )).toBeInTheDocument();
    expect(screen.getByRole("button", {
      name: locale === "zh-CN" ? "应用转场" : "Apply Transition",
    })).toBeDisabled();
  });

  it.each([
    { name: "gap", second: { startTime: 5 }, en: "Clips must be adjacent to add a transition", zh: "片段必须相邻才能添加转场" },
    { name: "track", second: { trackId: "other-track" }, en: "Clips must be on the same track", zh: "片段必须位于同一轨道" },
  ])("localizes engine validation for $name", ({ second, en, zh }) => {
    render(<TransitionInspector clipA={clip("clip-a", 0)} clipB={{ ...clip("clip-b", 4), ...second }} />);
    expect(screen.getByText(locale === "zh-CN" ? zh : en)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: editorMessage("editor.transitionInspector.apply") })).toBeDisabled();
  });

  it.each(["in", "out"] as const)("localizes %s edge warnings using the actual maximum", (edge) => {
    render(<TransitionInspector clipA={{ ...clip("clip-a", 0), duration: 0.375 }} edge={edge} />);
    expect(screen.getByText(locale === "zh-CN"
      ? "转场时长超过片段长度，最长为 0.38 秒"
      : "Transition duration exceeds clip length. Maximum duration is 0.38s",
    )).toBeInTheDocument();
    expect(screen.getByText(locale === "zh-CN" ? "背景" : "Background")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: editorMessage("editor.transitionInspector.apply") })).toBeEnabled();
  });

  it("localizes handle warnings without changing the numeric limit", () => {
    render(<TransitionInspector
      clipA={{ ...clip("clip-a", 0), duration: 0.125 }}
      clipB={{ ...clip("clip-b", 0.125), duration: 0.25 }}
    />);
    expect(screen.getByText(locale === "zh-CN"
      ? "可用余量帧不足，转场时长最长为 0.25 秒"
      : "Insufficient handle frames. Maximum transition duration is 0.25s",
    )).toBeInTheDocument();
  });

  it("keeps unclassified validation details unchanged", () => {
    const detail = "Decoder external error: source-素材.mov";
    vi.spyOn(getTransitionBridge(), "validateTransition").mockReturnValue({ valid: false, error: detail });
    render(<TransitionInspector clipA={clip("clip-a", 0)} clipB={clip("clip-b", 4)} />);
    expect(screen.getByText(detail)).toBeInTheDocument();
  });

  it("propagates structured validation through bridge creation results", () => {
    const bridge = getTransitionBridge();
    const result = bridge.createTransition(clip("clip-a", 0), clip("clip-b", 6), "crossfade", 1);
    expect(result).toMatchObject({
      success: false,
      errorIssue: { code: "clips-not-adjacent" },
      error: locale === "zh-CN" ? "片段必须相邻才能添加转场" : "Clips must be adjacent to add a transition",
    });
    const edgeResult = bridge.createClipEdgeTransition({ ...clip("clip-a", 0), duration: 0.375 }, "out", "crossfade", 1);
    expect(edgeResult).toMatchObject({
      success: true, maxDuration: 0.375,
      warningIssue: { code: "exceeds-clip-length", maxDuration: 0.375 },
      warning: locale === "zh-CN" ? "转场时长超过片段长度，最长为 0.38 秒" : "Transition duration exceeds clip length. Maximum duration is 0.38s",
    });
  });

  it("localizes bridge readiness and missing transition failures", () => {
    const bridge = new TransitionBridge();
    const unavailable = locale === "zh-CN" ? "转场引擎尚未就绪" : "Transition engine is not ready";
    expect(bridge.validateTransition(clip("a", 0), clip("b", 4), 1).error).toBe(unavailable);
    expect(bridge.createTransition(clip("a", 0), clip("b", 4), "crossfade", 1).error).toBe(unavailable);
    expect(bridge.removeTransition("missing").error).toBe(unavailable);
    bridge.initialize(320, 180);
    const missing = locale === "zh-CN" ? "未找到转场" : "Transition not found";
    expect(bridge.updateTransition("missing", { duration: 1 }).error).toBe(missing);
    expect(bridge.removeTransition("missing").error).toBe(missing);
    bridge.dispose();
  });

});
