import { configureShotloomLocale } from "../../../shotloom-mode";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Project } from "@openreel/core";
import { getMotionShaderDef, getMotionShaderEffectDefs } from "@openreel/core";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import { VideoEffectsSection } from "./VideoEffectsSection";

const clipId = "clip-shader";

const createProjectWithShaderEffect = (): Project => {
  const project = createEmptyProject("Shader Effect");
  return {
    ...project,
    timeline: {
      ...project.timeline,
      duration: 5,
      tracks: [
        {
          id: "track-video",
          type: "video",
          name: "V1",
          clips: [
            {
              id: clipId,
              mediaId: "media-1",
              trackId: "track-video",
              startTime: 0,
              duration: 5,
              inPoint: 0,
              outPoint: 5,
              effects: [
                {
                  id: "effect-shader-1",
                  type: "shader",
                  enabled: true,
                  params: { shaderId: "paper-halftone-dots", size: 0.6 },
                },
              ],
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
  } as unknown as Project;
};

const createProjectWithOrderedEffects = (): Project => {
  const project = createProjectWithShaderEffect();
  return {
    ...project,
    timeline: {
      ...project.timeline,
      tracks: project.timeline.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) =>
          clip.id === clipId
            ? {
                ...clip,
                effects: [
                  ...clip.effects,
                  {
                    id: "effect-brightness-1",
                    type: "brightness",
                    enabled: true,
                    params: { value: 20 },
                  },
                ],
              }
            : clip,
        ),
      })),
    },
  } as Project;
};

describe.each(["en-US", "zh-CN"] as const)("VideoEffectsSection shader effect (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => {
    configureShotloomLocale(locale);
    useProjectStore.setState({ project: createProjectWithShaderEffect() });
  });

  afterEach(() => {
    cleanup();
    configureShotloomLocale("en-US");
  });

  it("renders the shader effect card with its name and a numeric param slider", () => {
    render(<VideoEffectsSection clipId={clipId} />);
    const def = getMotionShaderDef("paper-halftone-dots");
    expect(def).toBeDefined();
    expect(screen.getAllByText(ui(def!.name, "半色调网点")).length).toBeGreaterThan(0);
    const numericParam = def!.params.find((p) => p.type === "number");
    expect(numericParam).toBeDefined();
    expect(screen.getByText(ui(numericParam!.label, "大小"))).toBeInTheDocument();
  });

  it("shows an Add Effect trigger for adding more effects", () => {
    render(<VideoEffectsSection clipId={clipId} />);
    expect(screen.getByText(ui("Add Effect", "添加效果"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ui("Copy effect stack", "复制效果栈") })).toBeEnabled();
    expect(screen.getByRole("button", { name: ui("Clear effect stack", "清空效果栈") })).toBeEnabled();
  });

  it("clears the authored stack from one inspector action", async () => {
    render(<VideoEffectsSection clipId={clipId} />);

    fireEvent.click(screen.getByRole("button", { name: ui("Clear effect stack", "清空效果栈") }));

    await waitFor(() => {
      expect(useProjectStore.getState().getVideoEffects(clipId)).toEqual([]);
    });
  });

  it("copies and pastes the authored stack with fresh effect ids", async () => {
    render(<VideoEffectsSection clipId={clipId} />);
    const sourceId = useProjectStore.getState().getVideoEffects(clipId)[0]!.id;

    fireEvent.click(screen.getByRole("button", { name: ui("Copy effect stack", "复制效果栈") }));
    fireEvent.click(screen.getByRole("button", { name: ui("Paste effect stack", "粘贴效果栈") }));

    await waitFor(() => {
      const effects = useProjectStore.getState().getVideoEffects(clipId);
      expect(effects).toHaveLength(2);
      expect(effects[1]).toMatchObject({
        type: "shader",
        params: { shaderId: "paper-halftone-dots", size: 0.6 },
      });
      expect(effects[1]?.id).not.toBe(sourceId);
    });
  });

  it("duplicates an authored effect from its card", async () => {
    render(<VideoEffectsSection clipId={clipId} />);

    fireEvent.click(screen.getByRole("button", { name: ui("Duplicate effect", "复制效果") }));

    await waitFor(() => {
      const effects = useProjectStore.getState().getVideoEffects(clipId);
      expect(effects).toHaveLength(2);
      expect(effects[1]).toMatchObject({
        type: "shader",
        enabled: true,
        params: { shaderId: "paper-halftone-dots", size: 0.6 },
      });
      expect(effects[1]?.id).not.toBe(effects[0]?.id);
    });
  });

  it("opens a searchable visual picker for standard and shader effects", () => {
    render(<VideoEffectsSection clipId={clipId} />);

    fireEvent.click(screen.getByText(ui("Add Effect", "添加效果")));
    expect(
      screen.getByRole("button", { name: ui("Preview and add Brightness", "预览并添加亮度") }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: ui("Preview and add Tonal Balance", "预览并添加影调平衡") }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: ui("Preview and add Chroma Key", "预览并添加色度抠像") }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: ui("Preview and add Grayscale", "预览并添加灰度") }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: ui("Preview and add Sepia", "预览并添加褐色调") }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: ui("Preview and add Invert", "预览并添加反色") }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: ui("Search visual effects", "搜索视觉效果") }), {
      target: { value: ui("radial", "径向") },
    });
    expect(
      screen.getByRole("button", { name: ui("Preview and add Radial Blur", "预览并添加径向模糊") }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: ui("Preview and add Brightness", "预览并添加亮度") }),
    ).toBeNull();

    fireEvent.click(
      screen.getByRole("button", {
        name: ui(`Shaders · ${getMotionShaderEffectDefs().length}`, `着色器 · ${getMotionShaderEffectDefs().length}`),
      }),
    );
    expect(
      screen.getByRole("button", {
        name: ui("Preview and apply Halftone Dots", "预览并应用半色调网点"),
      }),
    ).toBeInTheDocument();
  });

  it("adds a standard effect and edits its original numeric parameter", async () => {
    render(<VideoEffectsSection clipId={clipId} />);
    fireEvent.click(screen.getByText(ui("Add Effect", "添加效果")));
    fireEvent.click(screen.getByRole("button", { name: ui("Preview and add Brightness", "预览并添加亮度") }));
    await waitFor(() => expect(useProjectStore.getState().getVideoEffects(clipId).some((effect) => effect.type === "brightness")).toBe(true));
    // The picker stays open to allow several additions. Close it before editing.
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: ui("Edit Value value", "编辑数值数值") }));
    const input = screen.getByRole("textbox", { name: ui("Value value", "数值数值") });
    fireEvent.change(input, { target: { value: "25" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(useProjectStore.getState().getVideoEffects(clipId).find((effect) => effect.type === "brightness")?.params.value).toBe(25);
  });

  it("reorders the authored effect stack from accessible controls", () => {
    useProjectStore.setState({ project: createProjectWithOrderedEffects() });
    render(<VideoEffectsSection clipId={clipId} />);
    const shaderName = getMotionShaderDef("paper-halftone-dots")!.name;

    fireEvent.click(screen.getByRole("button", { name: ui(`Move ${shaderName} down`, "下移半色调网点") }));

    expect(
      useProjectStore
        .getState()
        .getVideoEffects(clipId)
        .map((effect) => effect.id),
    ).toEqual(["effect-brightness-1", "effect-shader-1"]);
    expect(
      screen.getByRole("button", { name: ui(`Reorder ${shaderName}`, "调整半色调网点顺序") }),
    ).toHaveAttribute("draggable", "true");
  });
});
