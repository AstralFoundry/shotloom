import { afterEach, describe, expect, it } from "vitest";
import { MOTION_EFFECT_PRESETS, getMotionEffectParameterDescriptors } from "@openreel/core";
import { configureShotloomLocale } from "../shotloom-mode";
import { motionEffectParameterLabel } from "./motion-layer-labels";

afterEach(() => configureShotloomLocale("en-US"));

describe("Motion effect parameter display labels", () => {
  it("covers the official non-shader parameter catalog and preserves descriptor data", () => {
    let count = 0;
    for (const preset of MOTION_EFFECT_PRESETS) {
      const effect = preset.create("original-id");
      const descriptors = getMotionEffectParameterDescriptors(effect);
      const source = JSON.stringify({ effect, descriptors });
      for (const descriptor of descriptors) {
        configureShotloomLocale("en-US");
        expect(motionEffectParameterLabel(effect, descriptor)).toBe(descriptor.label);
        configureShotloomLocale("zh-CN");
        expect(motionEffectParameterLabel(effect, descriptor)).toMatch(/[\u4e00-\u9fff]/);
        count++;
      }
      expect(JSON.stringify({ effect, descriptors })).toBe(source);
    }
    expect(count).toBe(41);
  });
  it("preserves unregistered parameters and shader descriptors", () => {
    configureShotloomLocale("zh-CN");
    const custom = { param: "value" as const, label: "User {name} $&", min: 0, max: 1, step: 0.1 };
    expect(motionEffectParameterLabel({ type: "shader" }, custom)).toBe(custom.label);
    expect(motionEffectParameterLabel({ type: "blur" }, custom)).toBe(custom.label);
  });
});
