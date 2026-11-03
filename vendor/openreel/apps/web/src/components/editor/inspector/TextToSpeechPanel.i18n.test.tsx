import "../../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { useSettingsStore } from "../../../stores/settings-store";
import { useTtsAudioStore } from "../../../stores/tts-store";
import { AudioResult } from "./AudioResult";
import { TextToSpeechPanel } from "./TextToSpeechPanel";
const api = vi.hoisted(() => ({ generate: vi.fn(async (_text: string, _voice: string, _signal?: AbortSignal) => new Blob(["audio"])), enhance: vi.fn(async (_text: string) => "优化结果 {name}"), voices: [{ voice_id: "original-voice", name: "Original Voice", category: "cloned", labels: {} }], models: [{ model_id: "original-model", name: "Original Model", languages: [] }] }));
vi.mock("./hooks/useElevenLabsApi", () => ({ useElevenLabsApi: () => ({ allVoices: api.voices, allModels: api.models, isLoadingVoices: false, isLoadingModels: false, generateWithElevenLabs: api.generate, enhanceViaLlm: api.enhance }) }));

describe.each(["en-US", "zh-CN"] as const)("speech UI (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => {
    configureShotloomLocale(locale); vi.clearAllMocks();
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    useTtsAudioStore.getState().clearAudio();
    useSettingsStore.setState({ configuredServices: ["elevenlabs"], elevenLabsModel: "original-model", favoriteModels: [], favoriteVoices: [{ voiceId: "original-voice", name: "Original Voice" }] });
  });
  afterEach(() => { cleanup(); useTtsAudioStore.getState().clearAudio(); vi.restoreAllMocks(); configureShotloomLocale("en-US"); });

  it("disables generation without the configured key and opens the key settings", () => {
    useSettingsStore.setState({ configuredServices: [] });
    const open = vi.spyOn(useSettingsStore.getState(), "openSettings");
    render(<TextToSpeechPanel />);
    expect(screen.getByRole("button", { name: ui("Generate Speech", "生成语音") })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: ui("API Key Settings", "API 密钥设置") }));
    expect(open).toHaveBeenCalledWith("api-keys");
  });

  it("preserves text and voice ID and shows translated failure with a working settings entry", async () => {
    api.generate.mockRejectedValueOnce(new Error("原始失败 {name}"));
    const open = vi.spyOn(useSettingsStore.getState(), "openSettings");
    render(<TextToSpeechPanel />);
    const text = "原始文本 {name} $&";
    fireEvent.change(screen.getByRole("textbox", { name: ui("Text", "文本") }), { target: { value: text } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: ui("Generate Speech", "生成语音") })); });
    expect(api.generate).toHaveBeenCalledWith(text, "original-voice", expect.any(AbortSignal));
    expect(screen.getByText("原始失败 {name}")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ui("Open Settings", "打开设置") }));
    expect(open).toHaveBeenCalledWith("api-keys");
  });

  it("selects models and voices through translated lists without changing IDs", () => {
    useSettingsStore.setState({ elevenLabsModel: "unselected", favoriteVoices: [] });
    render(<TextToSpeechPanel />);
    fireEvent.click(screen.getByRole("button", { name: ui("Toggle model list", "展开或收起模型列表") }));
    fireEvent.click(screen.getByRole("button", { name: ui("Add to favorites", "添加收藏") }));
    expect(useSettingsStore.getState().favoriteModels).toContainEqual({ modelId: "original-model", name: "Original Model" });
    expect(useSettingsStore.getState().elevenLabsModel).toBe("unselected");
    expect(screen.getByRole("button", { name: ui("Remove from favorites", "取消收藏") })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: ui("Select Original Model", "选择Original Model") })[1]);
    expect(useSettingsStore.getState().elevenLabsModel).toBe("original-model");
    fireEvent.click(screen.getByRole("button", { name: ui("Browse and search voices", "浏览和搜索音色") }));
    const search = screen.getByRole("textbox", { name: ui("Search voices", "搜索音色") });
    fireEvent.change(search, { target: { value: "missing" } });
    expect(screen.getByText(ui("No voices match your search", "没有与搜索匹配的音色"))).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "Original" } });
    expect(screen.getByText(ui("Cloned", "克隆音色"))).toBeInTheDocument();
    fireEvent.click(screen.getByText("Original Voice"));
    fireEvent.change(screen.getByRole("textbox", { name: ui("Text", "文本") }), { target: { value: "原文" } });
    expect(screen.getByRole("button", { name: ui("Generate Speech", "生成语音") })).not.toBeDisabled();
  });

  it("keeps the voice name and dispatches translated result actions", () => {
    const play = vi.fn(), save = vi.fn(), timeline = vi.fn(), download = vi.fn();
    render(<AudioResult generatedAudio={new Blob(["audio"])} voiceName="原音色 {name}" isPlaying={false} isGenerating={false} onTogglePlayback={play} onSaveToMedia={save} onAddToTimeline={timeline} onDownload={download} />);
    expect(screen.getByText(ui("原音色 {name} Voice", "原音色 {name}音色"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ui("Play preview", "播放试听") }));
    fireEvent.click(screen.getByRole("button", { name: ui("Save to Media", "保存到媒体库") }));
    fireEvent.click(screen.getByRole("button", { name: ui("Add to Timeline", "添加到时间线") }));
    fireEvent.click(screen.getByRole("button", { name: ui("Download", "下载") }));
    for (const callback of [play, save, timeline, download]) expect(callback).toHaveBeenCalledOnce();
  });

  it("enhances editable text and generates the edited preview with the original voice", async () => {
    api.generate.mockRejectedValueOnce("unknown failure");
    render(<TextToSpeechPanel />);
    fireEvent.change(screen.getByRole("textbox", { name: ui("Text", "文本") }), { target: { value: "原文" } });
    fireEvent.click(screen.getByRole("switch", { name: ui("Enhance for TTS", "优化语音文本") }));
    expect(screen.getByRole("button", { name: ui("Generate Speech", "生成语音") })).toBeDisabled();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: ui("Enhance Text", "优化文本") })); });
    fireEvent.change(screen.getByRole("textbox", { name: ui("Enhanced preview", "优化文本预览") }), { target: { value: "编辑结果 {name}" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: ui("Generate Speech", "生成语音") })); });
    expect(api.generate).toHaveBeenCalledWith("编辑结果 {name}", "original-voice", expect.any(AbortSignal));
    expect(screen.getByText(ui("Failed to generate speech", "语音生成失败"))).toBeInTheDocument();
  });
});
