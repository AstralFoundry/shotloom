import "../../../test/install-local-storage-mock";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getBuiltInEditingTemplate, type EditingTemplate, type Project } from "@openreel/core";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { useNotificationStore } from "../../../stores/notification-store";
import { RecipesTab } from "./RecipesTab";

function projectWithClip(): Project {
  const project = createEmptyProject("Adjustment workflow");
  return {
    ...project,
    timeline: {
      ...project.timeline,
      duration: 8,
      tracks: [{
        id: "video-track",
        type: "video",
        name: "Video",
        locked: false,
        hidden: false,
        muted: false,
        solo: false,
        transitions: [],
        clips: [{
          id: "clip-1",
          mediaId: "media-1",
          trackId: "video-track",
          startTime: 1,
          duration: 4,
          inPoint: 0,
          outPoint: 4,
          transform: {
            position: { x: 0, y: 0 },
            scale: { x: 1, y: 1 },
            rotation: 0,
            anchor: { x: 0.5, y: 0.5 },
            opacity: 1,
          },
          effects: [],
          audioEffects: [],
          volume: 1,
          keyframes: [],
        }],
      }],
    },
  };
}

const custom: EditingTemplate = {
  id: "custom-recipe", name: "My custom look", description: "User-authored description", category: "cinema", thumbnailUrl: null, tags: ["portrait"], supportedTargets: ["video"],
  controls: [{ id: "strength", label: "My strength", type: "number", defaultValue: 0.5, min: 0, max: 1, step: 0.1 }],
  recipe: { effects: [], overlays: [], audioEffects: [] },
};

describe.each(["en-US", "zh-CN"] as const)("RecipesTab (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  const originalTemplates = useProjectStore.getState().getEditingTemplates;
  const originalApply = useProjectStore.getState().applyEditingTemplate;
  beforeEach(() => {
    configureShotloomLocale(locale);
    useProjectStore.setState({ project: projectWithClip(), hasOpenProject: true, getEditingTemplates: () => [custom], applyEditingTemplate: vi.fn(() => "application-real-id") });
    useUIStore.getState().select({ type: "clip", id: "clip-1", trackId: "video-track" });
  });
  afterEach(() => {
    cleanup();
    useUIStore.getState().clearSelection();
    useNotificationStore.getState().clearAll();
    configureShotloomLocale("en-US");
    useProjectStore.setState({ project: createEmptyProject("Reset"), hasOpenProject: false, getEditingTemplates: originalTemplates, applyEditingTemplate: originalApply });
  });

  it("shows guidance when no supported clip is selected", () => {
    useUIStore.getState().clearSelection();
    render(<RecipesTab />);
    expect(screen.getByText(ui("Select a clip first", "请先选择片段"))).toBeInTheDocument();
    expect(screen.getByText(ui("Choose a video or image in the timeline to apply clip-scoped recipes, looks, and caption treatments.", "在时间线中选择视频或图片，为片段应用配方、风格和字幕效果。"))).toBeInTheDocument();
  });

  it("searches authored names and tags and localizes the empty result", () => {
    render(<RecipesTab />);
    expect(screen.getByText("User-authored description")).toBeInTheDocument();
    expect(screen.getByText(ui("4.0s • 0 recipes applied", "4.0秒 · 已应用 0 个配方"))).toBeInTheDocument();
    const search = screen.getByRole("textbox", { name: ui("Search recipes", "搜索配方") });
    fireEvent.change(search, { target: { value: "missing-query" } });
    expect(screen.getByText(ui("No recipes match", "没有匹配的配方"))).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "portrait" } });
    expect(screen.getByText(custom.name)).toBeInTheDocument();
  });

  it("filters by the original category through translated options", () => {
    render(<RecipesTab />);
    fireEvent.click(screen.getByRole("checkbox", { name: ui("Retro", "复古") }));
    expect(screen.getByText(ui("No recipes match", "没有匹配的配方"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: ui("Cinema", "电影感") }));
    expect(screen.getByText(custom.name)).toBeInTheDocument();
  });

  it("applies edited controls with original identifiers and localized success", async () => {
    render(<RecipesTab />);
    fireEvent.click(screen.getByRole("button", { name: ui("Edit recipe controls", "编辑配方参数") }));
    fireEvent.keyDown(screen.getByRole("slider", { name: "My strength" }), { key: "ArrowRight" });
    fireEvent.click(screen.getByRole("button", { name: ui("Apply", "应用") }));
    await waitFor(() => expect(useProjectStore.getState().applyEditingTemplate).toHaveBeenCalledWith(custom.id, "clip-1", { strength: 0.6 }));
    expect(useNotificationStore.getState().notifications.at(-1)).toMatchObject({ title: ui("Recipe applied", "配方已应用"), message: ui("My custom look was added to the selected clip.", "已将My custom look添加到选中的片段。") });
  });

  it("localizes failed application without claiming success", async () => {
    useProjectStore.setState({ applyEditingTemplate: vi.fn(() => null) });
    render(<RecipesTab />);
    fireEvent.click(screen.getByRole("button", { name: ui("Apply", "应用") }));
    await waitFor(() => expect(useNotificationStore.getState().notifications.at(-1)?.type).toBe("error"));
    expect(useNotificationStore.getState().notifications.at(-1)).toMatchObject({ title: ui("Could not apply recipe", "无法应用配方"), message: ui("This recipe could not be applied to the current clip.", "无法将此配方应用于当前片段。") });
  });
  it("searches the translated built-in name and submits unchanged defaults", async () => {
    const builtin = getBuiltInEditingTemplate("cinema-letterbox")!;
    const source = JSON.stringify(builtin);
    useProjectStore.setState({ getEditingTemplates: () => [builtin] });
    render(<RecipesTab />);
    const search = screen.getByRole("textbox", { name: ui("Search recipes", "搜索配方") });
    fireEvent.change(search, { target: { value: ui("Cinematic", "宽银幕") } });
    expect(screen.getByText(ui("Cinematic Letterbox", "电影宽银幕"))).toBeInTheDocument();
    expect(screen.getByText(ui("Wide-screen bars with grain and vignette.", "添加宽银幕遮幅、颗粒和暗角。"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ui("Edit recipe controls", "编辑配方参数") }));
    expect(screen.getByRole("slider", { name: ui("Grain", "颗粒") })).toHaveAttribute("aria-valuenow", "0.3");
    expect(screen.getByRole("slider", { name: ui("Bar Opacity", "遮幅不透明度") })).toHaveAttribute("aria-valuenow", "1");
    fireEvent.change(search, { target: { value: "Cinematic" } });
    expect(screen.getByText(ui("Cinematic Letterbox", "电影宽银幕"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ui("Apply", "应用") }));
    await waitFor(() => expect(useProjectStore.getState().applyEditingTemplate).toHaveBeenCalledWith(builtin.id, "clip-1", { grainAmount: 0.3, barOpacity: 1 }));
    expect(useNotificationStore.getState().notifications.at(-1)?.message).toBe(ui("Cinematic Letterbox was added to the selected clip.", "已将电影宽银幕添加到选中的片段。"));
    expect(JSON.stringify(builtin)).toBe(source);
  });

});
