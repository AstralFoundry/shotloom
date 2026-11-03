import { configureShotloomLocale } from "../../../shotloom-mode";
import "../../../test/install-local-storage-mock";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Clip, Project, TextClip, Track } from "@openreel/core";
import type { ToolcraftContextMenuOption as ContextMenuOption } from "@openreel/ui";
import { useEngineStore } from "../../../stores/engine-store";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useUIStore } from "../../../stores/ui-store";
import { useClipContextMenuItems } from "./ClipContextMenu";
import { useGraphicsClipContextMenuItems } from "./GraphicsClipContextMenu";

const MEDIA_TRACK_ID = "video-track";
const TEXT_TRACK_ID = "caption-track";

function mediaClip(id: string, startTime: number): Clip {
  return {
    id,
    mediaId: `media-${id}`,
    trackId: MEDIA_TRACK_ID,
    startTime,
    duration: 2,
    inPoint: 0,
    outPoint: 2,
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
  };
}

function caption(id: string, startTime: number): TextClip {
  return {
    id,
    trackId: TEXT_TRACK_ID,
    startTime,
    duration: 1,
    text: id,
    style: {
      fontFamily: "Inter",
      fontSize: 48,
      fontWeight: "bold",
      fontStyle: "normal",
      color: "#ffffff",
      textAlign: "center",
      verticalAlign: "middle",
      lineHeight: 1.2,
      letterSpacing: 0,
    },
    transform: {
      position: { x: 0.5, y: 0.8 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      anchor: { x: 0.5, y: 0.5 },
      opacity: 1,
    },
    keyframes: [],
  };
}

function testProject(): Project {
  const empty = createEmptyProject("Track selection");
  const mediaClips = [mediaClip("video-a", 0), mediaClip("video-b", 3)];
  return {
    ...empty,
    timeline: {
      ...empty.timeline,
      tracks: [
        {
          id: MEDIA_TRACK_ID,
          type: "video",
          name: "Video",
          clips: mediaClips,
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
        {
          id: TEXT_TRACK_ID,
          type: "text",
          name: "Captions",
          clips: [],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
      ],
    },
    textClips: [],
  };
}

function menuAction(items: ContextMenuOption[], label: string): () => void {
  const item = items.find(
    (candidate) => "label" in candidate && candidate.label === label,
  );
  if (!item || !("onClick" in item) || !item.onClick) {
    throw new Error(`Missing menu action: ${label}`);
  }
  return item.onClick;
}

describe.each(["en-US", "zh-CN"] as const)("select all clips on track context menu (%s)", locale => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => {
    configureShotloomLocale(locale);
    useEngineStore
      .getState()
      .getTitleEngine()
      ?.loadTextClips([caption("caption-a", 0), caption("caption-b", 2)]);
    useProjectStore.setState({ project: testProject(), hasOpenProject: true });
    useProjectStore.getState().actionHistory.clear();
    useTimelineStore.setState({ playheadPosition: 4, playbackLockedReason: null });
    useUIStore.getState().clearSelection();
  });

  afterEach(() => {
    cleanup();
    configureShotloomLocale("en-US");
    useEngineStore.getState().getTitleEngine()?.clear();
    useUIStore.getState().clearSelection();
  });

  it("selects all media clips from a media clip menu", () => {
    const track = useProjectStore.getState().project.timeline.tracks[0] as Track;
    const clip = track.clips[0];
    const { result } = renderHook(() => useClipContextMenuItems({ clip, track }));

    act(() => menuAction(result.current, ui("Select All Clips on Track", "选择轨道上的所有片段"))());

    expect(useUIStore.getState().selectedItems).toEqual([
      { id: "video-a", trackId: MEDIA_TRACK_ID, type: "clip" },
      { id: "video-b", trackId: MEDIA_TRACK_ID, type: "clip" },
    ]);
  });

  it("selects all editable captions from a caption menu", () => {
    const clip = useProjectStore.getState().getAllTextClips()[0];
    if (!clip) throw new Error("Caption fixture was not created");
    const { result } = renderHook(() =>
      useGraphicsClipContextMenuItems({ clip, clipType: "text" }),
    );

    act(() => menuAction(result.current, ui("Select All Captions", "选择所有字幕"))());

    expect(useUIStore.getState().selectedItems).toEqual([
      { id: "caption-a", trackId: TEXT_TRACK_ID, type: "text-clip" },
      { id: "caption-b", trackId: TEXT_TRACK_ID, type: "text-clip" },
    ]);
  });
  it("splits at the real playhead and restores the original clip on undo", async () => {
    const track = useProjectStore.getState().project.timeline.tracks[0];
    const { result } = renderHook(() => useClipContextMenuItems({ clip: track.clips[1], track }));
    await act(async () => { await menuAction(result.current, ui("Split at Playhead", "在播放头处分割"))(); });
    await waitFor(() => expect(useProjectStore.getState().project.timeline.tracks[0].clips).toHaveLength(3));
    const parts = useProjectStore.getState().project.timeline.tracks[0].clips.filter(item => item.startTime >= 3);
    expect(parts.map(item => [item.startTime, item.duration, item.mediaId])).toEqual([
      [3, 1, "media-video-b"], [4, 1, "media-video-b"],
    ]);
    await act(async () => { expect((await useProjectStore.getState().undo()).success).toBe(true); });
    expect(useProjectStore.getState().project.timeline.tracks[0].clips).toHaveLength(2);
    expect(useProjectStore.getState().getClip("video-b")).toMatchObject({ startTime: 3, duration: 2 });
  });

  it("closes a real gap without changing media references and supports undo", async () => {
    const track = useProjectStore.getState().project.timeline.tracks[0];
    const { result } = renderHook(() => useClipContextMenuItems({ clip: track.clips[1], track }));
    await act(async () => { await menuAction(result.current, ui("Close Gap to Previous", "移除与上一片段的间隙"))(); });
    await waitFor(() => expect(useProjectStore.getState().getClip("video-b")?.startTime).toBe(2));
    expect(useProjectStore.getState().getClip("video-b")?.mediaId).toBe("media-video-b");
    await act(async () => { expect((await useProjectStore.getState().undo()).success).toBe(true); });
    expect(useProjectStore.getState().getClip("video-b")?.startTime).toBe(3);
  });

});
