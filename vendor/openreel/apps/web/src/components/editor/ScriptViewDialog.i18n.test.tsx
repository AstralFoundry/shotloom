import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureShotloomLocale } from "../../shotloom-mode";
import { useProjectStore } from "../../stores/project-store";
import { ScriptViewDialog } from "./ScriptViewDialog";

const serializer = vi.hoisted(() => ({ exportToJsonWithMetadata: vi.fn(), validateProjectJson: vi.fn(), importFromJsonWithValidation: vi.fn() }));
vi.mock("@openreel/core", async (original) => ({ ...await original<typeof import("@openreel/core")>(), createStorageEngine: vi.fn(), createProjectSerializer: () => serializer }));

describe.each(["en-US", "zh-CN"] as const)("project JSON (%s)", locale => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => {
    configureShotloomLocale(locale);
    serializer.exportToJsonWithMetadata.mockReturnValue('{"name":"用户作品","id":"original-project"}');
    serializer.validateProjectJson.mockReturnValue({ valid: true, errors: [], warnings: ["upstream warning"], missingAssets: ["original-media"] });
  });
  afterEach(() => { cleanup(); configureShotloomLocale("en-US"); vi.restoreAllMocks(); vi.clearAllMocks(); });
  it("copies the original JSON through localized export controls", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<ScriptViewDialog isOpen onClose={vi.fn()} />);
    expect(screen.getByText(ui("Export or import project as JSON", "以 JSON 格式导出或导入工程"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ui("Copy", "复制") }));
    await screen.findByRole("button", { name: ui("Copied!", "已复制") });
    expect(writeText).toHaveBeenCalledWith('{"name":"用户作品","id":"original-project"}');
    expect(screen.getByRole("button", { name: ui("Download JSON", "下载 JSON") })).toBeInTheDocument();
  });
  it("validates uploaded JSON and imports the original project", async () => {
    const onClose = vi.fn();
    const imported = { ...useProjectStore.getState().project, mediaLibrary: { ...useProjectStore.getState().project.mediaLibrary, items: [] } };
    serializer.importFromJsonWithValidation.mockReturnValue({ project: imported });
    const loadProject = vi.spyOn(useProjectStore.getState(), "loadProject").mockImplementation(() => undefined);
    render(<ScriptViewDialog isOpen onClose={onClose} />);
    fireEvent.click(screen.getByRole("radio", { name: ui("Import", "导入") }));
    const input = document.querySelector('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [new File(['{"id":"original-project"}'], "用户工程.json", { type: "application/json" })] } });
    await screen.findByText(ui("Valid project JSON — ready to import", "工程 JSON 校验通过，可以导入"));
    expect(screen.getByText(ui("Missing Assets (1)", "缺失素材（1）"))).toBeInTheDocument();
    expect(screen.getByText("upstream warning")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ui("Import Project", "导入工程") }));
    await waitFor(() => expect(loadProject).toHaveBeenCalledWith(imported));
    expect(serializer.importFromJsonWithValidation).toHaveBeenCalledWith('{"id":"original-project"}');
    expect(onClose).toHaveBeenCalledOnce();
  });
  it("shows localized validation failures with raw upstream details and blocks import", async () => {
    serializer.validateProjectJson.mockImplementationOnce(() => { throw new Error("Invalid field original.id {name}"); });
    const onClose = vi.fn();
    render(<ScriptViewDialog isOpen onClose={onClose} />);
    fireEvent.click(screen.getByRole("radio", { name: ui("Import", "导入") }));
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [new File(['{}'], "broken.json", { type: "application/json" })] } });
    await screen.findByText(ui("Validation error: Invalid field original.id {name}", "校验失败：Invalid field original.id {name}"));
    expect(screen.getByRole("button", { name: ui("Import Project", "导入工程") })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: ui("Clear", "清除") }));
    expect(screen.queryByText(ui("Validation error: Invalid field original.id {name}", "校验失败：Invalid field original.id {name}"))).not.toBeInTheDocument();
    expect(serializer.importFromJsonWithValidation).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

});
