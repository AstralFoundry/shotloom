import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MOTION_PRESETS, type MotionComposition } from "@openreel/core";
import { configureShotloomLocale } from "../../shotloom-mode";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useMotionStore } from "../stores/motion-store";
import { MotionStartPanel } from "./MotionStartPanel";
import { MotionTemplateBrowser } from "./MotionTemplateBrowser";
const comp: MotionComposition = { id: "entry", name: "Original {name}", width: 1280, height: 720, frameRate: 30, duration: 5, backgroundColor: "#000000", layers: [], assets: [], variables: [], markers: [], createdAt: 1, modifiedAt: 1 };
function stored() { return useProjectStore.getState().project.motionCompositions!; }
const templateNames = ["广告卡片", "应用界面演示", "字幕条", "产品展示", "社交开场", "动态标题", "标志显现", "片尾"];
describe.each(["en-US", "zh-CN"] as const)("motion entry (%s)", locale => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => {
    configureShotloomLocale(locale);
    useProjectStore.setState({ hasOpenProject: true, project: { ...createEmptyProject("Entry"), motionCompositions: [comp] } });
    useMotionStore.setState({ selectedLayerId: null, selectedLayerIds: [], activeCompositionId: "entry", leftTab: "start", rightTab: "properties" });
  });
  afterEach(() => { cleanup(); configureShotloomLocale("en-US"); useProjectStore.setState({ hasOpenProject: false }); });
  it.each([["text", "Text", "文字", "Text Layer", "文字图层"], ["shape", "Shape", "形状", "Rectangle", "矩形"], ["scene3d", "3D Scene", "三维场景", "3D Scene", "三维场景"], ["particle", "Particles", "粒子", "Particle Emitter", "粒子发射器"]])("creates a %s layer from a translated action", async (type, en, zh, name, zhName) => {
    render(<MotionStartPanel composition={comp} />);
    fireEvent.click(screen.getByRole("button", { name: ui(en, zh) }));
    await waitFor(() => expect(stored()[0].layers).toHaveLength(1));
    const layer = stored()[0].layers[0];
    expect(layer.type).toBe(type);
    expect(layer.name).toBe(ui(name, zhName));
    if (layer.type === "text") expect(layer.text).toBe(ui("New text", "新文字"));
    expect(useMotionStore.getState().selectedLayerId).toBe(layer.id);
    expect(useMotionStore.getState().leftTab).toBe("layers");
    expect(stored()[0].name).toBe("Original {name}");
  });
  it.each([["Templates", "模板", "leftTab", "templates"], ["Assets", "素材", "leftTab", "assets"], ["Graph", "曲线", "rightTab", "graph"], ["Sync", "同步", "rightTab", "sync"], ["Variables", "变量", "rightTab", "variables"]] as const)("routes %s to the original tab ID", (en, zh, key, value) => {
    render(<MotionStartPanel composition={comp} />);
    fireEvent.click(screen.getByRole("button", { name: ui(en, zh) }));
    expect(useMotionStore.getState()[key]).toBe(value);
    expect(stored()[0].layers).toHaveLength(0);
  });
  it.each(MOTION_PRESETS.map((preset, index) => [preset, templateNames[index]] as const))("creates template $0.id through the official store", async (preset, name) => {
    render(<MotionTemplateBrowser />);
    const translated = ui(preset.name, name);
    fireEvent.click(screen.getByRole("button", { name: ui(`Apply ${preset.name}`, `应用${translated}`) }));
    await waitFor(() => expect(stored()).toHaveLength(2));
    const created = stored().find(c => c.id !== "entry")!;
    expect(created.name).toBe(translated);
    expect(created.layers.length).toBeGreaterThan(0);
    if (locale === "zh-CN") {
      expect(created.layers[0].name).not.toBe(preset.create().layers[0].name);
      expect(created.variables[0].name).not.toBe(preset.variables[0].label);
    }
    expect(useMotionStore.getState().activeCompositionId).toBe(created.id);
    expect(MOTION_PRESETS.find(p => p.id === preset.id)?.name).toBe(preset.name);
  });
});
