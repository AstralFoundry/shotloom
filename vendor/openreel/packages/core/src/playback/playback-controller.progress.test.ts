import { afterEach, describe, expect, it, vi } from "vitest";
import { PlaybackController } from "./playback-controller";
import { MasterTimelineClock, type ClockSubscriber } from "./master-timeline-clock";
import type { Project } from "../types/project";
import type { VideoEngine } from "../video/video-engine";
import type { AudioEngine } from "../audio/audio-engine";
import type { RenderedFrame } from "../video/types";

const mocks = vi.hoisted(() => ({ clock: vi.fn() }));
vi.mock("./master-timeline-clock", async (original) => ({
  ...await original<typeof import("./master-timeline-clock")>(),
  initializeMasterClock: mocks.clock,
}));
vi.mock("../audio/realtime-audio-graph", () => ({
  initializeRealtimeAudioGraph: () => ({ stopScheduler: vi.fn() }),
}));

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("playback progress during slow decoding", () => {
  it("keeps publishing time and decodes a fresh frame after a late frame", async () => {
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    let subscriber!: ClockSubscriber;
    let time = 1;
    const clock = new MasterTimelineClock({ audioContext: { get currentTime() { return time; }, state: "running" } as AudioContext });
    clock.setDuration(3);
    mocks.clock.mockReturnValue(clock);
    const subscribe = clock.subscribe.bind(clock);
    vi.spyOn(clock, "subscribe").mockImplementation(value => { subscriber = value; return subscribe(value); });
    let release!: (frame: RenderedFrame) => void;
    const frame = { image: { close: vi.fn() } } as unknown as RenderedFrame;
    const renderFrame = vi.fn().mockImplementationOnce(() => new Promise(resolve => { release = resolve; })).mockResolvedValue(frame);
    const controller = new PlaybackController({ enableAudio: false });
    await controller.initialize({ renderFrame } as unknown as VideoEngine, {} as AudioEngine);
    controller.setProject({ timeline: { duration: 3, tracks: [] }, mediaLibrary: { items: [] } } as unknown as Project);
    await controller.play();
    const updates: number[] = [];
    controller.addEventListener("timeupdate", event => updates.push(event.time));
    subscriber.onTimeUpdate(0);
    await vi.waitFor(() => expect(renderFrame).toHaveBeenCalledTimes(1));
    time = 2.2;
    subscriber.onTimeUpdate(1.2);
    expect(updates).toContain(1.2);
    release(frame);
    await vi.waitFor(() => expect(clock.drift).toBeGreaterThan(33));
    subscriber.onTimeUpdate(1.3);
    await vi.waitFor(() => expect(renderFrame).toHaveBeenCalledTimes(2));
    expect(renderFrame.mock.calls[1][1]).toBe(1.3);
    expect(updates).toEqual([0, 1.2, 1.3]);
    clock.dispose();
  });

  it("publishes the exact end of a three-second clip before stopping", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => setTimeout(callback, 16));
    vi.stubGlobal("cancelAnimationFrame", clearTimeout);
    let time = 0;
    const clock = new MasterTimelineClock({ audioContext: { get currentTime() { return time; }, state: "running" } as AudioContext });
    clock.setDuration(3);
    const events: Array<number | string> = [];
    clock.subscribe({ onTimeUpdate: value => events.push(value), onStateChange: value => events.push(value) });
    await clock.play();
    time = 1.1; await vi.advanceTimersByTimeAsync(16);
    time = 3; await vi.advanceTimersByTimeAsync(16);
    expect(events).toEqual(["playing", 1.1, 3, "stopped", 0]);
    clock.dispose();
  });
});
