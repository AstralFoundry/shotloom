import { afterEach, describe, expect, it, vi } from "vitest";
import type { TranscriptWord } from "@openreel/core";
import { configureShotloomLocale } from "../shotloom-mode";
import { extractHighlights } from "./highlight-service";

const mocks = vi.hoisted(() => ({ analyze: vi.fn() }));
vi.mock("@openreel/core", async importOriginal => ({
  ...await importOriginal<typeof import("@openreel/core")>(), analyzeAudioForHighlights: mocks.analyze,
}));
afterEach(() => configureShotloomLocale("en-US"));

describe.each(["en-US", "zh-CN"] as const)("Local highlights (%s)", locale => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  it.each([false, true])("translates generated names and reasons with speech=%s, preserving ranges and input", async speech => {
    configureShotloomLocale(locale);
    const audio = {} as AudioBuffer;
    const transcript: TranscriptWord[] = speech ? [{ text: "原文 {name} $&", start: 0, end: 1 }] : [];
    const source = JSON.stringify(transcript);
    mocks.analyze.mockReturnValue({ duration: 30, segments: [
      { start: 0, end: 5, rmsDb: -10, peakDb: -5, speechRate: 1, isSilence: false },
      { start: 20, end: 25, rmsDb: -20, peakDb: -10, speechRate: 1, isSilence: false },
    ] });
    const progress = vi.fn();
    const results = await extractHighlights(audio, transcript, { targetClipCount: 2, minClipDuration: 5, maxClipDuration: 5 }, progress);
    expect(results.map(({ title, reason, ...timing }) => timing)).toEqual([
      { start: 0, end: 5, score: 9 }, { start: 18.333333333333332, end: 23.333333333333332, score: 2 },
    ]);
    expect(results.map(r => r.title)).toEqual([ui("Highlight 1", "精彩片段 1"), ui("Highlight 2", "精彩片段 2")]);
    expect(results[0].reason).toBe(speech ? ui("Strong local audio energy and speech activity", "本地音频能量与语音活动较强") : ui("Strong local audio energy", "本地音频能量较强"));
    expect(progress.mock.calls.map(([phase, percent]) => [phase, percent])).toEqual([["analyze", 10], ["rank", 35], ["done", 100]]);
    expect(progress.mock.calls[0][2]).toBe(ui("Analyzing audio energy...", "正在分析音频能量…"));
    expect(progress.mock.calls[1][2]).toBe(ui("Ranking energetic moments locally...", "正在本地排序高能时刻…"));
    expect(progress.mock.calls[2][2]).toBe(ui("Local highlights ready", "本地精彩片段已就绪"));
    expect(mocks.analyze).toHaveBeenCalledWith(audio, transcript);
    expect(JSON.stringify(transcript)).toBe(source);
  });
});
