import "../../../test/install-local-storage-mock";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUILTIN_TEMPLATES, TEMPLATE_CATEGORIES, TemplateEngine, type Template } from "@openreel/core";
import { configureShotloomLocale, editorMessage } from "../../../shotloom-mode";
import { useEngineStore } from "../../../stores/engine-store";
import { useProjectStore } from "../../../stores/project-store";
import { templateCloudService } from "../../../services/template-cloud-service";
import { TemplatesBrowserPanel } from "./TemplatesBrowserPanel";

describe.each(["en-US", "zh-CN"] as const)("template browser (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  let engine: TemplateEngine;
  let custom: Template;
  let restoreEngine: ReturnType<typeof useEngineStore.getState>["getTemplateEngine"];
  let restoreLoad: ReturnType<typeof useProjectStore.getState>["loadProject"];
  let loadProject: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    configureShotloomLocale(locale);
    custom = { ...structuredClone(BUILTIN_TEMPLATES[0]), id: "my-template", name: "My 用户模板", category: "custom", placeholders: [{ id: "original-title", type: "text", label: "原始标题", required: true }], timeline: { ...structuredClone(BUILTIN_TEMPLATES[0].timeline), tracks: [], subtitles: [] } };
    engine = new TemplateEngine();
    vi.spyOn(engine, "initialize").mockResolvedValue();
    vi.spyOn(engine, "listTemplates").mockResolvedValue([...BUILTIN_TEMPLATES, custom].map(t => ({ id: t.id, name: t.name, category: t.category, thumbnailUrl: null, placeholderCount: t.placeholders.length, duration: t.timeline.duration })));
    vi.spyOn(engine, "loadTemplate").mockImplementation(async id => id === custom.id ? custom : BUILTIN_TEMPLATES.find(t => t.id === id) ?? null);
    vi.spyOn(templateCloudService, "listTemplates").mockResolvedValue([]);
    restoreEngine = useEngineStore.getState().getTemplateEngine;
    useEngineStore.setState({ getTemplateEngine: async () => engine });
    restoreLoad = useProjectStore.getState().loadProject;
    loadProject = vi.fn();
    useProjectStore.setState({ loadProject });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); configureShotloomLocale("en-US"); useEngineStore.setState({ getTemplateEngine: restoreEngine }); useProjectStore.setState({ loadProject: restoreLoad }); });

  it("localizes all categories and bundled names while preserving user template names", async () => {
    render(<TemplatesBrowserPanel />);
    expect(screen.getByRole("status", { name: ui("Loading templates", "正在加载模板") })).toBeInTheDocument();
    await screen.findByText(custom.name);
    for (const template of BUILTIN_TEMPLATES) {
      const key = `editor.templateBrowser.name.${template.id}` as Parameters<typeof editorMessage>[0];
      expect(screen.getAllByText(editorMessage(key)).some(node => node.closest(".cursor-pointer") !== null)).toBe(true);
    }
    for (const category of TEMPLATE_CATEGORIES) {
      fireEvent.click(screen.getByRole("checkbox", { name: editorMessage(`editor.saveTemplate.category.${category.id}`) }));
      expect(screen.queryByText(custom.name) !== null).toBe(category.id === "custom");
    }
    fireEvent.click(screen.getByRole("checkbox", { name: ui("All", "全部") }));
    expect(screen.getByText(custom.name)).toBeInTheDocument();
    expect(loadProject).not.toHaveBeenCalled();
  });

  it("preserves renamed bundled templates and unknown custom names", async () => {
    const original = BUILTIN_TEMPLATES[0];
    vi.mocked(engine.listTemplates).mockResolvedValue([{ id: original.id, name: "用户改名 Original", category: original.category, thumbnailUrl: null, placeholderCount: 0, duration: 5 }, { id: "builtin-user-created", name: "自建 Custom", category: "custom", thumbnailUrl: null, placeholderCount: 0, duration: 5 }]);
    render(<TemplatesBrowserPanel />);
    expect(await screen.findByText("用户改名 Original")).toBeInTheDocument();
    expect(screen.getByText("自建 Custom")).toBeInTheDocument();
  });

  it("passes original template IDs and replacement text through the real template engine", async () => {
    const applied = vi.fn();
    const apply = vi.spyOn(engine, "applyTemplate");
    render(<TemplatesBrowserPanel onTemplateApplied={applied} />);
    fireEvent.click(await screen.findByText(custom.name));
    const text = await screen.findByRole("textbox", { name: "原始标题" });
    expect(screen.getByText(ui("Configure template variables", "配置模板变量"))).toBeInTheDocument();
    fireEvent.change(text, { target: { value: "Exact 原文" } });
    fireEvent.click(screen.getByRole("button", { name: ui("Apply Template", "应用模板") }));
    await waitFor(() => expect(applied).toHaveBeenCalledOnce());
    expect(engine.loadTemplate).toHaveBeenCalledWith(custom.id);
    expect(apply).toHaveBeenCalledWith(custom, { "original-title": { type: "text", value: "Exact 原文" } });
    expect(loadProject.mock.calls[0][0]).toMatchObject({ name: `${custom.name} - Copy`, settings: custom.settings });
  });

  it("shows localized missing-template and fallback failures while retaining upstream errors", async () => {
    vi.spyOn(engine, "loadTemplate").mockResolvedValue(null);
    render(<TemplatesBrowserPanel />);
    fireEvent.click(await screen.findByText(custom.name));
    fireEvent.click(await screen.findByRole("button", { name: ui("Use This Template", "使用此模板") }));
    await screen.findByText(ui("Template not found", "未找到模板"));
    vi.mocked(engine.loadTemplate).mockResolvedValue({ ...custom, placeholders: [] });
    vi.spyOn(engine, "applyTemplate").mockImplementation(() => { throw new Error("template: 我的文件.json"); });
    fireEvent.click(screen.getByRole("button", { name: ui("Use This Template", "使用此模板") }));
    await screen.findByText("template: 我的文件.json");
    vi.mocked(engine.applyTemplate).mockImplementation(() => { throw null; });
    fireEvent.click(screen.getByRole("button", { name: ui("Use This Template", "使用此模板") }));
    await screen.findByText(ui("Failed to apply template", "应用模板失败"));
    expect(loadProject).not.toHaveBeenCalled();
  });
});
