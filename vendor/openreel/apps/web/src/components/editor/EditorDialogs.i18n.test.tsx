import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { configureShotloomLocale } from "../../shotloom-mode";
import { AspectRatioMatchDialog } from "./dialogs/AspectRatioMatchDialog";
import { ExportProgressOverlay } from "./ExportProgressOverlay";
import { KeyboardShortcutsOverlay } from "./KeyboardShortcutsOverlay";

afterEach(() => { cleanup(); configureShotloomLocale("en-US"); });

describe("embedded editor dialog language", () => {
  it.each([
    ["en-US", "Match Video Dimensions?", "Match Video", "Keep Current", "Aspect Ratio: 1.78"],
    ["zh-CN", "匹配视频尺寸？", "匹配视频", "保留当前尺寸", "宽高比：1.78"],
  ])("localizes dimension confirmation in %s and preserves both actions", (locale, title, match, keep, ratio) => {
    configureShotloomLocale(locale);
    const onConfirm = vi.fn(); const onCancel = vi.fn();
    render(<AspectRatioMatchDialog isOpen videoWidth={1920} videoHeight={1080} currentWidth={1080} currentHeight={1920} onConfirm={onConfirm} onCancel={onCancel} />);
    expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.getByText(ratio)).toBeInTheDocument();
    expect(screen.getByText("1920 x 1080")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: keep }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: match }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("localizes export phases and preserves unknown upstream details", () => {
    configureShotloomLocale("zh-CN");
    const { rerender } = render(<ExportProgressOverlay progress={125} phase="rendering..." width={400} height={250} />);
    expect(screen.getByText("正在导出视频")).toBeInTheDocument();
    expect(screen.getByText("正在渲染…")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "视频导出" })).toHaveAttribute("aria-valuenow", "100");
    const detail = "upstream detail {name} $&...";
    rerender(<ExportProgressOverlay progress={30} phase={detail} width={400} height={250} />);
    expect(screen.getByText(detail)).toBeInTheDocument();
    rerender(<ExportProgressOverlay progress={30} phase="__proto__" width={400} height={250} />);
    expect(screen.getByText("__proto__")).toBeInTheDocument();
    rerender(<ExportProgressOverlay progress={0} phase="" width={180} height={80} />);
    expect(screen.getByText("正在导出")).toBeInTheDocument();
    expect(screen.getByText("正在准备…")).toBeInTheDocument();
  });

  it("keeps the shortcut key chip inside a fully translated instruction", () => {
    configureShotloomLocale("zh-CN");
    render(<KeyboardShortcutsOverlay isOpen onClose={() => undefined} />);
    const key = screen.getByText("Esc", { selector: "kbd" });
    expect(key.parentElement?.textContent).toBe("点击快捷键可自定义；按 Esc 关闭");
  });
});
