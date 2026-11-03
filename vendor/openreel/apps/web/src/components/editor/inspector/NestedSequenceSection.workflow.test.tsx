import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NestedSequenceEngine, type Clip, type Project } from "@openreel/core";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useEngineStore } from "../../../stores/engine-store";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { NestedSequenceSection } from "./NestedSequenceSection";

const transform = {
  position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0,
  anchor: { x: 0.5, y: 0.5 }, opacity: 1,
};

const clip = (id: string, startTime: number): Clip => ({
  id,
  mediaId: `media-${id}`,
  trackId: "video-track",
  startTime,
  duration: 2,
  inPoint: 0,
  outPoint: 2,
  transform,
  effects: [],
  audioEffects: [],
  volume: 1,
  keyframes: [],
});

describe("NestedSequenceSection compound creation", () => {
  const engine = new NestedSequenceEngine();
  const originalGetEngine = useEngineStore.getState().getNestedSequenceEngine;

  beforeEach(() => {
    engine.clearAll();
    const base = createEmptyProject("Compound workflow");
    const project: Project = {
      ...base,
      timeline: {
        ...base.timeline,
        duration: 4,
        tracks: [{
          id: "video-track",
          type: "video",
          name: "Video",
          clips: [clip("a", 0), clip("b", 2)],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        }],
      },
    };
    useProjectStore.setState({ hasOpenProject: true, project });
    useEngineStore.setState({ getNestedSequenceEngine: async () => engine });
  });

  afterEach(() => {
    cleanup();
    configureShotloomLocale("en-US");
    useUIStore.getState().clearSelection();
    useEngineStore.setState({ getNestedSequenceEngine: originalGetEngine });
    useProjectStore.setState({ hasOpenProject: false });
  });

  it.each([["en-US", "2 clips selected"], ["zh-CN", "2 个已选片段"]])("replaces selected clips with one persisted compound instance in %s", async (locale, selection) => {
    configureShotloomLocale(locale);
    render(<NestedSequenceSection clipId="a" />);
    act(() => {
      useUIStore.setState({
        selectedItems: [
          { id: "a", type: "clip", trackId: "video-track" },
          { id: "b", type: "clip", trackId: "video-track" },
        ],
        lastSelectedItem: { id: "b", type: "clip", trackId: "video-track" },
      });
    });
    await waitFor(() => expect(screen.getByText(selection)).toBeInTheDocument());
    fireEvent.click(await screen.findByRole("button", { name: locale === "zh-CN" ? "创建复合片段" : "Create Compound Clip" }));

    await waitFor(() => {
      const project = useProjectStore.getState().project;
      expect(project.compoundClips).toHaveLength(1);
      expect(project.nestedInstances).toHaveLength(1);
      expect(project.timeline.tracks[0]?.clips).toHaveLength(1);
    });
    const project = useProjectStore.getState().project;
    const timelineClip = project.timeline.tracks[0]!.clips[0]!;
    expect(timelineClip.id).toBe(project.nestedInstances?.[0]?.id);
    expect(timelineClip.metadata?.compoundClipId).toBe(project.compoundClips?.[0]?.id);
    expect(useUIStore.getState().getSelectedClipIds()).toEqual([timelineClip.id]);
    expect(project.compoundClips?.[0]?.name).toBe(locale === "zh-CN" ? "复合片段 1" : "Compound Clip 1");
    fireEvent.click(await screen.findByRole("button", { name: locale === "zh-CN" ? "重命名" : "Rename" }));
    const userName = "用户名称 {name} $&";
    fireEvent.change(screen.getByRole("textbox", { name: locale === "zh-CN" ? "复合片段名称" : "Compound clip name" }), { target: { value: userName } });
    fireEvent.click(screen.getByRole("button", { name: locale === "zh-CN" ? "确认重命名" : "Confirm rename" }));
    await waitFor(() => expect(useProjectStore.getState().project.compoundClips?.[0]?.name).toBe(userName));
    fireEvent.click(screen.getByRole("button", { name: locale === "zh-CN" ? "复制" : "Duplicate" }));
    await waitFor(() => expect(useProjectStore.getState().project.compoundClips).toHaveLength(2));
    expect(useProjectStore.getState().project.compoundClips?.[1]?.name).toBe(locale === "zh-CN" ? `${userName}（副本）` : `${userName} (Copy)`);

  });
});
