import "../../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FILTER_PRESETS, type Clip } from "@openreel/core";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { useProjectStore } from "../../../stores/project-store";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useNotificationStore } from "../../../stores/notification-store";
import { FilterPresetsPanel } from "./FilterPresetsPanel";
const groups = [
  ["Cinematic", "电影", ["青橙色调", "黑色电影", "大片质感", "漂白旁路", "日拍夜景"]],
  ["Vintage", "复古", ["70 年代复古", "拍立得", "VHS", "棕褐色", "褪色胶片", "超 8 毫米胶片"]],
  ["Mood", "氛围", ["梦幻", "暗调", "黄金时刻", "冷蓝色", "日落", "冬日寒意", "戏剧感"]],
  ["Color", "色彩", ["鲜艳", "低饱和", "经典黑白", "高对比黑白", "亮彩", "粉彩"]],
  ["Stylized", "风格化", ["赛博朋克", "漫画", "柔光", "梦境", "清晰 HDR", "黑客帝国"]],
] as const;
describe.each(["en-US", "zh-CN"] as const)("filter presets (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => {
    configureShotloomLocale(locale); useNotificationStore.getState().clearAll();
    const project = createEmptyProject("Original project");
    const clip: Clip = { id: "clip", mediaId: "media", trackId: "track", startTime: 0, inPoint: 0, outPoint: 5, duration: 5, effects: [], audioEffects: [], keyframes: [], volume: 1, transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, anchor: { x: 0.5, y: 0.5 } } };
    useProjectStore.setState({ hasOpenProject: true, project: { ...project, timeline: { ...project.timeline, tracks: [{ id: "track", name: "Original track", type: "video", clips: [clip], transitions: [], muted: false, solo: false, locked: false, hidden: false }] } } });
  });
  afterEach(() => { cleanup(); configureShotloomLocale("en-US"); });
  it("shows all 30 presets through localized categories without mutating the source catalog", () => {
    const original = structuredClone(FILTER_PRESETS);
    render(<FilterPresetsPanel clipId="clip" />);
    let total = 0;
    for (const [categoryIndex, [en, zh, names]] of groups.entries()) {
      fireEvent.click(screen.getByRole("button", { name: ui(en, zh) }));
      const presets = FILTER_PRESETS.filter((preset) => preset.category === ["cinematic", "vintage", "mood", "color", "stylized"][categoryIndex]);
      expect(presets.length).toBe(names.length);
      presets.forEach((preset, index) => expect(screen.getByRole("button", { name: ui(`Apply ${preset.name} filter preset`, `应用${names[index]}滤镜预设`) })).toBeInTheDocument());
      total += presets.length;
    }
    expect(total).toBe(30);
    expect(FILTER_PRESETS).toEqual(original);
  });
  it("applies original effect types and parameters and clears actual clip effects", async () => {
    render(<FilterPresetsPanel clipId="clip" />);
    expect(screen.getByText(ui("Classic Hollywood color grade", "经典好莱坞调色"))).toBeInTheDocument();
    expect(screen.getAllByText(ui("Contrast", "对比度")).length).toBeGreaterThan(0);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: ui("Apply Teal & Orange filter preset", "应用青橙色调滤镜预设") })); });
    await waitFor(() => expect(useProjectStore.getState().getVideoEffects("clip")).toHaveLength(3));
    expect(useNotificationStore.getState().notifications.at(-1)).toMatchObject({ title: ui("Filter Applied", "已应用滤镜"), message: ui("Teal & Orange preset applied", "已应用青橙色调预设") });
    expect(useProjectStore.getState().getVideoEffects("clip").map(({ type, params }) => ({ type, params }))).toEqual(FILTER_PRESETS[0].effects);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: ui("Remove All Effects", "移除全部效果") })); });
    expect(useProjectStore.getState().getVideoEffects("clip")).toHaveLength(0);
  });
});
