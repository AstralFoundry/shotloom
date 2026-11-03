import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getGSAPEngine } from "@openreel/core";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { useProjectStore } from "../../../stores/project-store";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useUIStore } from "../../../stores/ui-store";
import { MotionPathSection } from "./MotionPathSection";

const clipId = "i18n-path-clip";
const engine = getGSAPEngine();
const originalProject = useProjectStore.getState().project;

afterEach(() => {
  cleanup();
  engine.removeMotionPath(clipId);
  useUIStore.getState().setMotionPathMode(false);
  useProjectStore.setState({ project: originalProject });
  configureShotloomLocale("en-US");
});

describe("MotionPathSection language and engine state", () => {
  it.each([
    ["en-US", "Set path type to Smooth", "2 points", "Add point", "3 points", "Edit Path on Canvas", "Exit Edit Mode"],
    ["zh-CN", "将路径类型设为平滑", "2 个控制点", "添加路径点", "3 个控制点", "在画布上编辑路径", "退出编辑模式"],
  ])("edits the same path in %s", (locale, select, before, add, after, edit, exit) => {
    configureShotloomLocale(locale);
    const project = createEmptyProject("User {name}");
    const tracks = [{
      id: "path-track", type: "video" as const, name: "User Track", locked: false,
      hidden: false, muted: false, solo: false, transitions: [],
      clips: [{
        id: clipId, mediaId: "media", trackId: "path-track", startTime: 0,
        duration: 4, inPoint: 0, outPoint: 4, effects: [], audioEffects: [],
        volume: 1, keyframes: [],
        transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: .5, y: .5 }, opacity: 1 },
      }],
    }];
    useProjectStore.setState({ project: { ...project, timeline: { ...project.timeline, tracks } } });
    engine.setMotionPath(clipId, {
      enabled: true, pathType: "bezier", showPath: true, autoOrient: false,
      alignOrigin: [.5, .5], points: [{ x: 0, y: 0, time: 0 }, { x: 100, y: 0, time: 1 }],
    });
    render(<MotionPathSection clipId={clipId} />);
    expect(screen.getByText(before)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: select }));
    expect(engine.getMotionPath(clipId)?.pathType).toBe("catmull-rom");
    fireEvent.click(screen.getByRole("button", { name: add }));
    expect(screen.getByText(after)).toBeInTheDocument();
    expect(engine.getMotionPath(clipId)?.points).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: edit }));
    expect(screen.getByRole("button", { name: exit })).toBeInTheDocument();
    expect(useUIStore.getState().motionPathClipId).toBe(clipId);
    expect(useProjectStore.getState().project.name).toBe("User {name}");
  });
});
