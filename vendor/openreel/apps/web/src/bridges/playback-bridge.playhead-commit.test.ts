import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MasterTimelineClock } from "@openreel/core";
import { PlaybackBridge } from "./playback-bridge";
import { useTimelineStore } from "../stores/timeline-store";
import { playheadLiveTime } from "../stores/playhead-live-time";

const mocks = vi.hoisted(() => ({ engine: vi.fn(), project: vi.fn(), subscribe: vi.fn(() => vi.fn()) }));
vi.mock("../stores/engine-store", () => ({ useEngineStore: { getState: mocks.engine, setState: vi.fn() } }));
vi.mock("../stores/project-store", () => ({ useProjectStore: { getState: mocks.project, subscribe: mocks.subscribe } }));

let clock: MasterTimelineClock;
let bridge: PlaybackBridge;
let handlers: Map<string, (event: { type: string; time: number; state: string }) => void>;
let pauseCalls: number;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (callback: (time: number) => void) => window.setTimeout(() => callback(performance.now()), 16));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  vi.clearAllMocks();
  handlers = new Map();
  pauseCalls = 0;
  useTimelineStore.setState({ loopEnabled: false, loopStart: 0, loopEnd: 0, playheadPosition: 0, playbackState: "paused", isScrubbing: false });
  playheadLiveTime.seconds = 0;
  const audioContext = { currentTime: 0, state: "running", resume: vi.fn(async () => {}) };
  clock = new MasterTimelineClock({ audioContext: audioContext as unknown as AudioContext });
  clock.setDuration(10);
  const controller = {
    setProject: vi.fn(),
    addEventListener: vi.fn((type: string, handler: (event: never) => void) => { handlers.set(type, handler as never); }),
    removeEventListener: vi.fn(),
    getMasterClock: () => clock,
    getRealtimeAudioGraph: () => ({ seekTo: vi.fn() }),
    getIsScrubbing: () => false,
    isPlaying: () => clock.isPlaying,
    play: () => clock.play(),
    pause: () => { pauseCalls += 1; clock.pause(); },
    stop: vi.fn(),
    seek: async (time: number) => { clock.seek(time); },
  };
  mocks.engine.mockReturnValue({ initialized: true, playbackController: controller });
  mocks.project.mockReturnValue({ project: { timeline: { duration: 10 } }, getTimelineDuration: () => 10 });
  bridge = new PlaybackBridge();
  await bridge.initialize();
});

afterEach(() => {
  bridge.dispose();
  clock.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("PlaybackBridge playhead commits", () => {
  it("keeps the live pointer per frame but commits the store at 10Hz", async () => {
    const timeupdate = handlers.get("timeupdate");
    expect(timeupdate).toBeTypeOf("function");
    useTimelineStore.getState().play();

    let last = useTimelineStore.getState().playheadPosition;
    let commits = 0;
    for (let frame = 1; frame <= 60; frame += 1) {
      const time = frame * 0.016;
      timeupdate!({ type: "timeupdate", time, state: "playing" });
      // 每一帧指针都要知道真实位置，否则画面会一顿一顿地跳。
      expect(playheadLiveTime.seconds).toBeCloseTo(time, 10);
      const committed = useTimelineStore.getState().playheadPosition;
      if (committed !== last) {
        // 提交给 React 消费者的值必须与某一帧的真实位置一致，不能是插出来的近似值。
        expect(committed).toBeCloseTo(time, 10);
        commits += 1;
        last = committed;
      }
    }
    // 60 帧 ≈ 1 秒：store 只应该被写约 10 次，而不是 60 次。
    expect(commits).toBeGreaterThan(5);
    expect(commits).toBeLessThanOrEqual(12);
  });

  it("commits the exact pointer time when playback stops", async () => {
    const timeupdate = handlers.get("timeupdate")!;
    useTimelineStore.getState().play();
    for (let frame = 1; frame <= 6; frame += 1) {
      timeupdate({ type: "timeupdate", time: frame * 0.016, state: "playing" });
    }
    // 6 帧 = 0.096 秒，还没到 0.1 的提交点：store 仍在 0，指针已经走到 0.096 秒。
    expect(useTimelineStore.getState().playheadPosition).toBe(0);
    expect(playheadLiveTime.seconds).toBeCloseTo(0.096, 10);
    bridge.pause();
    expect(pauseCalls).toBe(1);
    expect(useTimelineStore.getState().playheadPosition).toBeCloseTo(0.096, 10);
  });

  it("seeks commit the exact target and keep the live pointer in step", async () => {
    useTimelineStore.getState().play();
    handlers.get("timeupdate")!({ type: "timeupdate", time: 4.2, state: "playing" });
    await bridge.seek(1.5);
    expect(playheadLiveTime.seconds).toBe(1.5);
    expect(useTimelineStore.getState().playheadPosition).toBe(1.5);
    // seek 之后 store 已经落在精确值上，下一帧继续按节流走。
    handlers.get("timeupdate")!({ type: "timeupdate", time: 1.516, state: "playing" });
    expect(playheadLiveTime.seconds).toBeCloseTo(1.516, 10);
    expect(useTimelineStore.getState().playheadPosition).toBe(1.5);
    handlers.get("timeupdate")!({ type: "timeupdate", time: 1.62, state: "playing" });
    expect(useTimelineStore.getState().playheadPosition).toBeCloseTo(1.62, 10);
  });

  it("toggles through the bridge so the UI state follows the controller", async () => {
    expect(useTimelineStore.getState().playbackState).toBe("paused");
    await bridge.togglePlayback();
    expect(clock.isPlaying).toBe(true);
    expect(useTimelineStore.getState().playbackState).toBe("playing");

    await bridge.togglePlayback();
    expect(clock.isPlaying).toBe(false);
    expect(useTimelineStore.getState().playbackState).toBe("paused");
  });
});
