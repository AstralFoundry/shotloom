import { describe, expect, it } from "vitest";
import {
  parseSRT,
  parseSRTTimestamp,
  reflowCaptionText,
  splitCaptionIntoSingleLineCues,
  exportSRT,
  formatSRTTimestamp,
} from "./subtitle-engine";
import type { Subtitle } from "../types";

describe("subtitle export boundaries", () => {
  it("carries rounded milliseconds into seconds, minutes and hours", () => {
    expect(formatSRTTimestamp(0.9996)).toBe("00:00:01,000");
    expect(formatSRTTimestamp(59.9996)).toBe("00:01:00,000");
    expect(formatSRTTimestamp(3599.9996)).toBe("01:00:00,000");
  });

  it("identifies invalid cues instead of silently clamping or exporting zero-length text", () => {
    for (const [startTime, endTime] of [[-1, 2], [1, NaN], [Infinity, 2], [2, 1], [1, 1.0001]]) {
      expect(() => exportSRT([{ id: "invalid-cue", startTime, endTime, text: "保留正文" } as Subtitle]))
        .toThrow("Subtitle invalid-cue has an invalid time range");
    }
  });
});

describe("subtitle parsing", () => {
  it("parses indexed SRT captions", () => {
    const result = parseSRT(
      "1\n00:00:01,000 --> 00:00:03,250\nA first caption\n\n2\n00:00:04.5 --> 00:00:06.000\nA second caption",
    );

    expect(result.subtitles).toHaveLength(2);
    expect(result.subtitles[0]).toMatchObject({
      text: "A first caption",
      startTime: 1,
      endTime: 3.25,
    });
    expect(result.subtitles[1].startTime).toBe(4.5);
  });

  it("parses WEBVTT cue ids, cue settings, and plain-text markup", () => {
    const result = parseSRT(
      "WEBVTT\n\nintro\n00:01.000 --> 00:03.500 align:middle\n<v Alex>Hello &amp; <b>welcome</b></v>",
    );

    expect(result.errors).toEqual([]);
    expect(result.subtitles).toHaveLength(1);
    expect(result.subtitles[0]).toMatchObject({
      text: "Hello & welcome",
      startTime: 1,
      endTime: 3.5,
    });
  });

  it("rejects invalid time ranges but keeps valid cues", () => {
    const result = parseSRT(
      "1\n00:00:03,000 --> 00:00:02,000\nBad\n\n2\n00:00:04,000 --> 00:00:05,000\nGood",
    );

    expect(result.subtitles.map((subtitle) => subtitle.text)).toEqual(["Good"]);
    expect(result.errors).toHaveLength(1);
  });

  it("supports VTT timestamps without hours", () => {
    expect(parseSRTTimestamp("01:02.250")).toBe(62.25);
  });
});

describe("caption reflow", () => {
  it("wraps a caption to the selected number of words per line", () => {
    expect(reflowCaptionText("one two three four five six seven", 5)).toBe(
      "one two three four five\nsix seven",
    );
  });

  it("normalizes existing line breaks while preserving words", () => {
    expect(reflowCaptionText("one two\nthree   four", 2)).toBe(
      "one two\nthree four",
    );
  });

  it("splits long captions into sequential single-line cues", () => {
    expect(
      splitCaptionIntoSingleLineCues(
        "one two three four five six seven",
        10,
        17,
        5,
      ),
    ).toEqual([
      { text: "one two three four five", startTime: 10, endTime: 15 },
      { text: "six seven", startTime: 15, endTime: 17 },
    ]);
  });

  it("removes embedded line breaks from a single cue", () => {
    expect(splitCaptionIntoSingleLineCues("one two\nthree", 0, 3, 5)).toEqual([
      { text: "one two three", startTime: 0, endTime: 3 },
    ]);
  });
});
