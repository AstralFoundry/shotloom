import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Clip } from "@openreel/core";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { useProjectStore } from "../../../stores/project-store";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { Transform3DSection } from "./Transform3DSection";

describe.each(["en-US", "zh-CN"] as const)("3D transform (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => {
    configureShotloomLocale(locale);
    const project = createEmptyProject("Original name");
    const clip: Clip = { id: "clip", mediaId: "media", trackId: "track", startTime: 0, inPoint: 0, outPoint: 5, duration: 5, effects: [], audioEffects: [], keyframes: [], volume: 1, transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, anchor: { x: 0.5, y: 0.5 } } };
    useProjectStore.setState({ project: { ...project, timeline: { ...project.timeline, tracks: [{ id: "track", name: "Original track", type: "video", clips: [clip], transitions: [], muted: false, solo: false, locked: false, hidden: false }] } } });
  });
  afterEach(() => { cleanup(); configureShotloomLocale("en-US"); });
  it("submits numeric rotation and the original transform-style enum", () => {
    render(<Transform3DSection clipId="clip" />);
    fireEvent.click(screen.getByRole("button", { name: ui("Edit Rotation X value", "编辑X 轴旋转数值") }));
    const value = screen.getByRole("textbox", { name: ui("Rotation X value", "X 轴旋转数值") });
    fireEvent.change(value, { target: { value: "45" } });
    fireEvent.keyDown(value, { key: "Enter" });
    expect(useProjectStore.getState().getClip("clip")?.transform.rotate3d).toEqual({ x: 45, y: 0, z: 0 });
    fireEvent.change(screen.getByRole("combobox", { name: ui("Transform Style", "变换样式") }), { target: { value: "preserve-3d" } });
    expect(useProjectStore.getState().getClip("clip")?.transform.transformStyle).toBe("preserve-3d");
    expect(screen.getByText(ui("Children positioned in 3D space", "子元素位于三维空间中"))).toBeInTheDocument();
  });
  it("shows the translated empty selection", () => {
    render(<Transform3DSection clipId="missing" />);
    expect(screen.getByText(ui("No clip selected", "未选择片段"))).toBeInTheDocument();
  });
});
