import { afterEach, describe, expect, it } from "vitest";
import { MOTION_PRESETS } from "@openreel/core";
import { configureShotloomLocale } from "../shotloom-mode";
import { createLocalizedMotionPreset } from "./motion-preset-localization";

// Ignore display defaults and generated identifiers when comparing rendering data.
function renderingData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(renderingData);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) =>
    !["id", "name", "text", "createdAt", "modifiedAt"].includes(key),
  ).map(([key, item]) => [key, renderingData(item)]));
}

describe.each(["en-US", "zh-CN"] as const)("stock template defaults (%s)", locale => {
  afterEach(() => configureShotloomLocale("en-US"));
  it.each(MOTION_PRESETS)("localizes $id without changing render data or variable bindings", preset => {
    configureShotloomLocale(locale);
    const original = preset.create();
    const created = createLocalizedMotionPreset(preset.id)!;
    expect(created.layers).toHaveLength(original.layers.length);
    expect(created.variables.map(v => [v.id, v.type])).toEqual(original.variables.map(v => [v.id, v.type]));
    expect(created.layers.map(renderingData)).toEqual(original.layers.map(renderingData));
    expect([created.width, created.height, created.duration, created.frameRate, created.backgroundColor]).toEqual([
      original.width, original.height, original.duration, original.frameRate, original.backgroundColor,
    ]);
    for (const [index, layer] of created.layers.entries()) {
      expect(layer.name).toBeTruthy();
      if (locale === "zh-CN") expect(layer.name).not.toBe(original.layers[index].name);
      else expect(layer.name).toBe(original.layers[index].name);
      if (layer.type === "text") {
        const binding = layer.variableBindings?.find(b => b.target === "text.content");
        if (binding) expect(layer.text).toBe(created.variables.find(v => v.id === binding.variableId)?.value);
      }
    }
    for (const [index, variable] of created.variables.entries()) {
      if (variable.type === "color") expect(variable.value).toBe(original.variables[index].value);
      if (locale === "zh-CN") expect(variable.name).not.toBe(original.variables[index].name);
    }
    // Factory defaults remain unchanged for upstream callers and future instantiations.
    expect(preset.create().layers.map(renderingData)).toEqual(original.layers.map(renderingData));
  });
  it("preserves an explicit user name and does not rewrite a previously created template", () => {
    configureShotloomLocale("en-US");
    const original = createLocalizedMotionPreset("motion-ad-card", "My {name} 广告")!;
    const edited = { ...original, layers: original.layers.map((layer, index) => index === 0 ? { ...layer, name: "Brand Wash 用户版本" } : layer) };
    configureShotloomLocale(locale);
    const created = createLocalizedMotionPreset("motion-ad-card", "My {name} 广告")!;
    expect(created.name).toBe("My {name} 广告");
    expect(original.name).toBe("My {name} 广告");
    expect(edited.layers[0].name).toBe("Brand Wash 用户版本");
    expect(original.variables.find(v => v.id === "headline")?.value).toBe("Launch faster");
    expect(created.variables.find(v => v.id === "headline")?.value).toBe(locale === "zh-CN" ? "更快发布" : "Launch faster");
  });
});
