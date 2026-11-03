import "../../../test/install-local-storage-mock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MaskEngine, type Clip, type Project } from "@openreel/core";

import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useEngineStore } from "../../../stores/engine-store";
import { useProjectStore } from "../../../stores/project-store";
import { configureShotloomLocale, editorMessage } from "../../../shotloom-mode";
import { MaskSection } from "./MaskSection";

const CLIP_ID = "mask-workflow-clip";

function clip(): Clip {
  return {
    id: CLIP_ID,
    mediaId: "mask-media",
    trackId: "mask-track",
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
  };
}

function project(): Project {
  const empty = createEmptyProject("Mask workflow");
  return {
    ...empty,
    modifiedAt: 1,
    timeline: {
      ...empty.timeline,
      duration: 5,
      tracks: [
        {
          id: "mask-track",
          type: "video",
          name: "Video",
          clips: [clip(), { ...clip(), id: "matte-source-clip" }],
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

describe.each(["en-US", "zh-CN"] as const)("MaskSection professional workflow (%s)", (locale) => {
  let engine: MaskEngine;
  let originalGetMaskEngine: ReturnType<typeof useEngineStore.getState>["getMaskEngine"];

  beforeEach(() => {
    configureShotloomLocale(locale);
    engine = new MaskEngine({ width: 1920, height: 1080 });
    originalGetMaskEngine = useEngineStore.getState().getMaskEngine;
    useEngineStore.setState({ getMaskEngine: async () => engine });
    useProjectStore.setState({
      hasOpenProject: true,
      project: project(),
    });
  });

  afterEach(() => {
    cleanup();
    configureShotloomLocale("en-US");
    useEngineStore.setState({ getMaskEngine: originalGetMaskEngine });
    useProjectStore.setState({
      hasOpenProject: false,
      project: createEmptyProject("Reset"),
    });
  });

  it("uses translated matte channels while persisting the original channel value", async () => {
    render(<MaskSection clipId={CLIP_ID} />);
    fireEvent.click(await screen.findByRole("button", { name: editorMessage("editor.maskControls.addMatte") }));
    expect(await screen.findByText(editorMessage("editor.masks.heading", { count: 1 }))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: editorMessage("editor.masks.bounds") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: editorMessage("editor.masks.alpha") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: editorMessage("editor.masks.luminance") })).toBeInTheDocument();
    expect(screen.getByText(editorMessage("editor.masks.sourceHint", { channel: editorMessage("editor.masks.bounds") }))).toBeInTheDocument();
    expect(useProjectStore.getState().project.masks?.[0]).toMatchObject({ matteSource: "bounds", sourceClipId: "matte-source-clip" });
    for (const channel of ["alpha", "luminance"] as const) {
      fireEvent.click(screen.getByRole("button", { name: editorMessage(channel === "alpha" ? "editor.masks.alpha" : "editor.masks.luminance") }));
      await waitFor(() => expect(useProjectStore.getState().project.masks?.[0]).toMatchObject({ matteSource: channel, sourceClipId: "matte-source-clip" }));
    }
  });

  it("shows translated shape choices and persists the original geometry", async () => {
    render(<MaskSection clipId={CLIP_ID} />);
    expect(screen.getByText(locale === "zh-CN" ? "此片段尚无蒙版" : "No masks on this clip")).toBeInTheDocument();
    await screen.findByRole("button", { name: editorMessage("editor.maskControls.rectangle") });
    fireEvent.click(screen.getByRole("button", { name: editorMessage("editor.maskControls.rectangle") }));
    await waitFor(() => expect(engine.getMasksForClip(CLIP_ID)).toHaveLength(1));
    expect(engine.getMasksForClip(CLIP_ID)[0]).toMatchObject({
      clipId: CLIP_ID, type: "shape", path: { closed: true, points: [
        { x: 0.25, y: 0.25 }, { x: 0.75, y: 0.25 },
        { x: 0.75, y: 0.75 }, { x: 0.25, y: 0.75 },
      ] },
    });
    fireEvent.click(screen.getByRole("button", { name: editorMessage("editor.maskControls.invert") }));
    await waitFor(() => expect(useProjectStore.getState().project.masks?.[0].inverted).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: editorMessage("editor.maskControls.clear") }));
    await waitFor(() => expect(useProjectStore.getState().project.masks).toHaveLength(0));
  });

  it("creates an editable custom path, persists opacity, and duplicates all settings", async () => {
    render(<MaskSection clipId={CLIP_ID} />);

    fireEvent.click(
      await screen.findByRole("button", { name: editorMessage("editor.maskControls.addCustom") }),
    );

    await waitFor(() => {
      expect(engine.getMasksForClip(CLIP_ID)).toHaveLength(1);
      expect(useProjectStore.getState().project.masks).toHaveLength(1);
      expect(useProjectStore.getState().project.modifiedAt).toBeGreaterThan(1);
    });
    expect(screen.getByText(editorMessage("editor.maskControls.points"))).toBeInTheDocument();
    expect(
      screen.getByRole("spinbutton", { name: editorMessage("editor.maskControls.pointX", { index: 1 }) }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByRole("spinbutton", { name: editorMessage("editor.maskControls.pointX", { index: 1 }) }), { target: { value: "25" } });
    await waitFor(() => expect(useProjectStore.getState().project.masks?.[0]?.path.points[0].x).toBe(0.25));
    fireEvent.click(screen.getByRole("button", { name: editorMessage("editor.maskControls.addPoint") }));
    expect(engine.getMasksForClip(CLIP_ID)[0].path.points).toHaveLength(7);

    fireEvent.click(screen.getByRole("button", { name: locale === "zh-CN" ? "编辑不透明度数值" : "Edit Opacity value" }));
    const opacityInput = screen.getByRole("textbox", { name: locale === "zh-CN" ? "不透明度数值" : "Opacity value" });
    fireEvent.change(opacityInput, { target: { value: "42%" } });
    fireEvent.keyDown(opacityInput, { key: "Enter" });

    await waitFor(() => {
      expect(engine.getMasksForClip(CLIP_ID)[0]?.opacity).toBe(0.42);
      expect(useProjectStore.getState().project.masks?.[0]?.opacity).toBe(0.42);
    });

    fireEvent.click(screen.getByRole("button", { name: editorMessage("editor.maskControls.duplicate") }));
    await waitFor(() => {
      const masks = engine.getMasksForClip(CLIP_ID);
      expect(masks).toHaveLength(2);
      expect(masks[1]).toMatchObject({ type: "drawn", opacity: 0.42 });
      expect(masks[1].path.points[0].x).toBe(0.25);
      expect(masks[1].path.points).toHaveLength(7);
      expect(useProjectStore.getState().project.masks).toHaveLength(2);
    });
  });
});
