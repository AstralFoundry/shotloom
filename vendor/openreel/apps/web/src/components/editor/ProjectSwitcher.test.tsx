import { configureShotloomLocale } from "../../shotloom-mode";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ProjectSwitcher } from "./ProjectSwitcher";

const mocks = vi.hoisted(() => ({
  create: vi.fn(), recover: vi.fn(async (_id: string) => {}), rename: vi.fn(async (_name: string) => {}),
  saves: vi.fn(async () => [] as { id: string; projectId: string; projectName: string; timestamp: number; slot: number; isRecovery: boolean }[]),
}));
vi.mock("../../stores/project-store", () => ({ useProjectStore: () => ({ project: { id: "project", name: "Project A" }, createNewProject: mocks.create, recoverFromAutoSave: mocks.recover, renameProject: mocks.rename }) }));
vi.mock("../../services/auto-save", () => ({ autoSaveManager: { initialize: vi.fn(async () => {}), checkForRecovery: mocks.saves } }));
vi.mock("./ProjectPackageDialog", () => ({ ProjectPackageDialog: () => { throw new Error("Failed to fetch dynamically imported module"); } }));

describe.each(["en-US", "zh-CN"] as const)("project menu (%s)", locale => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => { configureShotloomLocale(locale); mocks.saves.mockResolvedValue([]); vi.clearAllMocks(); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); configureShotloomLocale("en-US"); });
  const open = () => fireEvent.click(screen.getByRole("button", { name: "Project A" }));

  it("contains a failed backup dialog without unmounting the editor", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<><div>Editor still available</div><ProjectSwitcher /></>);
    open();
    fireEvent.click(await screen.findByRole("button", { name: ui("Project backups", "工程备份") }));
    expect(await screen.findByRole("alert")).toHaveTextContent(ui("Project backups couldn’t open", "无法打开工程备份"));
    expect(screen.getByText("Editor still available")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Project A" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ui("Dismiss", "关闭") }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps names intact when renaming, cancelling and creating a project", async () => {
    render(<ProjectSwitcher />); open();
    fireEvent.click(screen.getByRole("button", { name: ui("Rename project", "重命名工程") }));
    const input = screen.getByRole("textbox", { name: ui("Project name", "工程名称") });
    fireEvent.change(input, { target: { value: "  我的 Demo / 角色  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(mocks.rename).toHaveBeenCalledWith("我的 Demo / 角色"));
    fireEvent.click(screen.getByRole("button", { name: ui("Rename project", "重命名工程") }));
    fireEvent.change(screen.getByRole("textbox", { name: ui("Project name", "工程名称") }), { target: { value: "Discard me" } });
    fireEvent.keyDown(screen.getByRole("textbox", { name: ui("Project name", "工程名称") }), { key: "Escape" });
    expect(mocks.rename).toHaveBeenCalledTimes(1);
    open();
    fireEvent.click(screen.getByRole("button", { name: ui("New Project", "新建工程") }));
    expect(mocks.create).toHaveBeenCalledOnce();
  });

  it.each([
    [10, "just now", "刚刚"], [120, "2m ago", "2 分钟前"],
    [7200, "2h ago", "2 小时前"], [172800, "2d ago", "2 天前"],
  ])("renders relative age %s and recovers by the latest save ID", async (age, en, zh) => {
    const now = 1800000000000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    mocks.saves.mockResolvedValue([
      { id: "old-save", projectId: "other", projectName: "Old name", timestamp: now - Number(age) * 1000 - 1000, slot: 0, isRecovery: false },
      { id: "latest-save", projectId: "other", projectName: "角色 / Original Name", timestamp: now - Number(age) * 1000, slot: 1, isRecovery: false },
    ]);
    render(<ProjectSwitcher />); open();
    const recent = await screen.findByRole("button", { name: ui("Open 角色 / Original Name", "打开角色 / Original Name") });
    expect(screen.getByText(ui(String(en), String(zh)))).toBeInTheDocument();
    expect(screen.queryByText("Old name")).not.toBeInTheDocument();
    fireEvent.click(recent);
    await waitFor(() => expect(mocks.recover).toHaveBeenCalledWith("latest-save"));
  });
});
