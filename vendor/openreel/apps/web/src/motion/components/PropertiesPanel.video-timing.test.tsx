import { configureShotloomLocale } from "../../shotloom-mode";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  DEFAULT_MOTION_TRANSFORM,
  type MotionComposition,
  type MotionVideoLayer,
} from "@openreel/core";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useMotionStore } from "../stores/motion-store";
import { PropertiesPanel } from "./PropertiesPanel";

const COMP_ID = "video-timing-comp";
const LAYER_ID = "video-layer";

function composition(): MotionComposition {
  const layer: MotionVideoLayer = {
    id: LAYER_ID,
    type: "video",
    name: "Footage",
    assetId: "video-asset",
    startTime: 0,
    duration: 8,
    visible: true,
    locked: false,
    transform: DEFAULT_MOTION_TRANSFORM,
    keyframes: [],
    playbackRate: 1,
    trimStart: 1,
  };
  return {
    id: COMP_ID,
    name: "Video timing",
    width: 1280,
    height: 720,
    frameRate: 30,
    duration: 8,
    backgroundColor: "#000000",
    layers: [layer],
    assets: [{ id: "video-asset", type: "video", name: "Take 01", duration: 10 }],
    variables: [],
    markers: [],
    createdAt: 1,
    modifiedAt: 1,
  };
}

describe.each(["en-US", "zh-CN"] as const)("PropertiesPanel video source timing (%s)", locale => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => {
    configureShotloomLocale(locale);
    useProjectStore.setState({
      hasOpenProject: true,
      project: { ...createEmptyProject("Video timing"), motionCompositions: [composition()] },
    });
    useMotionStore.setState({
      selectedLayerId: LAYER_ID,
      selectedLayerIds: [LAYER_ID],
      selectedLightId: null,
      rightTab: "properties",
      playhead: 2,
    });
  });

  afterEach(() => {
    configureShotloomLocale("en-US");
    cleanup();
    useProjectStore.setState({ hasOpenProject: false });
  });

  it("exposes loop, reverse, and freezes the current source frame", async () => {
    render(<PropertiesPanel composition={composition()} />);
    expect(screen.getByRole("switch", { name: ui("Loop source", "循环播放源素材") })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: ui("Reverse", "倒放") })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("switch", { name: ui("Freeze frame", "定格") }));
    await waitFor(() => {
      const stored = useProjectStore.getState().project.motionCompositions?.[0];
      expect((stored?.layers[0] as MotionVideoLayer).freezeFrame).toBe(3);
    });
  });
  it("writes source playback values while preserving asset identity", async () => {
    const stored = () => useProjectStore.getState().project.motionCompositions![0];
    render(<PropertiesPanel composition={composition()} />);
    fireEvent.click(screen.getByRole("switch", { name: ui("Loop source", "循环播放源素材") }));
    await waitFor(() => expect((stored().layers[0] as MotionVideoLayer).loop).toBe(true));
    cleanup();
    render(<PropertiesPanel composition={stored()} />);
    fireEvent.click(screen.getByRole("switch", { name: ui("Reverse", "倒放") }));
    await waitFor(() => expect((stored().layers[0] as MotionVideoLayer).reverse).toBe(true));
    cleanup();
    render(<PropertiesPanel composition={stored()} />);
    const fit = screen.getByRole("combobox", { name: ui("Video fit", "视频适配") });
    fireEvent.change(fit, { target: { value: "cover" } });
    await waitFor(() => expect((stored().layers[0] as MotionVideoLayer).fit).toBe("cover"));
    const source = screen.getByRole("option", { name: "Take 01" });
    expect(source).toHaveAttribute("data-shotloom-user-content", "");
    const layer = stored().layers[0] as MotionVideoLayer;
    expect(layer.assetId).toBe("video-asset");
    expect(layer.trimStart).toBe(1);
    expect(layer.playbackRate).toBe(1);
    expect(layer.name).toBe("Footage");
  });

});
