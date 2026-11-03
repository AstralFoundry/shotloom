import { configureShotloomLocale } from "../../../shotloom-mode";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { TextClip } from "@openreel/core";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useEngineStore } from "../../../stores/engine-store";
import { useProjectStore } from "../../../stores/project-store";
import { TextAnimationSection } from "./TextAnimationSection";

const CLIP_ID = "animated-title";

function textClip(): TextClip {
  return {
    id: CLIP_ID,
    trackId: "title-track",
    startTime: 0,
    duration: 5,
    text: "OpenReel",
    style: {
      fontFamily: "Inter",
      fontSize: 72,
      fontWeight: "bold",
      fontStyle: "normal",
      color: "#ffffff",
      textAlign: "center",
      verticalAlign: "middle",
      lineHeight: 1.2,
      letterSpacing: 0,
    },
    transform: {
      position: { x: 0.5, y: 0.5 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      anchor: { x: 0.5, y: 0.5 },
      opacity: 1,
    },
    keyframes: [],
  };
}

describe.each(["en-US", "zh-CN"] as const)("TextAnimationSection previews (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => {
    configureShotloomLocale(locale);
    const clip = textClip();
    useEngineStore.getState().getTitleEngine()?.loadTextClips([clip]);
    useProjectStore.setState({
      hasOpenProject: true,
      project: {
        ...createEmptyProject("Text animation previews"),
        textClips: [clip],
      },
    });
  });

  afterEach(() => {
    configureShotloomLocale("en-US");
    cleanup();
    useEngineStore.getState().getTitleEngine()?.clear();
    useProjectStore.setState({ hasOpenProject: false });
  });

  it("previews every animation and applies the selected look", async () => {
    render(<TextAnimationSection clipId={CLIP_ID} />);

    expect(
      screen.getAllByTestId("text-animation-preset-preview"),
    ).toHaveLength(24);
    fireEvent.click(
      screen.getByRole("button", { name: ui("Preview and apply Rise", "预览并应用升起") }),
    );

    await waitFor(() => {
      expect(
        useEngineStore.getState().getTitleEngine()?.getTextClip(CLIP_ID)
          ?.animation?.preset,
      ).toBe("rise");
    });
    expect(
      screen.getByRole("button", { name: ui("Preview and apply Rise", "预览并应用升起") }),
    ).toHaveAttribute("aria-pressed", "true");
  });
  it("applies every preview using its original preset ID", () => {
    render(<TextAnimationSection clipId={CLIP_ID} />);
    for (const preview of screen.getAllByTestId("text-animation-preset-preview")) {
      fireEvent.click(preview.closest("button")!);
      expect(useProjectStore.getState().getTextClip(CLIP_ID)?.animation?.preset).toBe(preview.getAttribute("data-preset"));
    }
    expect(useProjectStore.getState().getTextClip(CLIP_ID)?.text).toBe("OpenReel");
  });

  it("stores original easing, duration and opacity with translated controls", () => {
    render(<TextAnimationSection clipId={CLIP_ID} />);
    fireEvent.change(screen.getByRole("combobox", { name: ui("Animation Preset", "动画预设") }), { target: { value: "fade" } });
    fireEvent.change(screen.getByRole("combobox", { name: ui("Easing", "缓动") }), { target: { value: "ease-in-out" } });
    expect(useProjectStore.getState().getTextClip(CLIP_ID)?.animation?.params?.easing).toBe("ease-in-out");
    fireEvent.click(screen.getByRole("button", { name: ui("Edit In Duration value", "编辑入场时长数值") }));
    let input = screen.getByRole("textbox", { name: ui("In Duration value", "入场时长数值") });
    fireEvent.change(input, { target: { value: "1.2" } }); fireEvent.keyDown(input, { key: "Enter" });
    expect(useProjectStore.getState().getTextClip(CLIP_ID)?.animation?.inDuration).toBe(1.2);
    fireEvent.click(screen.getByRole("button", { name: ui("Edit Start Opacity value", "编辑起始不透明度数值") }));
    input = screen.getByRole("textbox", { name: ui("Start Opacity value", "起始不透明度数值") });
    fireEvent.change(input, { target: { value: "0.3" } }); fireEvent.keyDown(input, { key: "Enter" });
    expect(useProjectStore.getState().getTextClip(CLIP_ID)?.animation?.params?.fadeOpacity?.start).toBe(0.3);
  });

});
