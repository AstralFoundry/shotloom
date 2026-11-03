import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { TourPopover } from "./TourPopover";
import { TOUR_STEPS, ONBOARDING_KEY } from "./tour-steps";
import { MOGRAPH_TOUR_STEPS, MOGRAPH_TOUR_KEY } from "./mograph-tour-steps";

describe.each(["en-US", "zh-CN"] as const)("tour language (%s)", locale => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => configureShotloomLocale(locale));
  afterEach(() => { cleanup(); configureShotloomLocale("en-US"); });
  it("translates navigation and preserves step indices, skip and completion callbacks", () => {
    const onNext = vi.fn(), onPrev = vi.fn(), onSkip = vi.fn(), onGoToStep = vi.fn();
    const props = { step: TOUR_STEPS[0], targetRect: null, currentStep: 0, totalSteps: TOUR_STEPS.length, isFirstStep: true, isLastStep: false, onNext, onPrev, onSkip, onGoToStep };
    const view = render(<TourPopover {...props} />);
    expect(screen.getByRole("heading", { name: ui("Welcome to OpenReel", "欢迎使用 OpenReel") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ui("Back", "上一步") })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: ui("Go to step 3", "跳转至第 3 步") }));
    expect(onGoToStep).toHaveBeenCalledWith(2);
    fireEvent.click(screen.getByRole("button", { name: ui("Next", "下一步") }));
    expect(onNext).toHaveBeenCalledOnce();
    fireEvent.click(screen.getAllByRole("button", { name: ui("Skip tour", "跳过引导") })[0]);
    expect(onSkip).toHaveBeenCalledOnce();
    view.rerender(<TourPopover {...props} step={TOUR_STEPS.at(-1)!} currentStep={5} isFirstStep={false} isLastStep />);
    fireEvent.click(screen.getByRole("button", { name: ui("Back", "上一步") }));
    expect(onPrev).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: ui("Get Started", "开始使用") }));
    expect(onNext).toHaveBeenCalledTimes(2);
  });
  it("resolves both catalogs in the current language without changing navigation metadata", () => {
    const original = [...TOUR_STEPS, ...MOGRAPH_TOUR_STEPS].map(({ id, target, position }) => ({ id, target, position }));
    const step = MOGRAPH_TOUR_STEPS[1];
    expect(step.title).toBe(ui("Keyframe Animation", "关键帧动画"));
    expect(step.tips?.[0]).toBe(ui("Click the diamond icon to add a keyframe at current time", "点击菱形图标，在当前时间添加关键帧"));
    configureShotloomLocale(locale === "zh-CN" ? "en-US" : "zh-CN");
    expect(step.title).toBe(locale === "zh-CN" ? "Keyframe Animation" : "关键帧动画");
    expect([...TOUR_STEPS, ...MOGRAPH_TOUR_STEPS].map(({ id, target, position }) => ({ id, target, position }))).toEqual(original);
    expect(ONBOARDING_KEY).toBe("openreel-onboarding-complete");
    expect(MOGRAPH_TOUR_KEY).toBe("openreel-mograph-tour-complete");
  });
});
