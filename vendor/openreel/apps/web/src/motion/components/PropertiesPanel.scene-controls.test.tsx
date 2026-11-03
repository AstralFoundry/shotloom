import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createDefaultMotionCamera, createMotionGuide, createMotionLight, type MotionComposition } from "@openreel/core";
import { configureShotloomLocale } from "../../shotloom-mode";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useMotionStore } from "../stores/motion-store";
import { PropertiesPanel } from "./PropertiesPanel";

function composition(): MotionComposition {
  const comp: MotionComposition = {
    id: "scene-controls", name: "User {scene}", width: 1280, height: 720,
    frameRate: 30, duration: 5, backgroundColor: "#000000", layers: [], assets: [],
    variables: [], markers: [], createdAt: 1, modifiedAt: 1,
  };
  return {
    ...comp,
    camera: { ...createDefaultMotionCamera(comp), enabled: true },
    lights: [createMotionLight("point", comp, { id: "user-light", name: "User {light}" })],
    guides: [createMotionGuide("vertical", 100)],
    motionBlur: { enabled: true, shutterAngle: 180, shutterPhase: 0, samples: 8 },
  };
}
function stored() {
  return useProjectStore.getState().project.motionCompositions![0];
}
function numberField(label: string) {
  const field = screen.getAllByText(label).map(node => node.closest(".astryx-field"))
    .find(node => node && within(node as HTMLElement).queryByRole("spinbutton"));
  if (!field) throw new Error(`Missing field: ${label}`);
  return within(field as HTMLElement).getByRole("spinbutton");
}

describe.each(["en-US", "zh-CN"] as const)("localized scene controls (%s)", locale => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => {
    configureShotloomLocale(locale);
    useProjectStore.setState({ hasOpenProject: true, project: {
      ...createEmptyProject("Scene controls"), motionCompositions: [composition()],
    } });
    useMotionStore.setState({ selectedLayerId: null, selectedLayerIds: [], selectedLightId: null, playhead: 1, autoKeyframe: false });
  });
  afterEach(() => { cleanup(); configureShotloomLocale("en-US"); useProjectStore.setState({ hasOpenProject: false }); });

  it("writes camera focus and its original keyframe property", async () => {
    render(<PropertiesPanel composition={stored()} />);
    fireEvent.change(numberField(ui("Focus", "焦点")), { target: { value: "500" } });
    await waitFor(() => expect(stored().camera?.depthOfField?.focusDistance).toBe(500));
    cleanup();
    render(<PropertiesPanel composition={stored()} />);
    fireEvent.click(screen.getAllByRole("button", { name: ui("Add camera keyframe", "添加摄像机关键帧") })[0]);
    await waitFor(() => expect(stored().camera?.keyframes?.some(key => key.property === "camera.position.x" && key.time === 1)).toBe(true));
    expect(stored().name).toBe("User {scene}");
  });

  it("creates localized lights while preserving existing user names", async () => {
    render(<PropertiesPanel composition={stored()} />);
    fireEvent.click(screen.getByRole("button", { name: ui("Point", "点光源") }));
    await waitFor(() => expect(stored().lights).toHaveLength(2));
    const lights = stored().lights!;
    expect(lights[0].name).toBe("User {light}");
    expect(lights[0].id).toBe("user-light");
    expect(lights[1].name).toBe(ui("Point Light", "点光源"));
    expect(lights[1].type).toBe("point");
    expect(lights[1].id).not.toBe("user-light");
  });

  it("writes guide orientation and shutter settings using unchanged values", async () => {
    render(<PropertiesPanel composition={stored()} />);
    fireEvent.change(screen.getByRole("combobox", { name: ui("Guide orientation", "参考线方向") }), { target: { value: "horizontal" } });
    await waitFor(() => expect(stored().guides![0].orientation).toBe("horizontal"));
    cleanup();
    render(<PropertiesPanel composition={stored()} />);
    fireEvent.change(numberField(ui("Shutter angle", "快门角度")), { target: { value: "270" } });
    await waitFor(() => expect(stored().motionBlur?.shutterAngle).toBe(270));
    expect(stored().guides![0].position).toBe(100);
    expect(stored().motionBlur?.samples).toBe(8);
  });
});
