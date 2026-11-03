import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MotionComposition } from "@openreel/core";
import { configureShotloomLocale } from "../../shotloom-mode";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useMotionStore } from "../stores/motion-store";
import { MotionToolRail } from "./MotionToolRail";
const comp: MotionComposition = { id: "rail", name: "User {name}", width: 1280, height: 720, frameRate: 30, duration: 5, backgroundColor: "#000000", layers: [], assets: [], variables: [], markers: [], createdAt: 1, modifiedAt: 1 };
const toolCases = [["select", "Selection", "选择", "V"], ["hand", "Hand", "抓手", "H"], ["zoom", "Zoom", "缩放", "Z"], ["move", "Move", "移动", ""], ["rotate", "Rotate", "旋转", ""], ["anchor", "Anchor Point", "锚点", ""], ["rectangle", "Rectangle", "矩形", "Q"], ["ellipse", "Ellipse", "椭圆", ""], ["pen", "Pen", "钢笔", "G"], ["text", "Type", "文字", "⌘T"], ["character", "Character", "字符", ""]] as const;
const addCases = [["text", "Text layer", "文字图层"], ["shape", "Shape layer", "形状图层"], ["scene3d", "3D scene", "三维场景"], ["particle", "Particle layer", "粒子图层"], ["adjustment", "Adjustment layer", "调整图层"], ["group", "Group layer", "分组图层"], ["null", "Null controller", "空对象控制器"]] as const;
describe.each(["en-US", "zh-CN"] as const)("MotionToolRail (%s)", locale => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => {
    configureShotloomLocale(locale);
    useProjectStore.setState({ hasOpenProject: true, project: { ...createEmptyProject("Rail"), motionCompositions: [comp] } });
    useMotionStore.setState({ activeCompositionId: "rail", activeTool: "select", selectedLayerId: null, selectedLayerIds: [], rightTab: "graph" });
  });
  afterEach(() => { cleanup(); configureShotloomLocale("en-US"); useProjectStore.setState({ hasOpenProject: false }); });
  it("shows translated tooltips and switches all tools without translating their IDs", () => {
    render(<MotionToolRail />);
    expect(screen.getByRole("navigation", { name: ui("Motion tools", "动效工具") })).toBeInTheDocument();
    for (const [id, en, zh, shortcut] of toolCases) {
      const label = shortcut ? ui(`${en} (${shortcut})`, `${zh}（${shortcut}）`) : ui(en, zh);
      const button = screen.getByRole("button", { name: label });
      fireEvent.click(button);
      expect(useMotionStore.getState().activeTool).toBe(id);
      expect(button).toHaveAttribute("aria-pressed", "true");
    }
    expect(useMotionStore.getState().rightTab).toBe("properties");
  });
  it.each(addCases)("creates the %s layer from the translated menu", async (type, en, zh) => {
    render(<MotionToolRail />);
    fireEvent.click(screen.getByRole("button", { name: ui("Add layer", "添加图层") }));
    fireEvent.click(screen.getByRole("button", { name: ui(en, zh) }));
    await waitFor(() => expect(useProjectStore.getState().project.motionCompositions![0].layers).toHaveLength(1));
    const layer = useProjectStore.getState().project.motionCompositions![0].layers[0];
    expect(layer.type).toBe(type);
    expect(useMotionStore.getState().selectedLayerId).toBe(layer.id);
    expect(screen.queryByRole("button", { name: ui(en, zh) })).not.toBeInTheDocument();
    expect(useProjectStore.getState().project.motionCompositions![0].name).toBe("User {name}");
  });
});
