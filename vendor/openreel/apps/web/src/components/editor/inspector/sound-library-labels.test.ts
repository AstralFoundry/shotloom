import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { soundDisplayName } from "./sound-library-labels";

const source = readFileSync(resolve(process.cwd(), "../../packages/core/src/audio/sound-library-engine.ts"), "utf8");
const originals = [...source.matchAll(/generator\.\w+\(\s*"([^"]+)",\s*"([^"]+)"/g)].map((match) => ({ id: match[1], name: match[2], isBuiltin: true }));
afterEach(() => configureShotloomLocale("en-US"));

describe.each(["en-US", "zh-CN"] as const)("Sound catalog (%s)", (locale) => {
  it("covers all 109 generated built-in names without mutating source metadata", () => {
    configureShotloomLocale(locale);
    expect(originals).toHaveLength(109);
    const before = JSON.stringify(originals);
    for (const item of originals) {
      const name = soundDisplayName(item);
      if (locale === "en-US") expect(name).toBe(item.name);
      else {
        expect(name).not.toBe(item.name);
        expect(name).toMatch(/\p{Script=Han}/u);
      }
    }
    expect(JSON.stringify(originals)).toBe(before);
  });
  it("preserves custom, renamed and unknown sounds including prototype-like IDs", () => {
    configureShotloomLocale(locale);
    for (const item of [
      { id: "music-electronic-beat-1", name: "Electronic Beat", isBuiltin: false },
      { id: "music-electronic-beat-1", name: "My renamed beat", isBuiltin: true },
      { id: "unknown", name: "My sound", isBuiltin: true },
      { id: "__proto__", name: "Original", isBuiltin: true },
      { id: "constructor", name: "Original", isBuiltin: true },
    ]) expect(soundDisplayName(item)).toBe(item.name);
  });
  it("resolves the current language on each display call", () => {
    const item = { id: "sfx-ui-click-1", name: "Click", isBuiltin: true };
    configureShotloomLocale("zh-CN"); expect(soundDisplayName(item)).toBe("点击");
    configureShotloomLocale("en-US"); expect(soundDisplayName(item)).toBe("Click");
  });
});
