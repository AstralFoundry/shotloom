import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MOTION_SHADER_LIBRARY, DEFAULT_MOTION_TRANSFORM, createMotionShaderEffect,
  defaultMotionShaderParams, registerMotionShader, unregisterMotionShader,
  type MotionShapeLayer, type MotionShaderDef,
} from "@openreel/core";
import { configureShotloomLocale } from "../shotloom-mode";
import { motionShaderName, motionShaderParameterLabel } from "./motion-shader-labels";
import { motionPropertyLabel } from "./motion-layer-labels";

function shape(): MotionShapeLayer {
  return { id: "shape", type: "shape", name: "用户 {name} $&", startTime: 0, duration: 2, visible: true, locked: false,
    transform: DEFAULT_MOTION_TRANSFORM, keyframes: [], shapeType: "rectangle", width: 100, height: 100,
    style: { fill: { type: "solid", color: "#fff", opacity: 1 }, stroke: { color: "#000", width: 0, opacity: 1 }, cornerRadius: 0 },
  };
}

describe.each(["en-US", "zh-CN"] as const)("Shader display catalog in %s", locale => {
  beforeEach(() => configureShotloomLocale(locale));
  afterEach(() => { configureShotloomLocale("en-US"); unregisterMotionShader("custom-i18n-shader"); });

  it.each(MOTION_SHADER_LIBRARY)("covers builtin $id names and every parameter without changing definitions", def => {
    const snapshot = JSON.stringify(def);
    const name = motionShaderName(def);
    if (locale === "en-US" || def.name === "VHS") expect(name).toBe(def.name);
    else expect(name).not.toBe(def.name);
    for (const param of def.params) {
      const label = motionShaderParameterLabel(def, param);
      if (locale === "en-US") expect(label).toBe(param.label);
      else expect(label).not.toBe(param.label);
    }
    expect(JSON.stringify(def)).toBe(snapshot);
  });

  it("uses localized labels for effect and fill keyframes but keeps their wire values", () => {
    const effect = { ...createMotionShaderEffect("dither", "effect-1"), name: "特效 {name} $&" };
    const source = { ...shape(), effects: [effect] };
    const snapshot = JSON.stringify(source);
    expect(motionPropertyLabel("effect.effect-1.levels", "fallback", source)).toBe(locale === "zh-CN" ? "特效 {name} $& 色阶" : "特效 {name} $& Levels");
    const def = MOTION_SHADER_LIBRARY.find(def => def.id === "liquid-metal")!;
    const fill = { ...source, style: { ...source.style, fill: { type: "shader" as const, opacity: 1,
      shader: { shaderId: def.id, params: defaultMotionShaderParams(def) },
    } } };
    expect(motionPropertyLabel("shape.fill.shader.scale", "fallback", fill)).toBe(locale === "zh-CN" ? "缩放" : "Scale");
    expect(effect.params).toEqual({ levels: 4, scale: 1 });
    expect(JSON.stringify(source)).toBe(snapshot);
  });

  it("preserves custom shader names and parameter labels even when they match builtin words", () => {
    const def: MotionShaderDef = { id: "custom-i18n-shader", name: "Liquid Metal {name} $&", category: "effect", origin: "generated", glsl: "custom shader source",
      params: [{ name: "levels", label: "Levels {name} $&", type: "number", default: 3, min: 0, max: 10, step: 1 }],
    };
    registerMotionShader(def);
    const source = { ...shape(), effects: [{ ...createMotionShaderEffect(def.id, "custom-effect"), name: "用户效果" }] };
    expect(motionShaderName(def)).toBe(def.name);
    expect(motionShaderParameterLabel(def, def.params[0])).toBe(def.params[0].label);
    expect(motionPropertyLabel("effect.custom-effect.levels", "fallback", source)).toBe("用户效果 Levels {name} $&");
    const builtin = MOTION_SHADER_LIBRARY[0];
    const copy = { ...builtin, origin: "generated" as const };
    expect(motionShaderName(copy)).toBe(copy.name);
    expect(motionShaderParameterLabel(copy, copy.params[0])).toBe(copy.params[0].label);
  });
});
