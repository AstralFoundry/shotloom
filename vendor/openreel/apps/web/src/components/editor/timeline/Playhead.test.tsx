import { render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Playhead } from "./Playhead";
import { playheadLiveTime } from "../../../stores/playhead-live-time";

/**
 * 指针的性能契约：播放中每一帧都要动，但父级（整条时间线）一帧都不能因为指针而重渲染。
 * 参考实现就是把指针单独隔离出来直接写 transform，位置永远不经过父级 React 状态。
 */
let frames: Map<number, (time: number) => void>;
let nextFrame = 0;

beforeEach(() => {
  frames = new Map();
  nextFrame = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: (time: number) => void) => {
    nextFrame += 1;
    frames.set(nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => { frames.delete(id); });
  playheadLiveTime.seconds = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function tick(times: number) {
  for (let step = 0; step < times; step += 1) {
    const pending = [...frames.entries()];
    frames.clear();
    for (const [, callback] of pending) callback(step);
  }
}

function Harness({ renders }: { renders: () => void }) {
  const [position] = useState(0);
  renders();
  return (
    <Playhead position={position} pixelsPerSecond={50} scrollX={0} headerOffset={44} playing />
  );
}

describe("Playhead", () => {
  it("moves every animation frame without re-rendering its parent", () => {
    let renders = 0;
    const view = render(<Harness renders={() => { renders += 1; }} />);
    const element = view.container.firstElementChild as HTMLElement;
    const parentRenders = renders;

    for (let frame = 1; frame <= 10; frame += 1) {
      playheadLiveTime.seconds = frame * 0.02;
      tick(1);
      expect(element.style.transform).toBe(`translateX(${frame * 0.02 * 50}px)`);
    }
    expect(renders).toBe(parentRenders);
  });

  it("hides itself off the left edge instead of unmounting", () => {
    const view = render(
      <Playhead position={0} pixelsPerSecond={50} scrollX={120} headerOffset={44} playing />,
    );
    const element = view.container.firstElementChild as HTMLElement;
    playheadLiveTime.seconds = 1;
    tick(1);
    expect(element.style.visibility).toBe("hidden");
    playheadLiveTime.seconds = 10;
    tick(1);
    expect(element.style.visibility).toBe("visible");
    expect(view.container.firstElementChild).toBe(element);
  });

  it("follows the committed position and stops its own frame loop when paused", () => {
    const view = render(
    <Playhead position={2} pixelsPerSecond={50} scrollX={0} headerOffset={44} playing={false} />,
    );
    const element = view.container.firstElementChild as HTMLElement;
    expect(element.style.transform).toBe("translateX(100px)");
    expect(frames.size).toBe(0);
    playheadLiveTime.seconds = 9;
    tick(1);
    expect(element.style.transform).toBe("translateX(100px)");
  });
});
