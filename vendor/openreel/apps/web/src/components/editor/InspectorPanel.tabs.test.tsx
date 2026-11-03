import { configureShotloomLocale } from "../../shotloom-mode";
import "../../test/install-local-storage-mock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Project } from "@openreel/core";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import { InspectorPanel } from "./InspectorPanel";

const clipId = "clip-vid";
const trackId = "track-vid";

async function renderInspector() {
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(<InspectorPanel />); });
  return view;
}


function seedClip(opts: {
  mediaId: string;
  trackType: "video" | "audio" | "image";
}): Project {
  const project = createEmptyProject("Inspector Sections Test");
  const mediaType = opts.trackType;
  const seeded: Project = {
    ...project,
    mediaLibrary: {
      items: [
        {
          id: opts.mediaId,
          name: opts.mediaId,
          type: mediaType,
          fileHandle: null,
          blob: null,
          metadata: {
            duration: 10,
            width: mediaType === "audio" ? 0 : 1920,
            height: mediaType === "audio" ? 0 : 1080,
            frameRate: mediaType === "audio" ? 0 : 30,
            codec: mediaType === "audio" ? "aac" : "h264",
            sampleRate: mediaType === "image" ? 0 : 48_000,
            channels: mediaType === "image" ? 0 : 2,
            fileSize: 1,
          },
          thumbnailUrl: null,
          waveformData: null,
        },
      ],
    },
    timeline: {
      ...project.timeline,
      duration: 10,
      tracks: [
        {
          id: trackId,
          type: opts.trackType,
          name: "Track",
          clips: [
            {
              id: clipId,
              mediaId: opts.mediaId,
              trackId,
              startTime: 0,
              duration: 10,
              inPoint: 0,
              outPoint: 10,
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
  useProjectStore.setState({ project: seeded, hasOpenProject: true });
  useUIStore.getState().select({ type: "clip", id: clipId, trackId });
  return seeded;
}

describe.each(["en-US", "zh-CN"] as const)("InspectorPanel sections (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => configureShotloomLocale(locale));
  afterEach(() => {
    cleanup();
    configureShotloomLocale("en-US");
    useUIStore.getState().clearSelection();
    useProjectStore.setState({ project: createEmptyProject("Reset"), hasOpenProject: false });
  });

  it("renders collapsible sections, not a tab bar", async () => {
    seedClip({ mediaId: "media-vid", trackType: "video" });
    const { container } = await renderInspector();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(
      container.querySelector('[data-section-id="transform"]'),
    ).not.toBeNull();
  });

  it("the Transform section is a collapsible with a toggle header", async () => {
    seedClip({ mediaId: "media-vid", trackType: "video" });
    const { container } = await renderInspector();
    const transformSection = container.querySelector<HTMLDivElement>(
      '[data-section-id="transform"]',
    );
    expect(transformSection).not.toBeNull();
    expect(transformSection?.querySelector("button")).not.toBeNull();
    expect(transformSection?.textContent).toContain(ui("Transform", "变换"));
  });

  it("a video clip renders the Transform section", async () => {
    seedClip({ mediaId: "media-vid", trackType: "video" });
    const { container } = await renderInspector();
    expect(
      container.querySelector('[data-section-id="transform"]'),
    ).not.toBeNull();
  });

  it("an audio clip does NOT render the Transform section", async () => {
    seedClip({ mediaId: "media-audio", trackType: "audio" });
    const { container } = await renderInspector();
    expect(
      container.querySelector('[data-section-id="transform"]'),
    ).toBeNull();
  });

  it("shows per-clip volume and fade controls for audio media", async () => {
    seedClip({ mediaId: "media-audio", trackType: "audio" });
    const { container } = await renderInspector();

    expect(container.querySelector('[data-section-id="clip-audio"]')).not.toBeNull();
    expect(screen.getByText(ui("Volume", "音量"))).toBeTruthy();
    expect(screen.getByText(ui("Fade in", "淡入"))).toBeTruthy();
    expect(screen.getByText(ui("Fade out", "淡出"))).toBeTruthy();
    expect(container.querySelector('[data-section-id="auto-captions"]')).not.toBeNull();
    expect(container.querySelector('[data-section-id="editable-captions"]')).not.toBeNull();
  });

  it("an image clip renders the Transform section", async () => {
    seedClip({ mediaId: "media-img", trackType: "image" });
    const { container } = await renderInspector();
    expect(
      container.querySelector('[data-section-id="transform"]'),
    ).not.toBeNull();
  });
  it("renders localized audio, color and animation section headings", async () => {
    seedClip({ mediaId: "media-vid", trackType: "video" });
    const { container } = await renderInspector();
    for (const [id, en, zh] of [
      ["voice-over", "Voice Over", "配音"],
      ["clip-audio", "Clip Audio", "片段音频"],
      ["audio-effects", "Audio Effects", "音频效果"],
      ["auto-cut-silence", "Auto Cut Silence", "自动剪除静音"],
      ["audio-ducking", "Audio Ducking", "音频闪避"],
      ["color-grading", "Color Grading", "调色"],
      ["keyframes", "Keyframes", "关键帧"],
      ["transitions", "Transitions", "转场"],
      ["motion-presets", "Motion Presets", "动画预设"],
      ["motion-path", "Motion Path", "运动路径"],
      ["emphasis-animation", "Emphasis Animation", "强调动画"],
    ]) {
      expect(container.querySelector(`[data-section-id="${id}"]`)).toHaveTextContent(ui(en, zh));
    }
  });

  it("writes localized volume and fade edits to the selected clip", async () => {
    seedClip({ mediaId: "media-audio", trackType: "audio" });
    await renderInspector();
    function edit(label: string, value: string) {
      fireEvent.click(screen.getByRole("button", { name: ui(`Edit ${label} value`, `编辑${label}数值`) }));
      const input = screen.getByRole("textbox", { name: ui(`${label} value`, `${label}数值`) });
      fireEvent.change(input, { target: { value } });
      fireEvent.blur(input);
    }
    edit(ui("Volume", "音量"), "65");
    await waitFor(() => expect(useProjectStore.getState().project.timeline.tracks[0].clips[0].volume).toBe(0.65));
    edit(ui("Fade in", "淡入"), "1.2");
    await waitFor(() => expect(useProjectStore.getState().project.timeline.tracks[0].clips[0].fade?.fadeIn).toBe(1.2));
    edit(ui("Fade out", "淡出"), "2.5");
    await waitFor(() => expect(useProjectStore.getState().project.timeline.tracks[0].clips[0].fade?.fadeOut).toBe(2.5));
    expect(screen.getByRole("button", { name: ui("Edit Fade in value", "编辑淡入数值") })).toHaveTextContent(ui("1.2s", "1.2秒"));
    expect(screen.getByRole("button", { name: ui("Edit Fade out value", "编辑淡出数值") })).toHaveTextContent(ui("2.5s", "2.5秒"));
  });

});
