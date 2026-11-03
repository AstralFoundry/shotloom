import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadBlob } from "@openreel/core";
import { configureShotloomLocale } from "../../shotloom-mode";
import { probeCompressionSource, runCompression } from "../../services/video-compressor";
import { CompressDialog } from "./CompressDialog";

vi.mock("@openreel/core", async (importOriginal) => ({
  ...await importOriginal<typeof import("@openreel/core")>(),
  downloadBlob: vi.fn(),
}));
vi.mock("../../services/video-compressor", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../services/video-compressor")>(),
  probeCompressionSource: vi.fn(),
  runCompression: vi.fn(),
}));

function chooseFile() {
  const file = new File([new Uint8Array(1024)], "原始文件 {name}.mp4", { type: "video/mp4" });
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("Missing video picker");
  fireEvent.change(input, { target: { files: [file] } });
  return file;
}

beforeEach(() => {
  configureShotloomLocale("zh-CN");
  vi.mocked(probeCompressionSource).mockResolvedValue({ width: 1920, height: 1080, durationSec: 10, hasAudio: true, frameRate: 30 });
});
afterEach(() => {
  cleanup();
  configureShotloomLocale("en-US");
  vi.resetAllMocks();
});

describe("video compression language", () => {
  it("shows a translated read failure and keeps the picker usable", async () => {
    vi.mocked(probeCompressionSource).mockResolvedValue(null);
    render(<CompressDialog isOpen onClose={vi.fn()} />);
    chooseFile();
    expect(await screen.findByText("无法读取此视频，请尝试其他文件。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "压缩" })).toBeDisabled();
    expect(probeCompressionSource).toHaveBeenCalledOnce();
  });

  it("shows translated progress and preserves the actual source, plan and download filename", async () => {
    let finish: ((blob: Blob) => void) | undefined;
    vi.mocked(runCompression).mockImplementation(async (_file, _plan, onProgress) => {
      onProgress?.(0.45);
      return new Promise<Blob>((resolve) => { finish = resolve; });
    });
    const onClose = vi.fn();
    render(<CompressDialog isOpen onClose={onClose} />);
    const file = chooseFile();
    await screen.findByText("预计输出");
    expect(screen.getByText("均衡")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "压缩" }));
    expect(await screen.findByText("正在压缩… 45%")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "压缩进度" })).toHaveAttribute("aria-valuenow", "45");
    expect(runCompression).toHaveBeenCalledWith(file, expect.objectContaining({ width: 1280, height: 720 }), expect.any(Function), expect.any(AbortSignal));
    const blob = new Blob(["compressed"], { type: "video/mp4" });
    finish?.(blob);
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledWith(blob, "原始文件 {name}-compressed.mp4"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("lets users recover from a compression failure in the same language", async () => {
    vi.mocked(runCompression).mockRejectedValue(new Error("encoder unavailable"));
    render(<CompressDialog isOpen onClose={vi.fn()} />);
    chooseFile();
    await screen.findByText("预计输出");
    fireEvent.click(screen.getByRole("button", { name: "压缩" }));
    expect(await screen.findByText("压缩失败，请尝试较轻的压缩设置。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "压缩" })).toBeEnabled();
  });
});
