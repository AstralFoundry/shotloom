import "../../../test/install-local-storage-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AudioDucker, type Project } from "@openreel/core";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { AudioDuckingSection } from "./AudioDuckingSection";

const targetClipId = "clip-music";
const triggerTrackId = "track-dialogue";

const createProjectWithPersistedDucking = (): Project => {
  const project = createEmptyProject("Audio Ducking Persistence");

  return {
    ...project,
    mediaLibrary: {
      items: [
        {
          id: "media-music",
          name: "Music",
          type: "audio",
          fileHandle: null,
          blob: null,
          metadata: {
            duration: 8,
            width: 0,
            height: 0,
            frameRate: 0,
            codec: "aac",
            sampleRate: 48_000,
            channels: 2,
            fileSize: 1,
          },
          thumbnailUrl: null,
          waveformData: null,
        },
        {
          id: "media-dialogue",
          name: "Dialogue",
          type: "video",
          fileHandle: null,
          blob: null,
          metadata: {
            duration: 5,
            width: 1920,
            height: 1080,
            frameRate: 30,
            codec: "h264",
            sampleRate: 48_000,
            channels: 2,
            fileSize: 1,
          },
          thumbnailUrl: null,
          waveformData: null,
        },
      ],
    },
    timeline: {
      ...project.timeline,
      duration: 8,
      tracks: [
        {
          id: "track-music",
          type: "audio",
          name: "Music Bed",
          clips: [
            {
              id: targetClipId,
              mediaId: "media-music",
              trackId: "track-music",
              startTime: 0,
              duration: 8,
              inPoint: 0,
              outPoint: 8,
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
              automation: {
                volume: [
                  { time: 0, value: 1 },
                  { time: 0.25, value: 0.3 },
                  { time: 1.2, value: 1 },
                ],
              },
              keyframes: [],
              metadata: {
                audioDucking: {
                  enabled: true,
                  sourceTrackId: triggerTrackId,
                  threshold: -28,
                  reduction: 0.7,
                  attack: 0.08,
                  release: 0.4,
                  holdTime: 0.2,
                },
              },
            },
          ],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
        {
          id: triggerTrackId,
          type: "video",
          name: "Dialogue Track",
          clips: [
            {
              id: "clip-dialogue",
              mediaId: "media-dialogue",
              trackId: triggerTrackId,
              startTime: 0,
              duration: 5,
              inPoint: 0,
              outPoint: 5,
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
            },
          ],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
      ],
    },
  };
};

describe.each(["en-US", "zh-CN"] as const)("AudioDuckingSection (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => {
    configureShotloomLocale(locale);
    useProjectStore.setState({
      project: createProjectWithPersistedDucking(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    configureShotloomLocale("en-US");
    useProjectStore.setState({ project: createEmptyProject("Reset") });
  });

  it("rehydrates persisted ducking and shows video tracks as valid trigger sources", () => {
    render(<AudioDuckingSection clipId={targetClipId} />);

    expect(screen.getByText(ui("Ducking Applied", "已应用音频闪避"))).toBeInTheDocument();
    expect(screen.getByText(ui("Ducking Enabled", "音频闪避已开启"))).toBeInTheDocument();
    expect(screen.getByText("Dialogue Track")).toBeInTheDocument();
    expect(screen.getByText(ui("Trigger Source (Voice Track)", "触发来源（语音轨道）"))).toBeInTheDocument();
  });
  it("removes persisted ducking and volume automation in both languages", () => {
    render(<AudioDuckingSection clipId={targetClipId} />);
    fireEvent.click(screen.getByRole("button", { name: ui("Remove", "移除") }));
    const clip = useProjectStore.getState().getClip(targetClipId)!;
    expect(clip.metadata?.audioDucking).toBeUndefined();
    expect(clip.automation?.volume ?? []).toHaveLength(0);
    expect(screen.getByText(ui("Ducking Disabled", "音频闪避已关闭"))).toBeInTheDocument();
  });

  it("shows the translated decode failure without replacing stored automation", async () => {
    render(<AudioDuckingSection clipId={targetClipId} />);
    fireEvent.click(screen.getByRole("button", { name: ui("Update", "更新") }));
    expect(await screen.findByText(ui("No decodable trigger audio was found on the selected source track.", "所选来源轨道中没有可解码的触发音频。"))).toBeInTheDocument();
    expect(useProjectStore.getState().getClip(targetClipId)?.automation?.volume).toHaveLength(3);
  });

  it("submits original preset parameters and edited reduction before persisting automation", async () => {
    const project = createProjectWithPersistedDucking();
    const media = project.mediaLibrary.items[1];
    const blob = new Blob(["audio bytes"]);
    Object.defineProperty(blob, "arrayBuffer", { value: async () => new ArrayBuffer(8) });
    useProjectStore.setState({ project: { ...project, mediaLibrary: { ...project.mediaLibrary, items: [project.mediaLibrary.items[0], { ...media, blob }] } } });
    const originalSource = AudioContext.prototype.createBufferSource;
    vi.spyOn(AudioContext.prototype, "createBufferSource").mockImplementation(function(this: AudioContext) {
      const source = originalSource.call(this);
      Object.defineProperty(source, "playbackRate", { value: { value: 1 } });
      return source;
    });
    const frames = [{ time: 0, value: 1 }, { time: 0.1, value: 0.25 }, { time: 1, value: 1 }];
    const generate = vi.spyOn(AudioDucker.prototype, "generateDuckingKeyframes").mockReturnValue(frames);
    render(<AudioDuckingSection clipId={targetClipId} />);
    fireEvent.click(screen.getByRole("button", { name: ui("Podcast", "播客") }));
    fireEvent.click(screen.getByRole("button", { name: ui("Edit Volume Reduction value", "编辑音量衰减数值") }));
    const input = screen.getByRole("textbox", { name: ui("Volume Reduction value", "音量衰减数值") });
    fireEvent.change(input, { target: { value: "65" } }); fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: ui("Update", "更新") }));
    await waitFor(() => expect(generate).toHaveBeenCalled());
    expect(generate).toHaveBeenCalledWith(expect.anything(), { enabled: true, sourceTrackId: triggerTrackId, threshold: -28, reduction: 0.65, attack: 0.08, release: 0.4, holdTime: 0.3 }, 1);
    await waitFor(() => expect(useProjectStore.getState().getClip(targetClipId)?.metadata?.audioDucking).toMatchObject({ reduction: 0.65, sourceTrackId: triggerTrackId }));
    expect(useProjectStore.getState().getClip(targetClipId)?.automation?.volume).toEqual(frames);
  });

});
