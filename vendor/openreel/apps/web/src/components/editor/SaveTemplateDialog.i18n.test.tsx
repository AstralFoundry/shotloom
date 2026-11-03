import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureShotloomLocale } from "../../shotloom-mode";
import { SaveTemplateDialog } from "./SaveTemplateDialog";

const engine = vi.hoisted(() => ({ initialize: vi.fn(), createFromProject: vi.fn(), saveTemplate: vi.fn() }));
const upload = vi.hoisted(() => vi.fn());
vi.mock("../../stores/engine-store", () => ({ useEngineStore: (select: (state: unknown) => unknown) => select({ getTemplateEngine: async () => engine, getGraphicsEngine: () => null }) }));
vi.mock("../../services/template-cloud-service", () => ({ templateCloudService: { uploadTemplate: upload } }));

describe.each(["en-US", "zh-CN"] as const)("template save form (%s)", locale => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => {
    configureShotloomLocale(locale);
    engine.initialize.mockResolvedValue(undefined);
    engine.saveTemplate.mockResolvedValue(undefined);
    engine.createFromProject.mockImplementation((_project, options) => ({ id: "original-template", timeline: {}, ...options }));
  });
  afterEach(() => { cleanup(); configureShotloomLocale("en-US"); vi.clearAllMocks(); });
  function fillForm() {
    fireEvent.change(screen.getByRole("textbox", { name: ui("Template Name", "模板名称") }), { target: { value: "用户模板" } });
    fireEvent.change(screen.getByRole("textbox", { name: ui("Description", "说明") }), { target: { value: "用户说明" } });
    fireEvent.change(screen.getByRole("textbox", { name: ui("Tags (comma-separated)", "标签（以英文逗号分隔）") }), { target: { value: "原标签, another" } });
    fireEvent.change(screen.getByRole("textbox", { name: ui("Author Name", "作者名称") }), { target: { value: "用户作者" } });
  }
  it("saves original authored metadata locally through translated form controls", async () => {
    render(<SaveTemplateDialog isOpen onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: ui("Save Template", "保存模板") })).toBeDisabled();
    fillForm();
    fireEvent.click(screen.getByRole("checkbox", { name: ui("Local", "本地") }));
    expect(screen.getByText(ui("Saved locally in your browser storage", "保存在当前浏览器的本地存储中"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ui("Save Template", "保存模板") }));
    await screen.findByText(ui("Template saved successfully!", "模板保存成功！"));
    expect(engine.createFromProject).toHaveBeenCalledWith(expect.anything(), { name: "用户模板", description: "用户说明", tags: ["原标签", "another"], category: "custom", placeholders: [] });
    expect(engine.saveTemplate).toHaveBeenCalledWith(expect.objectContaining({ id: "original-template", author: "用户作者" }));
    expect(upload).not.toHaveBeenCalled();
  });
  it("shows a translated cloud failure fallback without claiming success", async () => {
    upload.mockResolvedValue({ success: false });
    render(<SaveTemplateDialog isOpen onClose={vi.fn()} />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: ui("Save Template", "保存模板") }));
    await waitFor(() => expect(screen.getByText(ui("Failed to upload to cloud", "上传到云端失败"))).toBeInTheDocument());
    expect(screen.queryByText(ui("Template saved successfully!", "模板保存成功！"))).not.toBeInTheDocument();
    expect(engine.saveTemplate).not.toHaveBeenCalled();
  });
});
