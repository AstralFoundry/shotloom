import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureShotloomLocale } from "../../shotloom-mode";
import { useTtsAudioStore } from "../../stores/tts-store";
import { toast } from "../../stores/notification-store";
import { AIGenTab } from "./AIGenTab";

vi.mock("./inspector/AutoCaptionPanel", () => ({ AutoCaptionPanel: () => <div data-testid="captions-panel" /> }));
vi.mock("./inspector/TextToSpeechPanel", () => ({ TextToSpeechPanel: () => <div data-testid="tts-panel" /> }));
vi.mock("./inspector/FilterPresetsPanel", () => ({ FilterPresetsPanel: () => <div data-testid="filters-panel" /> }));
vi.mock("./inspector/MusicLibraryPanel", () => ({ MusicLibraryPanel: () => <div data-testid="music-panel" /> }));
vi.mock("./inspector/TemplatesBrowserPanel", () => ({ TemplatesBrowserPanel: () => <div data-testid="templates-panel" /> }));
vi.mock("./inspector/MultiCameraPanel", () => ({ MultiCameraPanel: () => <div data-testid="multicam-panel" /> }));

describe.each(["en-US", "zh-CN"] as const)("AI tool navigation (%s)", locale => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => { configureShotloomLocale(locale); useTtsAudioStore.setState({ generatedAudio: null, isAudioSaved: false, audioUrl: null }); });
  afterEach(() => { cleanup(); configureShotloomLocale("en-US"); useTtsAudioStore.setState({ generatedAudio: null, isAudioSaved: false, audioUrl: null }); vi.restoreAllMocks(); });
  it("opens all original feature panels through translated cards and returns", () => {
    render(<AIGenTab />);
    expect(screen.getByText(ui("Automate your editing with intelligent features", "用智能功能辅助完成剪辑"))).toBeInTheDocument();
    for (const [en, zh, id] of [["Text to Speech", "文字转语音", "tts"], ["Auto Captions", "自动字幕", "captions"], ["Project Templates", "工程模板", "templates"], ["Filter Presets", "滤镜预设", "filters"], ["Music & Sound Effects", "音乐与音效", "music"], ["Multi-Camera Editing", "多机位剪辑", "multicam"]]) {
      fireEvent.click(screen.getByRole("button", { name: ui(en, zh) }));
      expect(screen.getByTestId(`${id}-panel`)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: ui("Back to AI Tools", "返回 AI 工具") }));
    }
  });
  it("translates the unsaved audio warning when leaving the voice panel", () => {
    const warning = vi.spyOn(toast, "warning");
    useTtsAudioStore.setState({ generatedAudio: new Blob(["original audio"]), isAudioSaved: false });
    render(<AIGenTab />);
    fireEvent.click(screen.getByRole("button", { name: ui("Text to Speech", "文字转语音") }));
    fireEvent.click(screen.getByRole("button", { name: ui("Back to AI Tools", "返回 AI 工具") }));
    expect(warning).toHaveBeenCalledWith(ui("Unsaved audio discarded", "未保存的音频已丢弃"), ui("Save to media or download next time to keep it.", "下次请保存到素材库或下载，以保留音频。"));
  });
});
