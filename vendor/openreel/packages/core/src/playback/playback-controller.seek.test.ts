import { describe, expect, it, vi } from "vitest";
import type { Project } from "../types/project";
import type { VideoEngine } from "../video/video-engine";
import type { AudioEngine } from "../audio/audio-engine";
import type { RenderedFrame } from "../video/types";
import { PlaybackController } from "./playback-controller";
vi.mock("./master-timeline-clock", () => ({ initializeMasterClock: () => ({ subscribe: vi.fn(() => vi.fn()), seek: vi.fn(), setDuration: vi.fn(), reportVideoTime: vi.fn() }) }));
vi.mock("../audio/realtime-audio-graph", () => ({ initializeRealtimeAudioGraph: () => ({ seekTo: vi.fn(), stopScheduler: vi.fn() }) }));
const project = () => ({ timeline: { duration: 30, tracks: [] }, mediaLibrary: { items: [] } }) as unknown as Project;
const frame = (time: number) => ({ image: { close: vi.fn(), time }, width: 10, height: 10 }) as unknown as RenderedFrame;
async function fixture(renderFrame: (project: Project, time: number) => Promise<RenderedFrame>) {
  const controller = new PlaybackController();
  await controller.initialize({ renderFrame } as unknown as VideoEngine, {} as AudioEngine);
  controller.setProject(project());
  const drawImage = vi.fn();
  controller.setDisplayCanvas({ width: 10, height: 10, getContext: () => ({ drawImage }) } as unknown as HTMLCanvasElement);
  return { controller, drawImage };
}
describe("PlaybackController latest seek", () => {
  it("discards an old decoded frame and renders the last seek instead of dropping it", async () => {
    let release!: (f: RenderedFrame) => void;
    const stale = frame(1), latest = frame(16);
    const render = vi.fn().mockImplementationOnce(() => new Promise(resolve => { release = resolve; })).mockResolvedValue(latest);
    const { controller, drawImage } = await fixture(render);
    const seeks: number[] = [];
    controller.addEventListener("seek", event => seeks.push(event.time));
    const first = controller.seek(1);
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));
    const requests = [10, 3, 22, 5, 16].map(time => controller.seek(time));
    release(stale);
    await Promise.all([first, ...requests]);
    expect(render.mock.calls.map(call => call[1])).toEqual([1, 16]);
    expect(stale.image.close).toHaveBeenCalledTimes(1);
    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(drawImage).toHaveBeenCalledWith(latest.image, 0, 0);
    expect(seeks).toEqual([16]);
  });
  it("does not publish an in-flight frame or seek after changing projects", async () => {
    let release!: (f: RenderedFrame) => void;
    const stale = frame(4);
    const render = vi.fn(() => new Promise<RenderedFrame>(resolve => { release = resolve; }));
    const { controller, drawImage } = await fixture(render);
    const seek = vi.fn();controller.addEventListener("seek", seek);
    const pending = controller.seek(4);
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));
    controller.setProject(project());release(stale);await pending;
    expect(drawImage).not.toHaveBeenCalled();expect(stale.image.close).toHaveBeenCalledTimes(1);expect(seek).not.toHaveBeenCalled();
  });
  it("lets a later scrub replace an in-flight seek without an old seek event", async () => {
    let release!: (f: RenderedFrame) => void;
    const stale = frame(1), latest = frame(9);
    const render = vi.fn().mockImplementationOnce(() => new Promise(resolve => { release = resolve; })).mockResolvedValue(latest);
    const { controller, drawImage } = await fixture(render);
    const seek = vi.fn();controller.addEventListener("seek", seek);
    const pending = controller.seek(1);
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));
    const scrub = controller.scrubTo(9);
    release(stale);await Promise.all([pending, scrub]);
    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(drawImage).toHaveBeenCalledWith(latest.image, 0, 0);
    expect(seek).not.toHaveBeenCalled();
    expect(stale.image.close).toHaveBeenCalledTimes(1);
  });

});
