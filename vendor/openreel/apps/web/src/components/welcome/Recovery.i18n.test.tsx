import "../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AutoSaveMetadata } from "../../services/auto-save";
import { configureShotloomLocale } from "../../shotloom-mode";
import { useProjectStore } from "../../stores/project-store";
import { RecentProjects } from "./RecentProjects";
import { RecoveryDialog } from "./RecoveryDialog";
const api = vi.hoisted(() => ({ saves: vi.fn() }));
vi.mock("../../services/auto-save", () => ({ checkForRecovery: api.saves }));
const now = new Date("2026-11-03T12:00:00Z").getTime();
const save = (id: string, seconds = 0): AutoSaveMetadata => ({ id, projectId: `project-${id}`, projectName: `User {name} ${id}`, timestamp: now - seconds * 1000, slot: 0, isRecovery: true });
const originalRecover = useProjectStore.getState().recoverFromAutoSave;
describe.each(["en-US", "zh-CN"] as const)("Project recovery text (%s)", locale => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => { configureShotloomLocale(locale); vi.clearAllMocks(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); });
  afterEach(() => { cleanup(); vi.useRealTimers(); configureShotloomLocale("en-US"); useProjectStore.setState({ recoverFromAutoSave: originalRecover }); });
  it.each([
    [0, "just now", "刚刚"], [60, "1 minute ago", "1 分钟前"], [120, "2 minutes ago", "2 分钟前"],
    [3600, "1 hour ago", "1 小时前"], [7200, "2 hours ago", "2 小时前"],
    [86400, "1 day ago", "1 天前"], [172800, "2 days ago", "2 天前"],
  ])("formats the last save %s seconds ago and recovers its original ID", (seconds, en, zh) => {
    const recover = vi.fn(), dismiss = vi.fn(), item = save("original", seconds);
    render(<RecoveryDialog saves={[item]} onRecover={recover} onDismiss={dismiss} />);
    expect(screen.getByText(ui("Recover Your Work", "恢复你的创作"))).toBeInTheDocument();
    expect(screen.getByText(ui(`Last saved ${en}`, `上次保存：${zh}`))).toBeInTheDocument();
    const date = new Date(item.timestamp).toLocaleString(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    expect(screen.getByText(date)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ui("Recover User {name} original", "恢复 User {name} original") }));
    expect(recover).toHaveBeenCalledWith("original");
    expect(screen.getByRole("button", { name: ui("Recovering...", "正在恢复…") })).toBeDisabled();
  });
  it("expands older saves, selects an exact save and dismisses without recovery", () => {
    const recover = vi.fn(), dismiss = vi.fn();
    const { rerender } = render(<RecoveryDialog saves={[save("first"), save("older", 120)]} onRecover={recover} onDismiss={dismiss} />);
    fireEvent.click(screen.getByRole("button", { name: ui("1 older save available", "还有 1 份较早的存档") }));
    fireEvent.click(screen.getByRole("button", { name: ui("Recover User {name} older", "恢复 User {name} older") }));
    expect(recover).toHaveBeenCalledWith("older");
    rerender(<RecoveryDialog saves={[save("first"), save("older"), save("third")]} onRecover={recover} onDismiss={dismiss} />);
    expect(screen.getByRole("button", { name: ui("2 older saves available", "还有 2 份较早的存档") })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ui("Start Fresh", "重新开始") }));
    expect(dismiss).toHaveBeenCalledOnce(); expect(recover).toHaveBeenCalledTimes(1);
  });
  it("waits for clearing before dismissal and disables repeat clearing", async () => {
    let finish!: () => void;
    const clear = vi.fn(() => new Promise<void>(resolve => { finish = resolve; })), dismiss = vi.fn();
    render(<RecoveryDialog saves={[save("first"), save("second")]} onRecover={vi.fn()} onDismiss={dismiss} onClearAll={clear} />);
    const button = screen.getByRole("button", { name: ui("Clear all saved projects", "清除所有工程存档") });
    fireEvent.click(button); expect(button).toBeDisabled(); expect(dismiss).not.toHaveBeenCalled();
    await act(async () => finish()); expect(clear).toHaveBeenCalledOnce(); expect(dismiss).toHaveBeenCalledOnce();
  });
  it("loads and deduplicates recent projects, uses localized dates, and opens original save IDs", async () => {
    const recent = [save("today"), save("yesterday", 86400), save("days", 3 * 86400), save("week", 8 * 86400), save("weeks", 21 * 86400), save("old", 40 * 86400)];
    api.saves.mockResolvedValue([...recent, { ...save("duplicate"), projectId: recent[0].projectId }]);
    const recover = vi.fn().mockResolvedValue(true), selected = vi.fn();
    useProjectStore.setState({ recoverFromAutoSave: recover });
    render(<RecentProjects onProjectSelected={selected} />);
    expect(screen.getByText(ui("Loading recent projects...", "正在加载最近工程…"))).toBeInTheDocument();
    expect(await screen.findByText(ui("Recent Projects (6)", "最近工程（6）"))).toBeInTheDocument();
    for (const [en, zh] of [["Today", "今天"], ["Yesterday", "昨天"], ["3 days ago", "3 天前"], ["1 week ago", "1 周前"], ["3 weeks ago", "3 周前"]]) expect(screen.getByText(ui(en, zh))).toBeInTheDocument();
    expect(screen.getByText(new Date(recent[5].timestamp).toLocaleDateString(locale))).toBeInTheDocument();
    expect(screen.queryByText("User {name} duplicate")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ui("Open User {name} today", "打开 User {name} today") }));
    await waitFor(() => expect(selected).toHaveBeenCalledOnce()); expect(recover).toHaveBeenCalledWith("today");
    fireEvent.click(screen.getAllByRole("button", { name: ui("Remove from recent", "从最近记录中移除") })[0]);
    expect(screen.queryByText("User {name} today")).not.toBeInTheDocument(); expect(recover).toHaveBeenCalledTimes(1);
    expect(recent[0].projectName).toBe("User {name} today");
  });
  it("shows localized guidance for an empty recent list", async () => {
    api.saves.mockResolvedValue([]); render(<RecentProjects />);
    expect(await screen.findByText(ui("No Recent Projects", "暂无最近工程"))).toBeInTheDocument();
    expect(screen.getByText(ui("Your recently opened projects will appear here. Start a new project or use a template to get started.", "最近打开的工程会显示在这里。新建工程或使用模板开始创作。"))).toBeInTheDocument();
  });
});
