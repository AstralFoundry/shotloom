import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BeatSyncState } from "../../../bridges/beat-sync-bridge";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { BeatMarkerOverlay } from "./BeatMarkerOverlay";

const bridge = vi.hoisted(() => ({ getState: vi.fn(), subscribe: vi.fn() }));
vi.mock("../../../bridges/beat-sync-bridge", () => ({ getBeatSyncBridge: () => bridge }));

describe.each(["en-US", "zh-CN"] as const)("beat markers (%s)", (locale) => {
  const state: BeatSyncState = { isAnalyzing: false, progress: 100, error: null, beatAnalysis: null, beatMarkers: [
    { time: 2, strength: 1, index: 4, isDownbeat: true },
    { time: 3, strength: 0.5, index: 5, isDownbeat: false },
    { time: 20, strength: 1, index: 40, isDownbeat: true },
  ] };
  beforeEach(() => { configureShotloomLocale(locale); bridge.getState.mockReturnValue(state); });
  afterEach(() => { cleanup(); configureShotloomLocale("en-US"); vi.resetAllMocks(); });
  it("translates beat numbers without changing visibility, positioning or subscriptions", () => {
    let notify: ((state: BeatSyncState) => void) | undefined;
    const unsubscribe = vi.fn();
    bridge.subscribe.mockImplementation((listener) => { notify = listener; return unsubscribe; });
    const view = render(<BeatMarkerOverlay pixelsPerSecond={60} scrollX={0} viewportWidth={300} totalHeight={240} />);
    const marker = screen.getByTitle(locale === "zh-CN" ? "节拍 5" : "Beat 5");
    expect(marker.parentElement).toHaveStyle({ left: "120px", height: "240px" });
    expect(screen.queryByTitle(locale === "zh-CN" ? "节拍 41" : "Beat 41")).not.toBeInTheDocument();
    act(() => notify?.({ ...state, beatMarkers: [] }));
    expect(view.container).toBeEmptyDOMElement();
    view.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
