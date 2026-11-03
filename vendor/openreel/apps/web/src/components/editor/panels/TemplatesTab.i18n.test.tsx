import "../../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUILTIN_TEMPLATES, TEMPLATE_CATEGORIES, type TemplateEngine, type TemplateSummary } from "@openreel/core";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { useEngineStore } from "../../../stores/engine-store";
import { useProjectStore } from "../../../stores/project-store";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { TemplatesTab, templateCategoryLabel, templateDisplayName } from "./TemplatesTab";

const categoriesZh = ["社交媒体", "YouTube", "TikTok", "Instagram", "商务", "个人", "幻灯片", "片头 / 片尾", "下三分之一字幕", "动效", "自定义"];
const namesZh = ["YouTube 片头", "TikTok 宣传片", "下三分之一字幕", "照片幻灯片", "Instagram 短片", "YouTube 短片", "金句卡片", "产品宣传片", "活动倒计时"];
const summary = (id: string, name: string, category: TemplateSummary["category"], duration = 8): TemplateSummary => ({ id, name, category, duration, placeholderCount: 0, thumbnailUrl: null });
const originalGetEngine = useEngineStore.getState().getTemplateEngine;

describe.each(["en-US", "zh-CN"] as const)("Template selection (%s)", locale => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  const engine = { initialize: vi.fn(), listTemplates: vi.fn(), loadTemplate: vi.fn(), applyTemplate: vi.fn() };
  const builtin = summary(BUILTIN_TEMPLATES[0].id, BUILTIN_TEMPLATES[0].name, "youtube");
  const custom = summary("mine", "My {seconds} template", "business", 75);
  beforeEach(() => {
    vi.clearAllMocks(); configureShotloomLocale(locale);
    engine.initialize.mockResolvedValue(undefined);
    engine.listTemplates.mockResolvedValue([builtin, custom]);
    useEngineStore.setState({ getTemplateEngine: async () => engine as unknown as TemplateEngine });
    useProjectStore.setState({ project: createEmptyProject("Original"), hasOpenProject: true });
  });
  afterEach(() => {
    cleanup(); vi.restoreAllMocks(); configureShotloomLocale("en-US");
    useEngineStore.setState({ getTemplateEngine: originalGetEngine });
    useProjectStore.setState({ project: createEmptyProject("Reset"), hasOpenProject: false });
  });
  it("localizes every built-in category/name and preserves authored values", () => {
    TEMPLATE_CATEGORIES.forEach((category, index) => expect(templateCategoryLabel(category.id)).toBe(ui(category.name, categoriesZh[index])));
    expect(templateCategoryLabel("user-category")).toBe("user-category");
    BUILTIN_TEMPLATES.forEach((template, index) => {
      expect(templateDisplayName(summary(template.id, template.name, template.category))).toBe(ui(template.name, namesZh[index]));
      expect(templateDisplayName(summary(template.id, "Renamed {id}", template.category))).toBe("Renamed {id}");
    });
    expect(templateDisplayName(summary("user-id", builtin.name, "custom"))).toBe(builtin.name);
  });
  it("waits for initialization and searches both translated and original names", async () => {
    let finish!: () => void;
    engine.initialize.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    render(<TemplatesTab />);
    expect(screen.getByText(ui("Loading templates...", "正在加载模板…"))).toBeInTheDocument();
    await act(async () => { await Promise.resolve(); finish(); });
    expect(await screen.findByRole("button", { name: "My {seconds} template" })).toBeEnabled();
    expect(screen.getByText("1:15")).toBeInTheDocument();
    expect(screen.getByText(ui("8s", "8秒"))).toBeInTheDocument();
    const input = screen.getByRole("textbox", { name: ui("Search templates", "搜索模板") });
    expect(input).toHaveAttribute("placeholder", ui("Search templates...", "搜索模板…"));
    fireEvent.click(screen.getByRole("checkbox", { name: ui("Business", "商务") }));
    expect(screen.queryByRole("button", { name: ui("YouTube Intro", "YouTube 片头") })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: ui("All", "全部") }));
    for (const query of [ui("Intro", "片头"), "YouTube Intro"]) {
      fireEvent.change(input, { target: { value: query } });
      expect(screen.getByRole("button", { name: ui("YouTube Intro", "YouTube 片头") })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: custom.name })).not.toBeInTheDocument();
    }
    fireEvent.change(input, { target: { value: "missing-query" } });
    expect(screen.getByText(ui("No templates found", "未找到模板"))).toBeInTheDocument();
  });
  it("confirms replacement and applies the original template ID only after consent", async () => {
    const project = createEmptyProject("Existing");
    useProjectStore.setState({ project: { ...project, timeline: { ...project.timeline, tracks: [{
      id: "track", name: "Original track", type: "video", locked: false, hidden: false, muted: false, solo: false, clips: [], transitions: [],
    }] } } });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    let finish!: (template: typeof BUILTIN_TEMPLATES[number]) => void;
    engine.loadTemplate.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const applied = createEmptyProject("Engine result");
    engine.applyTemplate.mockReturnValue({ project: applied });
    render(<TemplatesTab />);
    const button = await screen.findByRole("button", { name: ui("YouTube Intro", "YouTube 片头") });
    fireEvent.click(button);
    expect(confirm).toHaveBeenCalledWith(ui("Applying a template will replace your current project. Continue?", "应用模板将替换当前工程。是否继续？"));
    expect(engine.loadTemplate).not.toHaveBeenCalled();
    expect(useProjectStore.getState().project.name).toBe("Existing");
    confirm.mockReturnValue(true);
    fireEvent.click(button);
    expect(await screen.findByText(ui("Applying...", "正在应用…"))).toBeInTheDocument();
    expect(button).toBeDisabled();
    expect(engine.loadTemplate).toHaveBeenCalledWith(builtin.id);
    await act(async () => finish(BUILTIN_TEMPLATES[0]));
    expect(engine.applyTemplate).toHaveBeenCalledWith(BUILTIN_TEMPLATES[0], {});
    expect(useProjectStore.getState().project.name).toBe("Engine result");
    expect(button).toBeEnabled();
  });
});
