import "../../../../test/install-local-storage-mock";
import { configureShotloomLocale } from "../../../../shotloom-mode";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getBuiltInEditingTemplate, type Clip, type EditingTemplate } from "@openreel/core";
import { useNotificationStore } from "../../../../stores/notification-store";
import { EffectsTab, type EffectsTabProps } from "./EffectsTab";
import { editingTemplateCategoryLabel } from "../../panels/EditingTemplateControls";

const template: EditingTemplate = {
  id: "user-template", name: "My custom look", description: "User description", category: "cinema",
  thumbnailUrl: null, tags: [],
  controls: [{ id: "amount", type: "number", label: "My intensity", defaultValue: 0.5, min: 0, max: 1 }],
  recipe: { effects: [], audioEffects: [], overlays: [] },
};
const clip: Clip = {
  id: "clip-a", mediaId: "media-a", trackId: "track-a", startTime: 0, duration: 4,
  inPoint: 0, outPoint: 4, volume: 1, audioEffects: [], keyframes: [],
  transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 },
  effects: [
    { id: "brightness-a", type: "brightness", enabled: true, params: {} },
    { id: "custom-a", type: "custom-effect", enabled: false, params: {} },
    { id: "recipe-owned", type: "blur", enabled: true, params: {}, metadata: { templateSource: { ownerClipId: "clip-a", templateId: "user-template", applicationId: "application-a" } } },
  ],
};
function props(overrides: Partial<EffectsTabProps> = {}): EffectsTabProps {
  return {
    clipId: clip.id, clipType: "video", selectedClip: clip, selectedTimelineClip: clip,
    showVideoControls: true, showVideoEffects: true, showTextSection: false,
    appliedEditingTemplates: [{ templateId: template.id, applicationId: "application-a", name: "My custom look", category: "cinema", appliedAt: 1, controlValues: { amount: 0.7 } }],
    getEditingTemplate: () => template,
    removeEditingTemplateApplication: vi.fn(() => true),
    expandedRecipeApplicationId: "application-a", setExpandedRecipeApplicationId: vi.fn(),
    recipeControlValues: {}, setRecipeControlValues: vi.fn(),
    handleRecipeControlChange: vi.fn(), handleToggleRecipeControls: vi.fn(), handleResetRecipeControls: vi.fn(), handleUpdateRecipeControls: vi.fn(),
    chromaKeyEnabled: true, keyColor: "#00ff00", tolerance: 20,
    handleChromaKeyToggle: vi.fn(), handleKeyColorChange: vi.fn(), handleToleranceChange: vi.fn(),
    ...overrides,
  };
}

describe.each(["en-US", "zh-CN"] as const)("EffectsTab (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => configureShotloomLocale(locale));
  afterEach(() => { cleanup(); useNotificationStore.getState().clearAll(); configureShotloomLocale("en-US"); });

  it("localizes applied counts, known effect names and state while preserving user content", () => {
    render(<EffectsTab {...props()} />);
    expect(screen.getByText(ui("Applied (3)", "已应用（3）"))).toBeInTheDocument();
    expect(screen.getByText("My custom look")).toBeInTheDocument();
    expect(screen.getByText("My intensity")).toBeInTheDocument();
    expect(screen.getByText(ui("Cinema", "电影感"))).toBeInTheDocument();
    expect(screen.getByText(ui("Brightness", "亮度"))).toBeInTheDocument();
    expect(screen.getByText("custom-effect")).toBeInTheDocument();
    expect(screen.getByText(ui("On", "已启用"))).toBeInTheDocument();
    expect(screen.getByText(ui("Off", "已关闭"))).toBeInTheDocument();
  });

  it("sends original recipe identifiers through localized action buttons", () => {
    const value = props();
    render(<EffectsTab {...value} />);
    const application = value.appliedEditingTemplates[0];
    for (const [en, zh, handler] of [
      ["Edit", "编辑", value.handleToggleRecipeControls],
      ["Reset", "重置", value.handleResetRecipeControls],
      ["Update", "更新", value.handleUpdateRecipeControls],
    ] as const) {
      fireEvent.click(screen.getByRole("button", { name: ui(en, zh) }));
      expect(handler).toHaveBeenCalledWith(application.applicationId, application.templateId, application.controlValues);
    }
    fireEvent.click(screen.getByRole("button", { name: ui("Remove recipe", "移除配方") }));
    expect(value.removeEditingTemplateApplication).toHaveBeenCalledWith(clip.id, application.applicationId);
    expect(value.setExpandedRecipeApplicationId).toHaveBeenCalledWith(null);
    expect(value.setRecipeControlValues).toHaveBeenCalledOnce();
  });

  it("reports removal failure in the chosen language and keeps controls", () => {
    const value = props({ removeEditingTemplateApplication: vi.fn(() => false) });
    render(<EffectsTab {...value} />);
    fireEvent.click(screen.getByRole("button", { name: ui("Remove recipe", "移除配方") }));
    expect(useNotificationStore.getState().notifications.at(-1)).toMatchObject({
      title: ui("Could not remove recipe", "无法移除配方"),
      message: ui("The recipe could not be removed from this clip.", "无法从此片段中移除配方。"),
    });
    expect(value.setExpandedRecipeApplicationId).not.toHaveBeenCalled();
  });

  it("exposes localized chroma key controls without translating their values", () => {
    const value = props();
    render(<EffectsTab {...value} />);
    fireEvent.click(screen.getByRole("button", { name: ui("Expand Chroma Key (Green Screen) section", "展开色度键（绿幕）区域") }));
    fireEvent.click(screen.getByRole("switch", { name: ui("Enable chroma key", "启用色度键") }));
    expect(value.handleChromaKeyToggle).toHaveBeenCalledWith(false);
    fireEvent.change(screen.getByRole("textbox", { name: ui("Key Color", "抠像颜色") }), { target: { value: "#123456" } });
    expect(value.handleKeyColorChange).toHaveBeenCalledWith("#123456");
    fireEvent.keyDown(screen.getByRole("slider", { name: ui("Tolerance", "容差") }), { key: "ArrowRight" });
    expect(value.handleToleranceChange).toHaveBeenCalledWith(21);
  });

  it("localizes the effect groups and keeps unknown categories unchanged", () => {
    render(<EffectsTab {...props({ showTextSection: true })} />);
    for (const [en, zh] of [["Background Removal", "背景移除"], ["Particle Effects", "粒子效果"], ["Motion Tracking", "运动跟踪"], ["Video Effects", "视频效果"], ["Green Screen", "绿幕"], ["Picture-in-Picture", "画中画"], ["Masking", "蒙版"], ["Nested Sequences", "嵌套序列"], ["Adjustment Layers", "调整图层"], ["Text Behind Subject", "主体后方文字"]]) {
      expect(screen.getByText(ui(en, zh))).toBeInTheDocument();
    }
    expect(editingTemplateCategoryLabel("user-custom-category")).toBe("user-custom-category");
    expect(editingTemplateCategoryLabel("constructor")).toBe("constructor");
  });
  it("localizes unchanged applied built-in names and preserves renamed applications", () => {
    const builtin = getBuiltInEditingTemplate("cinema-letterbox")!;
    const application = { templateId: builtin.id, applicationId: "application-a", name: builtin.name, category: builtin.category, appliedAt: 1 };
    const value = props({ appliedEditingTemplates: [application], getEditingTemplate: () => builtin });
    const view = render(<EffectsTab {...value} />);
    expect(screen.getByText(ui("Cinematic Letterbox", "电影宽银幕"))).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: ui("Grain", "颗粒") })).toBeInTheDocument();
    view.rerender(<EffectsTab {...value} appliedEditingTemplates={[{ ...application, name: "My renamed bars" }]} />);
    expect(screen.getByText("My renamed bars")).toBeInTheDocument();
    expect(application.name).toBe("Cinematic Letterbox");
  });

});
