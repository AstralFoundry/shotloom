import { afterEach, describe, expect, it, vi } from "vitest";
import { ExportFrameDecoder, MediaBunnyEngine } from "./mediabunny-engine";
afterEach(() => vi.restoreAllMocks());
function fixture() {
  const initialize = vi.spyOn(ExportFrameDecoder.prototype, "initialize").mockResolvedValue(true);
  const getFrame = vi.spyOn(ExportFrameDecoder.prototype, "getFrame").mockResolvedValue({ width: 640, height: 360 } as OffscreenCanvas);
  const dispose = vi.spyOn(ExportFrameDecoder.prototype, "dispose").mockImplementation(() => {});
  const engine = new MediaBunnyEngine();
  Object.assign(engine, { mediabunny: {} });
  return { engine, initialize, getFrame, dispose };
}
describe("persistent realtime decoding", () => {
  it("reuses a decoder across playback and backward seeks", async () => {
    const f = fixture(), blob = new Blob(["video"]);
    for (const time of [0, 1 / 30, 2 / 30, 0]) await f.engine.getPlaybackFrame(blob, time, 640);
    expect(f.initialize).toHaveBeenCalledTimes(1);
    expect(f.getFrame.mock.calls.map(call => call[0])).toEqual([0, 1 / 30, 2 / 30, 0]);
    expect(f.dispose).not.toHaveBeenCalled();
  });
  it("distinguishes same-sized blobs and changed preview resolutions", async () => {
    const f = fixture(), a = new Blob(["one"]), b = new Blob(["two"]);
    await f.engine.getPlaybackFrame(a, 0, 640);
    await f.engine.getPlaybackFrame(b, 0, 640);
    await f.engine.getPlaybackFrame(a, 1, 1280);
    expect(f.initialize).toHaveBeenCalledTimes(3);
  });
  it("bounds decoder storage and releases cached decoders", async () => {
    const f = fixture();
    for (let i = 0; i < 5; i++) await f.engine.getPlaybackFrame(new Blob([String(i)]), 0, 640);
    await vi.waitFor(() => expect(f.dispose).toHaveBeenCalledTimes(1));
    f.engine.clearPlaybackDecoders();
    await vi.waitFor(() => expect(f.dispose).toHaveBeenCalledTimes(5));
  });
  it("can recover after a decode failure", async () => {
    const f = fixture(), blob = new Blob();
    f.getFrame.mockRejectedValueOnce(new Error("decode failed"));
    await expect(f.engine.getPlaybackFrame(blob, 0, 640)).rejects.toThrow("decode failed");
    await f.engine.getPlaybackFrame(blob, 1, 640);
    expect(f.initialize).toHaveBeenCalledTimes(2);
  });
});
