import { afterEach, describe, expect, it, vi } from "vitest";

async function fixture() {
  vi.stubGlobal("self", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  const { VideoEngine } = await import("./video-engine");
  const engine = new VideoEngine();
  const listeners = new Map<string, Set<() => void>>();
  let time = 0;
  const video = {
    readyState: 2, seeking: false, videoWidth: 640, videoHeight: 360,
    get currentTime() { return time; },
    set currentTime(value: number) { time = value; this.seeking = true; },
    addEventListener(type: string, fn: () => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: () => void) { listeners.get(type)?.delete(fn); },
  };
  const drawImage = vi.fn();
  vi.stubGlobal("OffscreenCanvas", class {
    constructor(public width: number, public height: number) {}
    getContext() { return { drawImage, fillRect: vi.fn() }; }
  });
  const bitmap = { close: vi.fn() };
  vi.stubGlobal("createImageBitmap", vi.fn(async () => bitmap));
  (engine as any).videoElementCache.set("media", { video, url: "blob:fixture" });
  return { engine, video, listeners, drawImage, bitmap, seeked() {
    video.seeking = false;
    for (const fn of listeners.get("seeked") ?? []) fn();
  } };
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("native video frame seeking", () => {
  it("waits for the requested seek even while readyState still describes the old frame", async () => {
    const f = await fixture();
    const pending = f.engine.decodeFrameWithVideoElement("media", new Blob(), 4, 640, 360);
    await Promise.resolve();
    expect(f.drawImage).not.toHaveBeenCalled();
    f.seeked();
    expect(await pending).toBe(f.bitmap);
    expect(f.video.currentTime).toBe(4);
    expect(f.drawImage).toHaveBeenCalledTimes(1);
    expect(f.listeners.get("seeked")?.size).toBe(0);
  });

  it("rejects a missing seek receipt instead of drawing an old frame as success", async () => {
    const f = await fixture();
    vi.useFakeTimers();
    const pending = f.engine.decodeFrameWithVideoElement("media", new Blob(), 4, 640, 360);
    const rejected = expect(pending).rejects.toThrow("Video seek timed out at 4s");
    await vi.advanceTimersByTimeAsync(10000);
    await rejected;
    expect(f.drawImage).not.toHaveBeenCalled();
    expect(f.listeners.get("seeked")?.size).toBe(0);
    expect(f.listeners.get("error")?.size).toBe(0);
  });

  it("reuses a fully decoded frame at the same timestamp without waiting for a new event", async () => {
    const f = await fixture();
    expect(await f.engine.decodeFrameWithVideoElement("media", new Blob(), 0, 640, 360)).toBe(f.bitmap);
    expect(f.listeners.size).toBe(0);
  });
});


describe("realtime source decoding", () => {
  it("uses the persistent decoder rather than reopening the input for each frame", async () => {
    const f = await fixture();
    const { getMediaEngine } = await import("../media/mediabunny-engine");
    const media = getMediaEngine();
    vi.spyOn(media, "isAvailable").mockReturnValue(true);
    const persistent = vi.spyOn(media, "getPlaybackFrame").mockResolvedValue({ width: 960, height: 540 } as OffscreenCanvas);
    const randomAccess = vi.spyOn(media, "getFrameAtTime");
    try {
      const blob = new Blob(["source"]);
      await f.engine.decodeFrameWithMediaBunny(blob, 1, 960, 540, "media", true);
      await f.engine.decodeFrameWithMediaBunny(blob, 1 + 1 / 30, 960, 540, "media", true);
      expect(persistent).toHaveBeenNthCalledWith(1, blob, 1, 960);
      expect(persistent).toHaveBeenCalledTimes(2);
      expect(randomAccess).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });
});
