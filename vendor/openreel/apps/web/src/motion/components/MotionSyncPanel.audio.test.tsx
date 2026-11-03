import { configureShotloomLocale } from "../../shotloom-mode";
import "../../test/install-local-storage-mock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { MotionComposition } from "@openreel/core";

import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useMotionStore } from "../stores/motion-store";
import { MotionSyncPanel } from "./MotionSyncPanel";

const composition: MotionComposition = {
  id: "audio-inspector-composition",
  name: "Audio Inspector",
  width: 1920,
  height: 1080,
  frameRate: 30,
  duration: 8,
  backgroundColor: "transparent",
  layers: [],
  assets: [],
  variables: [],
  markers: [],
  audioClips: [
    {
      id: "audio-1",
      name: "Voiceover",
      mediaId: "media-1",
      startTime: 1,
      duration: 4,
      trimStart: 0.25,
      gain: 0.8,
      fadeIn: 0.1,
      fadeOut: 0.2,
    },
  ],
  createdAt: 1,
  modifiedAt: 1,
};

function storedComposition(): MotionComposition {
  const stored = useProjectStore
    .getState()
    .getMotionComposition(composition.id);
  if (!stored) throw new Error("audio inspector composition missing");
  return stored;
}

describe.each(["en-US", "zh-CN"] as const)("MotionSyncPanel audio inspector (%s)", locale => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => {
    configureShotloomLocale(locale);
    window.localStorage.clear();
    useProjectStore.setState({
      hasOpenProject: true,
      project: {
        ...createEmptyProject("Audio inspector test"),
        motionCompositions: [composition],
      },
    });
    useMotionStore.setState({
      selectedLayerId: null,
      selectedLayerIds: [],
      selectedKeyframeIds: [],
      selectedLightId: null,
      selectedAudioClipId: null,
      selectedProperty: null,
    });
  });

  afterEach(() => {
    cleanup();
    configureShotloomLocale("en-US");
    window.localStorage.clear();
    useProjectStore.setState({
      hasOpenProject: false,
      project: createEmptyProject("Reset"),
    });
  });

  it("links clip selection to the inspector and exposes detailed audio controls", async () => {
    render(<MotionSyncPanel composition={composition} embedded />);

    const clipButton = screen.getByRole("button", {
      name: ui("Select audio clip Voiceover", "选择音频片段 Voiceover"),
    });
    fireEvent.click(clipButton);

    expect(useMotionStore.getState().selectedAudioClipId).toBe("audio-1");
    expect(clipButton).toHaveAttribute("aria-pressed", "true");
    for (const label of [
      "Gain",
      "Duration",
      "Source trim",
      "Fade in",
      "Fade out",
    ]) {
      expect(screen.getByText(ui(label, ({ "Gain": "增益", "Duration": "时长", "Source trim": "源素材裁切", "Fade in": "淡入", "Fade out": "淡出" } as Record<string, string>)[label]), { exact: true })).toBeInTheDocument();
    }
    expect(screen.getAllByText(ui("Start", "开始"), { exact: true }).length).toBeGreaterThan(
      0,
    );

    fireEvent.click(screen.getByRole("switch", { name: ui("Mute clip", "静音片段") }));
    await waitFor(() => {
      expect(storedComposition().audioClips?.[0]?.muted).toBe(true);
    });
  });

  it("clears shared selection when the selected clip is removed", async () => {
    useMotionStore.getState().selectAudioClip("audio-1");
    render(<MotionSyncPanel composition={composition} embedded />);

    fireEvent.click(screen.getByRole("button", { name: ui("Remove audio clip", "移除音频片段") }));

    await waitFor(() => {
      expect(storedComposition().audioClips).toHaveLength(0);
    });
    expect(useMotionStore.getState().selectedAudioClipId).toBeNull();
  });
  it("generates and clears beats using the same timing data", async () => {
    const view = render(<MotionSyncPanel composition={composition} embedded />);
    fireEvent.click(screen.getByRole("button", { name: ui("Generate Beat Grid", "生成节拍网格") }));
    await waitFor(() => expect(storedComposition().beatMarkers?.length).toBeGreaterThan(0));
    expect(storedComposition().beatAnalysis?.bpm).toBe(120);
    expect(storedComposition().beatMarkers?.slice(0, 3).map(b => b.time)).toEqual([0, 0.5, 1]);
    view.rerender(<MotionSyncPanel composition={storedComposition()} embedded />);
    expect(screen.getByRole("option", { name: ui("Pulse", "脉冲") })).toHaveValue("pulse");
    fireEvent.click(screen.getByRole("button", { name: ui("Clear Beat Markers", "清除节拍标记") }));
    await waitFor(() => expect(storedComposition().beatMarkers ?? []).toHaveLength(0));
  });

  it("adds a localized marker and preserves its name when navigating", async () => {
    useMotionStore.setState({ playhead: 2.25 });
    const view = render(<MotionSyncPanel composition={composition} embedded />);
    fireEvent.click(screen.getByRole("button", { name: ui("Add Marker At Playhead", "在播放头处添加标记") }));
    await waitFor(() => expect(storedComposition().markers).toHaveLength(1));
    expect(storedComposition().markers[0]).toMatchObject({ label: ui("Marker 1", "标记 1"), time: 2.25 });
    const comp = { ...storedComposition(), markers: storedComposition().markers.map(m => ({ ...m, label: "Marker {keep}" })) };
    await act(async () => { await useProjectStore.getState().upsertMotionComposition(comp); });
    view.rerender(<MotionSyncPanel composition={comp} embedded />);
    expect(screen.getByText("Marker {keep}")).toHaveAttribute("data-shotloom-user-content");
    act(() => useMotionStore.setState({ playhead: 0 }));
    fireEvent.click(screen.getByRole("button", { name: ui("Go to marker", "跳转到标记") }));
    expect(useMotionStore.getState().playhead).toBe(2.25);
    fireEvent.click(screen.getByRole("button", { name: ui("Remove marker", "移除标记") }));
    await waitFor(() => expect(storedComposition().markers).toHaveLength(0));
  });

});
