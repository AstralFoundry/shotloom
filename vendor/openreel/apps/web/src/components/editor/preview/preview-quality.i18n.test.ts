import { afterEach, describe, expect, it } from "vitest";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { PREVIEW_QUALITY_OPTIONS, previewQualityLabel, previewQualityScale } from "./preview-resolution";
afterEach(() => configureShotloomLocale("en-US"));
describe.each(["en-US", "zh-CN"] as const)("Preview quality (%s)", locale => {
  it("localizes quality names while preserving enum values and resolution behavior", () => {
    configureShotloomLocale(locale);
    const source = JSON.stringify(PREVIEW_QUALITY_OPTIONS);
    expect(PREVIEW_QUALITY_OPTIONS.map(option => previewQualityLabel(option.value)))
      .toEqual(locale === "zh-CN" ? ["自动", "完整", "½", "¼"] : ["Auto", "Full", "½", "¼"]);
    expect(PREVIEW_QUALITY_OPTIONS.map(option => previewQualityScale(option.value, 3840, 2160))).toEqual([0.5, 1, 0.5, 0.25]);
    expect(JSON.stringify(PREVIEW_QUALITY_OPTIONS)).toBe(source);
  });
});
