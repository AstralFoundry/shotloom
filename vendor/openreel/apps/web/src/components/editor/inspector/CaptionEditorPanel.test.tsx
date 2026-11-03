import "../../../test/install-local-storage-mock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Project, TextClip } from "@openreel/core";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useEngineStore } from "../../../stores/engine-store";
import { useProjectStore } from "../../../stores/project-store";
import { CaptionEditorPanel } from "./CaptionEditorPanel";
import { useUIStore } from "../../../stores/ui-store";
import { useTimelineStore } from "../../../stores/timeline-store";

import { configureShotloomLocale } from "../../../shotloom-mode";

const TRACK_ID = "caption-track";

function caption(): TextClip {
  return {
    id: "caption-long",
    trackId: TRACK_ID,
    startTime: 10,
    duration: 7,
    text: "one two three four five six seven",
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
    metadata: { captionSource: "srt" },
  };
}

function project(textClip: TextClip): Project {
  const empty = createEmptyProject("Single-line captions");
  return {
    ...empty,
    textClips: [textClip],
    timeline: {
      ...empty.timeline,
      duration: 20,
      tracks: [
        {
          id: TRACK_ID,
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
  };
}

describe.each(["en-US", "zh-CN"] as const)("CaptionEditorPanel (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => {
    configureShotloomLocale(locale);
    useUIStore.setState({ exportState: { ...useUIStore.getState().exportState, isExporting: false } });
    useTimelineStore.setState({ playbackLockedReason: null });
    const textClip = caption();
    useEngineStore.getState().getTitleEngine()?.clear();
    useEngineStore.getState().getTitleEngine()?.loadTextClips([textClip]);
    useProjectStore.setState({ hasOpenProject: true, project: project(textClip) });
  });

  afterEach(() => {
    configureShotloomLocale("en-US");
    cleanup();
    useEngineStore.getState().getTitleEngine()?.clear();
    useProjectStore.setState({
      hasOpenProject: false,
      project: createEmptyProject("Reset"),
    });
  });

  it("localizes caption counts and actions while preserving editable caption text", () => {
    configureShotloomLocale("zh-CN");
    const text = "Media 用户字幕 {name} $&";
    const clip = { ...caption(), text };
    useEngineStore.getState().getTitleEngine()?.clear();
    useEngineStore.getState().getTitleEngine()?.loadTextClips([clip]);
    useProjectStore.setState({ hasOpenProject: true, project: project(clip) });
    render(<CaptionEditorPanel maxWordsPerLine={5} onMaxWordsPerLineChange={() => undefined} />);
    expect(screen.getByText("1 条可编辑文字片段")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "第 1 条字幕文字" })).toHaveValue(text);
    fireEvent.click(screen.getByRole("button", { name: "选择第 1 条字幕" }));
    expect(screen.getByRole("button", { name: "取消选择第 1 条字幕" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "将所选 1 条字幕拆为单行" })).toBeInTheDocument();
    expect(useProjectStore.getState().project.textClips?.[0]?.text).toBe(text);
  });

  it("turns one long caption into sequential single-line clips", async () => {
    render(
      <CaptionEditorPanel
        maxWordsPerLine={5}
        onMaxWordsPerLineChange={() => undefined}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: ui("Make all 1 single-line", "将全部 1 条字幕拆为单行") }),
    );

    await waitFor(() => {
      const clips = useEngineStore
        .getState()
        .getTitleEngine()
        ?.getAllTextClips()
        .sort((left, right) => left.startTime - right.startTime);
      expect(clips?.map((clip) => clip.text)).toEqual([
        "one two three four five",
        "six seven",
      ]);
      expect(clips?.map((clip) => [clip.startTime, clip.duration])).toEqual([
        [10, 5],
        [15, 2],
      ]);
      expect(clips?.every((clip) => !clip.text.includes("\n"))).toBe(true);
    });
  });

  it("replaces a batch without changing timing or styles, skips locks, and undoes once", async () => {
    const first = { ...caption(), text: "A edição\nno navegador" };
    const second = { ...caption(), id: "second", startTime: 17, text: "EDIÇÃO simples" };
    const locked = { ...caption(), id: "locked", trackId: "locked-track", text: "edição bloqueada" };
    const base = project(first);
    useProjectStore.getState().loadProject({ ...base, textClips: [first, second, locked], timeline: {
      ...base.timeline, tracks: [...base.timeline.tracks, { ...base.timeline.tracks[0], id: "locked-track", locked: true }],
    } });
    render(<CaptionEditorPanel maxWordsPerLine={5} onMaxWordsPerLineChange={() => undefined} />);
    expect(screen.getByRole("checkbox", { name: ui("Match case", "区分大小写") })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: ui("Whole words", "全词匹配") })).not.toBeChecked();
    fireEvent.change(screen.getByRole("textbox", { name: ui("Find caption text", "查找字幕文字") }), { target: { value: "edição" } });
    fireEvent.change(screen.getByRole("textbox", { name: ui("Replace caption text with", "将字幕文字替换为") }), { target: { value: "montagem" } });
    fireEvent.click(screen.getByRole("button", { name: ui("Replace in all captions", "替换全部字幕") }));
    expect(useProjectStore.getState().getTextClip(first.id)).toMatchObject({ text: "A montagem\nno navegador", style: first.style, startTime: first.startTime, duration: first.duration });
    expect(useProjectStore.getState().getTextClip(second.id)?.text).toBe("montagem simples");
    expect(useProjectStore.getState().getTextClip(locked.id)?.text).toBe("edição bloqueada");
    expect(screen.getByRole("status")).toHaveTextContent(ui("Replacements: 2 · Captions: 2. Undo restores the batch.", "已替换 2 条字幕中的 2 处匹配。撤销可恢复整批修改。"));
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(useProjectStore.getState().getTextClip(first.id)?.text).toBe(first.text);
    expect(useProjectStore.getState().getTextClip(second.id)?.text).toBe(second.text);
  });

  it("replaces only selected captions and leaves other drafts intact", () => {
    const first = { ...caption(), text: "Edit first" };
    const second = { ...caption(), id: "second", startTime: 18, text: "Edit second" };
    useProjectStore.getState().loadProject({ ...project(first), textClips: [first, second] });
    render(<CaptionEditorPanel maxWordsPerLine={5} onMaxWordsPerLineChange={() => undefined} />);
    fireEvent.change(screen.getByRole("textbox", { name: ui("Caption 2 text", "第 2 条字幕文字") }), { target: { value: "Edit second draft" } });
    fireEvent.click(screen.getByRole("button", { name: ui("Select caption 1", "选择第 1 条字幕") }));
    fireEvent.change(screen.getByRole("textbox", { name: ui("Find caption text", "查找字幕文字") }), { target: { value: "Edit" } });
    fireEvent.change(screen.getByRole("textbox", { name: ui("Replace caption text with", "将字幕文字替换为") }), { target: { value: "Review" } });
    fireEvent.click(screen.getByRole("button", { name: ui("Replace in selected captions", "替换所选字幕") }));
    expect(useProjectStore.getState().getTextClip(first.id)?.text).toBe("Review first");
    expect(useProjectStore.getState().getTextClip(second.id)?.text).toBe("Edit second");
    fireEvent.click(screen.getByRole("button", { name: ui("Clear search", "清除搜索") }));
    expect(screen.getByRole("textbox", { name: ui("Caption 2 text", "第 2 条字幕文字") })).toHaveValue("Edit second draft");
  });

  it("keeps the caption DOM bounded while search reaches later cues", () => {
    const clips = Array.from({ length: 150 }, (_, index) => ({ ...caption(), id: `caption-${index}`, startTime: index, text: index === 149 ? "Find this late cue" : `Caption ${index}` }));
    useProjectStore.getState().loadProject({ ...project(clips[0]), textClips: clips });
    render(<CaptionEditorPanel maxWordsPerLine={5} onMaxWordsPerLineChange={() => undefined} />);
    expect(screen.getAllByRole("textbox", { name: locale === "zh-CN" ? /^第 \d+ 条字幕文字$/ : /^Caption \d+ text$/ })).toHaveLength(50);
    fireEvent.click(screen.getByRole("button", { name: ui("Next", "下一页") }));
    expect(screen.getByRole("textbox", { name: ui("Caption 51 text", "第 51 条字幕文字") })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ui("Previous", "上一页") }));
    fireEvent.change(screen.getByRole("textbox", { name: ui("Find caption text", "查找字幕文字") }), { target: { value: "late cue" } });
    expect(screen.getByRole("textbox", { name: ui("Caption 150 text", "第 150 条字幕文字") })).toHaveValue("Find this late cue");
    fireEvent.click(screen.getByRole("button", { name: ui("Go to caption 150", "跳转到第 150 条字幕") }));
    expect(useTimelineStore.getState().playheadPosition).toBe(149);
  });

  it("repairs legacy caption layers for export in one undoable move", async () => {
    const text = caption();
    const base = project(text);
    const videoTrack = { ...base.timeline.tracks[0], id: "video-track", name: "Video", type: "video" as const, clips: [{
      id: "video", mediaId: "source", trackId: "video-track", startTime: 0, duration: 2, inPoint: 0, outPoint: 2,
      effects: [], audioEffects: [], keyframes: [], volume: 1, transform: text.transform,
    }] };
    useProjectStore.getState().loadProject({ ...base, mediaLibrary: { items: [{
      id: "source", name: "source.mp4", type: "video", blob: null, fileHandle: null, waveformData: null, thumbnailUrl: null,
      metadata: { duration: 2, width: 640, height: 360, frameRate: 30, codec: "h264", sampleRate: 48000, channels: 2, fileSize: 1 },
    }] }, timeline: { ...base.timeline, tracks: [videoTrack, ...base.timeline.tracks] } });
    const originalTracks = useProjectStore.getState().project.timeline.tracks;
    render(<CaptionEditorPanel maxWordsPerLine={5} onMaxWordsPerLineChange={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: ui("Bring caption tracks to front", "将字幕轨道置顶") }));
    await waitFor(() => expect(useProjectStore.getState().project.timeline.tracks[0].id).toBe(TRACK_ID));
    expect(originalTracks.map((track) => track.id)).toEqual(["video-track", TRACK_ID]);
    expect(useProjectStore.getState().getTextClip(text.id)).toEqual(text);
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(useProjectStore.getState().project.timeline.tracks.map((track) => track.id)).toEqual(["video-track", TRACK_ID]);
  });
});
