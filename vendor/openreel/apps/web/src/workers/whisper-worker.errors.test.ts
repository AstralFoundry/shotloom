import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const inference = vi.hoisted(() => ({ pipeline: vi.fn(), transcribe: vi.fn() }));
vi.mock("@huggingface/transformers", () => ({ env: {}, pipeline: inference.pipeline }));
describe("Whisper worker error envelopes", () => {
  const postMessage = vi.fn();
  const worker = { postMessage, onmessage: undefined as undefined | ((event: MessageEvent) => Promise<void>) };
  beforeEach(async () => {
    vi.resetModules(); vi.clearAllMocks();
    inference.pipeline.mockResolvedValue(inference.transcribe);
    vi.stubGlobal("self", worker);
    await import("./whisper-worker");
  });
  afterEach(() => { vi.unstubAllGlobals(); });
  it("returns a stable missing-audio code without calling inference", async () => {
    await worker.onmessage!({ data: { requestId: "original", type: "transcribe", model: "fast", audio: new Float32Array() } } as MessageEvent);
    expect(postMessage).toHaveBeenLastCalledWith({ requestId: "original", type: "error", errorCode: "NO_AUDIO", message: "The selected clip has no decodable audio." });
    expect(inference.transcribe).not.toHaveBeenCalled();
  });
  it.each([new Error("Original upstream {name}"), "unknown rejection"])("preserves upstream Error details and explicitly codes the generic fallback (%s)", async (reason) => {
    inference.pipeline.mockRejectedValueOnce(reason);
    await worker.onmessage!({ data: { requestId: "original", type: "load", model: "fast" } } as MessageEvent);
    expect(postMessage).toHaveBeenLastCalledWith({ requestId: "original", type: "error", message: reason instanceof Error ? reason.message : "Local transcription failed.", errorCode: reason instanceof Error ? undefined : "TRANSCRIPTION_FAILED" });
  });
});
