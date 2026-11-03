import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 播放期间的订阅契约：预览渲染器每帧都会把 currentFrame 写进 engine store，
 * 时间线只要整店订阅就会跟着每帧重渲染——指针位置节流之后剩下的卡顿就在这里。
 */
const timeline = readFileSync(new URL("./Timeline.tsx", import.meta.url), "utf8");

describe("Timeline store subscriptions", () => {
  it("never subscribes to the whole engine store", () => {
    expect(timeline).not.toMatch(/=\s*useEngineStore\(\)/);
    expect(timeline).toMatch(/useEngineStore\(\s*\(state\)\s*=>\s*state\.getTitleEngine\s*\)/);
    expect(timeline).toMatch(/useEngineStore\(\s*\(state\)\s*=>\s*state\.getGraphicsEngine\s*\)/);
  });
});
