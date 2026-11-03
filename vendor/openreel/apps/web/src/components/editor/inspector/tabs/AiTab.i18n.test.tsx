import "../../../../test/install-local-storage-mock";
import React from "react";
import { configureShotloomLocale } from "../../../../shotloom-mode";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiTab, type AiTabProps } from "./AiTab";

vi.mock("../", () => ({ AutoReframeSection: () => null }));
vi.mock("../AutoCaptionPanel", () => ({ AutoCaptionPanel: () => null }));
vi.mock("../CaptionEditorPanel", () => ({ CaptionEditorPanel: () => null }));
vi.mock("../../panels/AutoEditPanel", () => ({ AutoEditPanel: () => null }));
vi.mock("../../panels/HighlightExtractorPanel", () => ({ HighlightExtractorPanel: () => null }));

function props(overrides: Partial<AiTabProps> = {}): AiTabProps {
  return {
    clipId: "my-clip", clipType: "video", showVideoControls: true, showAudioEffects: true, showVideoEffects: true,
    handleSRTImport: vi.fn(async () => {}), srtInputRef: React.createRef<HTMLInputElement>(),
    handleRemoveBackground: vi.fn(), handleEnhanceAudio: vi.fn(async () => {}), handleAutoColor: vi.fn(async () => {}),
    isEnhancingAudio: false, audioEnhanced: false, isApplyingSelectedClipEffect: false,
    captionWordsPerLine: 4, onCaptionWordsPerLineChange: vi.fn(), ...overrides,
  };
}

describe.each(["en-US", "zh-CN"] as const)("AI inspector (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => configureShotloomLocale(locale));
  afterEach(() => { cleanup(); configureShotloomLocale("en-US"); });
  it("localizes sections and passes the original subtitle file to import", () => {
    const value = props();
    render(<AiTab {...value} />);
    for (const [en, zh] of [["Local Auto-Captions", "本地自动字幕"], ["Editable Captions", "可编辑字幕"], ["Auto Reframe", "自动重构画幅"], ["Beat-Synced Auto-Edit", "节拍同步自动剪辑"], ["Local Highlights", "本地精彩片段"]]) {
      expect(screen.getByRole("button", { name: ui(`Expand ${en} section`, `展开${zh}区域`) })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: ui("Expand Local Auto-Captions section", "展开本地自动字幕区域") }));
    const input = screen.getByLabelText(ui("Import SRT or VTT file", "导入 SRT 或 VTT 文件"));
    const click = vi.spyOn(input, "click");
    fireEvent.click(screen.getByRole("button", { name: ui("Import SRT / VTT as Text", "将 SRT / VTT 导入为文字") }));
    expect(click).toHaveBeenCalledOnce();
    const file = new File(["1\n00:00:00,000 --> 00:00:01,000\nOriginal words"], "用户字幕.srt", { type: "text/plain" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(value.handleSRTImport).toHaveBeenCalledOnce();
    expect(vi.mocked(value.handleSRTImport).mock.calls[0][0].target.files?.[0]).toBe(file);
  });
  it("dispatches quick actions and displays disabled progress labels", () => {
    const value = props();
    const { rerender } = render(<AiTab {...value} />);
    fireEvent.click(screen.getByRole("button", { name: ui("Remove Background", "移除背景") }));
    fireEvent.click(screen.getByRole("button", { name: ui("Quick Dialogue Cleanup", "快速清理对白") }));
    fireEvent.click(screen.getByRole("button", { name: ui("Auto-Color", "自动调色") }));
    expect(value.handleRemoveBackground).toHaveBeenCalledOnce();
    expect(value.handleEnhanceAudio).toHaveBeenCalledOnce();
    expect(value.handleAutoColor).toHaveBeenCalledOnce();
    rerender(<AiTab {...value} isEnhancingAudio isApplyingSelectedClipEffect />);
    expect(screen.getByRole("button", { name: ui("Cleaning up...", "正在清理…") })).toBeDisabled();
    expect(screen.getByRole("button", { name: ui("Applying...", "正在应用…") })).toBeDisabled();
    rerender(<AiTab {...value} audioEnhanced />);
    expect(screen.getByRole("button", { name: ui("Noise Reduced", "已降噪") })).toBeEnabled();
  });
  it("keeps audio-only controls scoped to the original capability flags", () => {
    render(<AiTab {...props({ clipType: "audio", showVideoControls: false, showVideoEffects: false })} />);
    expect(screen.queryByRole("button", { name: ui("Remove Background", "移除背景") })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ui("Auto-Color", "自动调色") })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ui("Expand Auto Reframe section", "展开自动重构画幅区域") })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: ui("Quick Dialogue Cleanup", "快速清理对白") })).toBeEnabled();
  });
});
