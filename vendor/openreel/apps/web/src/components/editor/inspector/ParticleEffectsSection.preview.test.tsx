import { configureShotloomLocale } from "../../../shotloom-mode";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PARTICLE_PRESETS } from "@openreel/core";
import { ParticleEffectsSection } from "./ParticleEffectsSection";

describe("ParticleEffectsSection preset previews", () => {
  afterEach(() => { cleanup(); configureShotloomLocale("en-US"); });

  it.each([
    ["en-US", "Preview Celebration Confetti", "Add", "confetti · 200 particles"],
    ["zh-CN", "预览庆祝彩纸", "添加", "彩纸 · 200 个粒子"],
  ])("shows presets and adds the raw configuration in %s", (locale, preview, add, detail) => {
    configureShotloomLocale(locale);
    const onAddEffect = vi.fn();
    render(
      <ParticleEffectsSection
        clipId="particle-clip"
        clipDuration={5}
        clipStartTime={2}
        effects={[]}
        onAddEffect={onAddEffect}
        onUpdateEffect={vi.fn()}
        onRemoveEffect={vi.fn()}
        onToggleEffect={vi.fn()}
        onUpdateTiming={vi.fn()}
      />,
    );

    expect(screen.getAllByTestId("particle-preset-preview")).toHaveLength(
      PARTICLE_PRESETS.length,
    );
    fireEvent.click(
      screen.getByRole("button", { name: preview }),
    );
    expect(
      screen.getByRole("button", { name: preview }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: preview })).toHaveTextContent(detail);
    fireEvent.click(screen.getByRole("button", { name: add }));

    expect(onAddEffect).toHaveBeenCalledTimes(1);
    expect(onAddEffect.mock.calls[0]?.[0]).toMatchObject({
      clipId: "particle-clip",
      type: "confetti",
      startTime: 2,
      duration: 5,
      enabled: true,
      config: {
        particleCount: 200,
        gravity: 200,
      },
    });
  });
});
