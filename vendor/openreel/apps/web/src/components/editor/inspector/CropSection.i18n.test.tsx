import "../../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Clip } from "@openreel/core";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { CropSection } from "./CropSection";
describe.each(["en-US", "zh-CN"] as const)("crop controls (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => { configureShotloomLocale(locale); useUIStore.getState().setCropMode(false); });
  afterEach(() => { cleanup(); configureShotloomLocale("en-US"); });
  it("opens the original clip in crop mode and resets its stored crop", async () => {
    const clip: Clip = { id: "original-clip", mediaId: "media", trackId: "track", startTime: 0, inPoint: 0, outPoint: 5, duration: 5, effects: [], audioEffects: [], keyframes: [], volume: 1, transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, anchor: { x: 0.5, y: 0.5 }, crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.6 } } };
    const project = createEmptyProject("Original project");
    useProjectStore.setState({ hasOpenProject: true, project: { ...project, timeline: { ...project.timeline, tracks: [{ id: "track", name: "Original track", type: "video", clips: [clip], transitions: [], muted: false, solo: false, locked: false, hidden: false }] } } });
    const view = render(<CropSection clip={clip} />);
    expect(screen.getByText("50% × 60%")).toBeInTheDocument();
    expect(screen.getByText("(10%, 20%)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ui("Adjust Crop", "调整裁剪") }));
    expect(useUIStore.getState()).toMatchObject({ cropMode: true, cropClipId: "original-clip" });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: ui("Reset Crop", "重置裁剪") })); });
    expect(useProjectStore.getState().getClip("original-clip")?.transform.crop).toBeUndefined();
    view.rerender(<CropSection clip={useProjectStore.getState().getClip("original-clip")!} />);
    expect(screen.getByRole("button", { name: ui("Crop Video", "裁剪视频") })).toBeInTheDocument();
  });
});
