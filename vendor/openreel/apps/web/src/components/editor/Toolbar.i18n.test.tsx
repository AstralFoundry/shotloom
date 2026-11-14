import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureShotloomLocale } from "../../shotloom-mode";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import { Toolbar } from "./Toolbar";
const runner = vi.hoisted(() => ({
  state: { isExporting: false, progress: 0, phase: "", error: null, complete: false },
  runExport: vi.fn(), runAudioExport: vi.fn(), showSavePicker: vi.fn(), markComplete: vi.fn(),
  beginExport: vi.fn(), finishExportSoon: vi.fn(), failExport: vi.fn(), cancel: vi.fn(), resetError: vi.fn(),
}));
vi.mock("../../services/export-runner", () => ({ useExportRunner: () => runner, extForFormat: (s: string) => s, exportFilename: (name: string, ext: string) => `${name}.${ext}` }));
vi.mock("@openreel/core", async (original) => ({ ...await original<typeof import("@openreel/core")>(), getDeviceProfile: vi.fn().mockResolvedValue({}), estimateExportTime: vi.fn().mockReturnValue({ seconds: 65, formatted: "upstream English time", confidence: "estimated" }) }));
vi.mock("./ExportDialog", () => ({ ExportDialog: () => null }));
vi.mock("./CompressDialog", () => ({ CompressDialog: () => null }));
vi.mock("./ScreenRecorder", () => ({ ScreenRecorder: () => null }));
vi.mock("./ProjectSwitcher", () => ({ ProjectSwitcher: () => null }));
vi.mock("./settings/SettingsDialog", () => ({ SettingsDialog: () => null }));
vi.mock("./inspector/HistoryPanel", () => ({ HistoryPanel: () => null }));
const originalProject = useProjectStore.getState().project;
const originalRename = useProjectStore.getState().renameProject;

describe.each(["en-US", "zh-CN"] as const)("toolbar (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => {
    configureShotloomLocale(locale);
    vi.clearAllMocks();
    useProjectStore.setState({ project: { ...originalProject, name: "My original project", timeline: { ...originalProject.timeline, duration: 5 } }, renameProject: vi.fn() });

    useUIStore.getState().closeModal();
  });
  afterEach(() => { cleanup(); configureShotloomLocale("en-US"); useProjectStore.setState({ project: originalProject, renameProject: originalRename }); useUIStore.getState().closeModal();  });
  it("commits a user project name without translation", () => {
    render(<Toolbar />);
    const name = screen.getByLabelText(ui("Project name", "工程名称"));
    fireEvent.change(name, { target: { value: "用户自己的工程 title" } });
    fireEvent.blur(name);
    expect(useProjectStore.getState().renameProject).toHaveBeenCalledWith("用户自己的工程 title");
    fireEvent.click(screen.getByRole("button", { name: ui("Export", "导出") }));
    expect(useUIStore.getState().activeModal).toBe("export");
  });
  it("shows localized export estimates and passes the original selected preset", async () => {
    render(<Toolbar />);
    fireEvent.keyDown(screen.getByRole("button", { name: ui("Export options", "导出选项") }), { key: "ArrowDown" });
    await waitFor(() => expect(screen.getAllByText(locale === "zh-CN" ? /预计 1分钟 5秒/ : /Est\. 1 min 5 sec/).length).toBeGreaterThan(0));
    expect(screen.queryByText(/upstream English time/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(ui("1080p High Quality", "1080p 高画质")));
    await waitFor(() => expect(runner.runExport).toHaveBeenCalledWith(expect.objectContaining({ width: 1920, height: 1080, frameRate: 30, format: "mp4", codec: "h264", bitrate: 20000 }), "mp4", undefined));
  });
});
