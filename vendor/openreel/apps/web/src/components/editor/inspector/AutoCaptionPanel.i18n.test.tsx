import "../../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SUBTITLE_STYLE_PRESETS, type Clip } from "@openreel/core";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { useProjectStore } from "../../../stores/project-store";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { AutoCaptionPanel } from "./AutoCaptionPanel";
const audio = vi.hoisted(() => ({ samples: new Float32Array([0.1, 0.2]), load: vi.fn(async () => ({ duration: 5 })), convert: vi.fn() }));
vi.mock("../../../utils/load-audio-buffer", () => ({ loadAudioBuffer: audio.load }));
vi.mock("../../../utils/whisper-audio", () => ({ audioBufferToWhisperSamples: audio.convert }));
class CaptionWorker {
  static current: CaptionWorker;
  listeners = new Set<(event: MessageEvent) => void>();
  messages: Record<string, unknown>[] = [];
  terminate = vi.fn();
  constructor() { CaptionWorker.current = this; }
  addEventListener(_name: string, listener: (event: MessageEvent) => void) { this.listeners.add(listener); }
  removeEventListener(_name: string, listener: (event: MessageEvent) => void) { this.listeners.delete(listener); }
  postMessage(message: Record<string, unknown>) { this.messages.push(message); }
  emit(data: Record<string, unknown>) {
    for (const listener of [...this.listeners]) listener({ data: { requestId: this.messages.at(-1)?.requestId, ...data } } as MessageEvent);
  }
}
describe.each(["en-US", "zh-CN"] as const)("local auto captions (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => {
    configureShotloomLocale(locale); vi.clearAllMocks();
    vi.stubGlobal("Worker", CaptionWorker);
    audio.convert.mockReturnValue(audio.samples);
    const project = createEmptyProject("Original project");
    const clip: Clip = { id: "clip", mediaId: "media", trackId: "track", startTime: 10, inPoint: 1, outPoint: 5, duration: 2, speed: 2, effects: [], audioEffects: [], keyframes: [], volume: 1, transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, anchor: { x: 0.5, y: 0.5 } } };
    useProjectStore.setState({ hasOpenProject: true, project: { ...project, mediaLibrary: { ...project.mediaLibrary, items: [{ id: "media", name: "Original media", type: "audio", blob: new Blob(["audio"]), fileHandle: null, waveformData: null, thumbnailUrl: null, metadata: { duration: 5, width: 0, height: 0, frameRate: 0, codec: "pcm", sampleRate: 16000, channels: 1, fileSize: 5 } }] }, timeline: { ...project.timeline, tracks: [{ id: "track", name: "Original track", type: "audio", clips: [clip], transitions: [], muted: false, solo: false, locked: false, hidden: false }] } } });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); configureShotloomLocale("en-US"); });
  it("uses translated choices with original model/language IDs and download progress", async () => {
    render(<AutoCaptionPanel clipId="clip" />);
    fireEvent.change(screen.getByRole("combobox", { name: ui("Local caption model", "本地字幕模型") }), { target: { value: "fast" } });
    fireEvent.change(screen.getByRole("combobox", { name: ui("Caption language", "字幕语言") }), { target: { value: "zh" } });
    expect(screen.getByRole("option", { name: ui("Chinese", "中文") })).toHaveValue("zh");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: ui("Download Whisper Tiny", "下载 Whisper Tiny") })); });
    expect(CaptionWorker.current.messages.at(-1)).toMatchObject({ type: "load", model: "fast", language: "zh" });
    act(() => CaptionWorker.current.emit({ type: "model-progress", file: "model/original-{name}.onnx", progress: 30 }));
    expect(screen.getByText(ui("Downloading original-{name}.onnx…", "正在下载 original-{name}.onnx…"))).toBeInTheDocument();
    await act(async () => CaptionWorker.current.emit({ type: "ready", backend: "wasm" }));
    expect(screen.getByText(ui("Downloaded and cached · CPU", "已下载并缓存 · CPU"))).toBeInTheDocument();
  });
  it("transcribes original audio and forwards untouched text, timing, style and provenance", async () => {
    const add = vi.spyOn(useProjectStore.getState(), "addSubtitle").mockResolvedValue();
    render(<AutoCaptionPanel clipId="clip" />);
    fireEvent.change(screen.getByRole("combobox", { name: ui("Caption style", "字幕样式") }), { target: { value: "cinematic" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: ui("Transcribe Selected Clip", "转写所选片段") })); });
    await waitFor(() => expect(CaptionWorker.current.messages).toHaveLength(1));
    expect(CaptionWorker.current.messages[0]).toMatchObject({ type: "transcribe", audio: audio.samples, language: "en", model: "accurate" });
    expect(audio.convert).toHaveBeenCalledWith(expect.objectContaining({ duration: 5 }), 1, 5);
    await act(async () => CaptionWorker.current.emit({ type: "result", text: "原文{name}", chunks: [{ text: "原文{name}", timestamp: [0, 2] }] }));
    expect(screen.getByText("原文{name}")).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: ui("Add 1 as Editable Text", "将 1 条结果添加为可编辑文字") })); });
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ text: "原文{name}", startTime: 10, endTime: 11, style: SUBTITLE_STYLE_PRESETS.cinematic }), expect.objectContaining({ captionSource: "whisper", captionSourceClipId: "clip", captionWhisperModel: "accurate" }));
  });
  it("translates explicit worker error codes and preserves upstream details", async () => {
    render(<AutoCaptionPanel clipId="clip" />);
    for (const [event, expected] of [
      [{ errorCode: "NO_AUDIO", message: "The selected clip has no decodable audio." }, ui("The selected clip has no decodable audio.", "所选片段没有可解码的音频。")],
      [{ message: "Original runtime {name}" }, "Original runtime {name}"],
    ] as const) {
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: ui("Download Large V3 Turbo", "下载 Large V3 Turbo") })); });
      await act(async () => CaptionWorker.current.emit({ type: "error", ...event }));
      expect(screen.getByText(expected)).toBeInTheDocument();
    }
  });
});
