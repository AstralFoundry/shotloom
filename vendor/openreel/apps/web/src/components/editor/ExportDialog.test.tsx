import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SourceExportMatch } from "../../services/export-source-match";
import { configureShotloomLocale } from "../../shotloom-mode";
import { ExportDialog } from "./ExportDialog";
import { checkBrowserExportCapability } from "@openreel/core";

vi.mock("@openreel/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openreel/core")>();
  return {
    ...actual,
    checkBrowserExportCapability: vi.fn(() => new Promise<never>(() => undefined)),
    estimateExportTime: vi.fn(() => null),
    getCodecRecommendations: vi.fn(() => []),
    getDeviceProfile: vi.fn(() => new Promise<never>(() => undefined)),
  };
});

const SOURCE_MATCH: SourceExportMatch = {
  width: 4000,
  height: 2400,
  frameRate: 30,
  bitrate: 60_000,
  sourceName: "source-match.mp4",
};

describe("ExportDialog", () => {
  afterEach(() => {
    cleanup();
    configureShotloomLocale("en-US");
    vi.mocked(checkBrowserExportCapability).mockImplementation(() => new Promise<never>(() => undefined));
  });

  it("uses Chinese quick-export controls without changing source settings or the file name", () => {
    configureShotloomLocale("zh-CN");
    const onExport = vi.fn();
    render(<ExportDialog isOpen onClose={vi.fn()} onExport={onExport} duration={1} sourceMatch={SOURCE_MATCH} />);
    expect(screen.getByText(/source-match\.mp4/)).toBeInTheDocument();
    expect(screen.getByText("整个时间线")).toBeInTheDocument();
    expect(screen.getByText("正在检查此浏览器的编码支持…")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "快速导出" }));
    expect(onExport).toHaveBeenCalledWith(expect.objectContaining({ format: "mp4", codec: "h264", width: 4000, height: 2400, frameRate: 30, bitrate: 60_000 }), "download");
  });

  it("submits the same compression settings from English and Chinese controls", () => {
    const results: unknown[] = [];
    for (const [locale, tab, action] of [["en-US", "Smaller File", "Compress & Export"], ["zh-CN", "缩小文件", "压缩并导出"]]) {
      configureShotloomLocale(locale);
      const onExport = vi.fn();
      const { unmount } = render(<ExportDialog isOpen onClose={vi.fn()} onExport={onExport} duration={5} projectWidth={1920} projectHeight={1080} />);
      fireEvent.click(screen.getByRole("radio", { name: tab }));
      fireEvent.click(screen.getByRole("button", { name: action }));
      expect(onExport).toHaveBeenCalledOnce();
      results.push(onExport.mock.calls[0]);
      unmount();
    }
    expect(results[1]).toEqual(results[0]);
  });

  it("keeps the source-match shortcut in the presets view", () => {
    render(
      <ExportDialog
        isOpen
        onClose={vi.fn()}
        onExport={vi.fn()}
        duration={1}
        sourceMatch={SOURCE_MATCH}
      />,
    );

    expect(screen.getByTestId("quick-export-card")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Custom Settings" }));

    expect(screen.queryByTestId("quick-export-card")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Quality & encoding" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Audio" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Enhance quality" }),
    ).toBeInTheDocument();
  });

  it("exports source settings from the quick action", () => {
    const onClose = vi.fn();
    const onExport = vi.fn();

    render(
      <ExportDialog
        isOpen
        onClose={onClose}
        onExport={onExport}
        duration={1}
        sourceMatch={SOURCE_MATCH}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Quick Export" }));

    expect(onExport).toHaveBeenCalledWith(
      expect.objectContaining({
        format: "mp4",
        codec: "h264",
        width: 4000,
        height: 2400,
        frameRate: 30,
        bitrate: 60_000,
      }),
      "download",
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("defaults to the project's dimensions and frame rate with a usable export action", () => {
    const onExport = vi.fn();
    render(<ExportDialog isOpen onClose={vi.fn()} onExport={onExport} duration={5} projectWidth={1080} projectHeight={1920} frameRate={24} />);
    fireEvent.click(screen.getByRole("button", { name: "Export Video" }));
    expect(onExport).toHaveBeenCalledWith(expect.objectContaining({ width: 1080, height: 1920, frameRate: 24, format: "mp4", codec: "h264" }), "download");
  });

  it("updates custom output dimensions when switching to a different project", () => {
    const onExport = vi.fn();
    const { rerender } = render(<ExportDialog isOpen onClose={vi.fn()} onExport={onExport} duration={5} />);
    fireEvent.click(screen.getByRole("radio", { name: "Custom Settings" }));
    rerender(<ExportDialog isOpen onClose={vi.fn()} onExport={onExport} duration={5} projectWidth={1080} projectHeight={1920} frameRate={60} />);
    fireEvent.click(screen.getByRole("button", { name: "Export Video" }));
    expect(onExport).toHaveBeenCalledWith(expect.objectContaining({ width: 1080, height: 1920, frameRate: 60 }), "download");
  });

  it("prevents empty timeline exports through both normal and quick actions", () => {
    const onExport = vi.fn();
    render(<ExportDialog isOpen onClose={vi.fn()} onExport={onExport} duration={0} sourceMatch={SOURCE_MATCH} />);
    expect(screen.getByRole("button", { name: "Export Video" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Quick Export" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Add a clip");
    expect(onExport).not.toHaveBeenCalled();
  });

  it("exports the chosen In/Out section through the normal and quick actions", () => {
    const onExport = vi.fn();
    render(<ExportDialog isOpen onClose={vi.fn()} onExport={onExport} duration={6} markedRange={{ startTime: 2, endTime: 4 }} sourceMatch={SOURCE_MATCH} />);
    fireEvent.click(screen.getByRole("radio", { name: "Marked In/Out" }));
    fireEvent.click(screen.getByRole("button", { name: "Export Video" }));
    expect(onExport).toHaveBeenLastCalledWith(expect.objectContaining({ range: { startTime: 2, endTime: 4 } }), "download");
    fireEvent.click(screen.getByRole("button", { name: "Quick Export" }));
    expect(onExport).toHaveBeenLastCalledWith(expect.objectContaining({ range: { startTime: 2, endTime: 4 } }), "download");
    fireEvent.click(screen.getByRole("radio", { name: "Entire timeline" }));
    fireEvent.click(screen.getByRole("button", { name: "Export Video" }));
    expect(onExport).toHaveBeenLastCalledWith(expect.objectContaining({ range: undefined }), "download");
  });

  it("disables section export until valid In and Out points exist", () => {
    const { rerender } = render(<ExportDialog isOpen onClose={vi.fn()} onExport={vi.fn()} duration={6} />);
    expect(screen.getByRole("radio", { name: "Marked In/Out" })).toBeDisabled();
    rerender(<ExportDialog isOpen onClose={vi.fn()} onExport={vi.fn()} duration={6} markedRange={{ startTime: 2, endTime: 7 }} />);
    expect(screen.getByRole("radio", { name: "Marked In/Out" })).toBeDisabled();
  });

  it("keeps audio-only presets out of the video export flow", () => {
    render(<ExportDialog isOpen onClose={vi.fn()} onExport={vi.fn()} duration={5} />);
    expect(screen.queryByText("Audio", { selector: "button" })).not.toBeInTheDocument();
    expect(screen.queryByText("MP3 High Quality")).not.toBeInTheDocument();
  });

  it("localizes structured preflight errors and retains upstream details", async () => {
    configureShotloomLocale("zh-CN");
    const detail = "upstream {detail} $& 文件.mp4";
    vi.mocked(checkBrowserExportCapability).mockResolvedValue({ supported: false, reason: "English compatibility fallback", issue: { code: "probe-failed", detail } });
    const onExport = vi.fn();
    render(<ExportDialog isOpen onClose={vi.fn()} onExport={onExport} duration={5} />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(`无法检查浏览器的导出支持：${detail}`));
    expect(screen.getByRole("button", { name: "导出视频" })).toBeDisabled();
    expect(onExport).not.toHaveBeenCalled();
  });

  it("shows empty-timeline validation in Chinese before probing browser codecs", () => {
    configureShotloomLocale("zh-CN");
    vi.mocked(checkBrowserExportCapability).mockClear();
    render(<ExportDialog isOpen onClose={vi.fn()} onExport={vi.fn()} duration={0} />);
    expect(screen.getByRole("alert")).toHaveTextContent("请先向时间线添加片段、文字或图形，再导出。");
    expect(checkBrowserExportCapability).not.toHaveBeenCalled();
  });

  it("shows the browser's codec failure and blocks the export action", async () => {
    vi.mocked(checkBrowserExportCapability).mockResolvedValue({ supported: false, reason: "This browser cannot encode H.264. Try WebM." });
    const onExport = vi.fn();
    render(<ExportDialog isOpen onClose={vi.fn()} onExport={onExport} duration={5} />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Try WebM"));
    expect(screen.getByRole("button", { name: "Export Video" })).toBeDisabled();
    expect(onExport).not.toHaveBeenCalled();
  });

  it("recommends a small source without upscaling or suggesting native-only codecs", () => {
    render(<ExportDialog isOpen onClose={vi.fn()} onExport={vi.fn()} duration={5} projectWidth={640} projectHeight={360} frameRate={24} />);
    expect(screen.getByRole("checkbox", { name: "Project settings" })).toBeChecked();
    expect(screen.queryByRole("checkbox", { name: "YouTube 4K" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "4K ProRes HQ" })).not.toBeInTheDocument();
  });
});
