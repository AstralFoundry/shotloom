import { afterEach, describe, expect, it } from "vitest";
import { EASING_CATEGORIES } from "@openreel/core";
import { configureShotloomLocale } from "../shotloom-mode";
import { easingCategoryName, easingDisplayName } from "./easing-labels";

afterEach(() => configureShotloomLocale("en-US"));
describe.each(["en-US", "zh-CN"] as const)("Easing labels (%s)", (locale) => {
  it("covers the full official catalog without changing protocol values", () => {
    configureShotloomLocale(locale);
    const original = JSON.stringify(EASING_CATEGORIES);
    for (const category of EASING_CATEGORIES) {
      expect(easingCategoryName(category.name)).toBeTruthy();
      for (const value of category.easings) {
        expect(easingDisplayName(value)).toBeTruthy();
        expect(easingDisplayName(value)).not.toBe(value);
        if (locale === "zh-CN") expect(easingDisplayName(value)).toMatch(/\p{Script=Han}/u);
      }
    }
    expect(JSON.stringify(EASING_CATEGORIES)).toBe(original);
  });
  it("retains unknown or custom identifiers", () => {
    configureShotloomLocale(locale);
    for (const value of ["Custom", "__proto__", "constructor", ""]) {
      expect(easingDisplayName(value)).toBe(value);
      expect(easingCategoryName(value)).toBe(value);
    }
  });
});
