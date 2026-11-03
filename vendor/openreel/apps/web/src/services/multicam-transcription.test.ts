import { configureShotloomLocale } from "../shotloom-mode";
import { afterEach, describe, expect, it, vi } from "vitest";
import { transcribeMulticamChannels, whisperChunksToMulticamTranscript } from "./multicam-transcription";

describe("multicam transcription", () => {
  it("normalizes Whisper timestamps and removes empty chunks", () => {
    expect(whisperChunksToMulticamTranscript([
      { text: " Hello ", timestamp: [0.25, 1.5] },
      { text: "  ", timestamp: [1.5, 2] },
      { text: "world", timestamp: [2, null] },
    ])).toEqual([
      { text: "Hello", startMs: 250, endMs: 1_500 },
      { text: "world", startMs: 2_000, endMs: 5_000 },
    ]);
  });
});

describe.each(["en-US", "zh-CN"] as const)("Multicam transcription messages (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  afterEach(() => { vi.unstubAllGlobals(); configureShotloomLocale("en-US"); });
  const buffer = { sampleRate: 16000, length: 1, duration: 1 / 16000, numberOfChannels: 1, getChannelData: () => new Float32Array([0]), copyFromChannel: () => {}, copyToChannel: () => {} } satisfies AudioBuffer;
  it("reports translated model progress and preserves transcript content", async () => {
    configureShotloomLocale(locale);
    const terminate = vi.fn();
    let request: Record<string, unknown> | undefined;
    class WorkerStub extends EventTarget {
      terminate = terminate;
      postMessage(data: Record<string, unknown>) {
        request = data;
        for (const payload of [
          { type: "model-progress", progress: 50 },
          { type: "transcription-progress" },
          { type: "result", chunks: [{ text: " Original words ", timestamp: [0, 1] }] },
        ]) this.dispatchEvent(new MessageEvent("message", { data: { requestId: data.requestId, ...payload } }));
      }
    }
    vi.stubGlobal("Worker", WorkerStub);
    const onStatus = vi.fn();
    const result = await transcribeMulticamChannels(new Map([["User camera", buffer]]), { onStatus });
    expect(onStatus.mock.calls).toEqual([
      ["User camera", ui("Loading local Whisper model…", "正在加载本地 Whisper 模型…")],
      ["User camera", ui("Loading local Whisper model · 50%", "正在加载本地 Whisper 模型 · 50%")],
      ["User camera", ui("Transcribing locally…", "正在本地转写…")],
    ]);
    expect(result["User camera"]).toEqual([{ text: "Original words", startMs: 0, endMs: 1000 }]);
    expect(request).toMatchObject({ type: "transcribe", model: "fast" });
    expect(terminate).toHaveBeenCalledOnce();
  });
  it.each([undefined, "Worker diagnostic"])("translates fallback and preserves external error (%s)", async (message) => {
    configureShotloomLocale(locale);
    const terminate = vi.fn();
    class WorkerStub extends EventTarget {
      terminate = terminate;
      postMessage(data: Record<string, unknown>) {
        this.dispatchEvent(new MessageEvent("message", { data: { requestId: data.requestId, type: "error", message } }));
      }
    }
    vi.stubGlobal("Worker", WorkerStub);
    await expect(transcribeMulticamChannels(new Map([["a", buffer]]))).rejects.toThrow(message ?? ui("Local transcription failed.", "本地转写失败。"));
    expect(terminate).toHaveBeenCalledOnce();
  });
});
