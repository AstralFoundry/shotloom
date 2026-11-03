import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_MOTION_TRANSFORM,
  MOTION_EFFECT_PRESETS,
  MOTION_SHAPE_MODIFIER_PRESETS,
  MOTION_SCENE_CAMERA_PROPERTY_NAMES,
  MOTION_SCENE_OBJECT_PROPERTY_NAMES,
  getMotionLayerShapeModifierPropertyDescriptors,
  getMotionLayerContentsPropertyDescriptors,
  type MotionShapeGroupItem,
  type MotionScene3DLayer,
  getMotionLayerEffectPropertyDescriptors,
  getMotionLayerMaskPropertyDescriptors,
  getMotionLayerPuppetPropertyDescriptors,
  type MotionShapeLayer,
} from "@openreel/core";
import { configureShotloomLocale } from "../shotloom-mode";
import { motionPropertyLabel } from "./motion-layer-labels";
import { getGraphEditorAvailableProperties } from "./components/GraphEditorPanel";

function layer(): MotionShapeLayer {
  return {
    id: "shape", type: "shape", name: "用户图层", startTime: 0, duration: 2,
    visible: true, locked: false, transform: DEFAULT_MOTION_TRANSFORM, keyframes: [],
    shapeType: "rectangle", width: 100, height: 100,
    style: { fill: { type: "solid", color: "#fff", opacity: 1 }, stroke: { color: "#000", width: 0, opacity: 1 }, cornerRadius: 0 },
    masks: [{ id: "mask-1", name: "用户 {name} $&", enabled: true, shape: "path", mode: "add", inverted: false, x: 0, y: 0, width: 1, height: 1, rotation: 0, expansion: 0, feather: 0, opacity: 1 }],
    puppetPins: [{ id: "pin-1", name: "控制点 {name} $&", bindPosition: { x: 0, y: 0 }, position: { x: 1, y: 2 }, radius: 20, strength: 1, enabled: true }],
  };
}

describe.each(["en-US", "zh-CN"] as const)("Motion property labels in %s", locale => {
  beforeEach(() => configureShotloomLocale(locale));
  afterEach(() => configureShotloomLocale("en-US"));

  it("translates mask and puppet fields while preserving names and source data", () => {
    const source = layer();
    const snapshot = JSON.stringify(source);
    const descriptors = [...getMotionLayerMaskPropertyDescriptors(source), ...getMotionLayerPuppetPropertyDescriptors(source)];
    const labels = descriptors.map(item => motionPropertyLabel(item.property, item.label, source));
    expect(labels).toEqual(locale === "zh-CN" ? [
      "用户 {name} $& X", "用户 {name} $& Y", "用户 {name} $& 宽度", "用户 {name} $& 高度", "用户 {name} $& 旋转", "用户 {name} $& 扩展", "用户 {name} $& 羽化", "用户 {name} $& 不透明度", "用户 {name} $& 路径",
      "控制点 {name} $& 位置 X", "控制点 {name} $& 位置 Y", "控制点 {name} $& 半径", "控制点 {name} $& 强度",
    ] : descriptors.map(item => item.label));
    const graph = getGraphEditorAvailableProperties(source);
    expect(graph.find(item => item.property === "mask.mask-1.feather")?.label).toBe(locale === "zh-CN" ? "用户 {name} $& 羽化" : "用户 {name} $& Feather");
    expect(graph.some(item => item.property === "mask.mask-1.path")).toBe(false);
    expect(JSON.stringify(source)).toBe(snapshot);
  });

  it.each(MOTION_EFFECT_PRESETS.filter(preset => preset.type !== "shader"))("translates the registered $type parameters without altering effects", preset => {
    const effect = { ...preset.create("effect-1"), name: "自定义 {name} $&" };
    const source = { ...layer(), effects: [effect] };
    const snapshot = JSON.stringify(source);
    const descriptors = getMotionLayerEffectPropertyDescriptors(source);
    expect(descriptors.length).toBeGreaterThan(0);
    for (const descriptor of descriptors) {
      const label = motionPropertyLabel(descriptor.property, descriptor.label, source);
      expect(label.startsWith("自定义 {name} $& ")).toBe(true);
      if (locale === "en-US") expect(label).toBe(descriptor.label);
      else expect(label).not.toBe(descriptor.label);
      expect(getGraphEditorAvailableProperties(source).find(item => item.property === descriptor.property)?.label).toBe(label);
    }
    expect(JSON.stringify(source)).toBe(snapshot);
  });

  it("keeps unknown and missing-target labels opaque", () => {
    const name = "Plugin label {name} $&";
    expect(motionPropertyLabel("effect.missing.radius", name, layer())).toBe(name);
    expect(motionPropertyLabel("extension.custom", name, layer())).toBe(name);
    expect(motionPropertyLabel("extension.custom", undefined, layer())).toBe("extension.custom");
    expect(motionPropertyLabel(null, name, layer())).toBe(name);
    expect(motionPropertyLabel("__proto__", name, layer())).toBe(name);
    expect(motionPropertyLabel("toString", name, layer())).toBe(name);
  });
  it.each(MOTION_SHAPE_MODIFIER_PRESETS)("translates registered $type modifier fields and preserves descriptor metadata", preset => {
    const modifier = { ...preset.create("modifier-1"), name: "修改器 {name} $&" };
    const source = { ...layer(), modifiers: [modifier] };
    const snapshot = JSON.stringify(source);
    const descriptors = getMotionLayerShapeModifierPropertyDescriptors(source);
    const graph = getGraphEditorAvailableProperties(source);
    expect(descriptors.length).toBeGreaterThan(0);
    for (const descriptor of descriptors) {
      const label = motionPropertyLabel(descriptor.property, descriptor.label, source);
      expect(label.startsWith("修改器 {name} $& ")).toBe(true);
      if (locale === "en-US") expect(label).toBe(descriptor.label);
      else expect(label).not.toBe(descriptor.label);
      expect(graph.find(item => item.property === descriptor.property)).toEqual({ ...descriptor, label });
    }
    expect(JSON.stringify(source)).toBe(snapshot);
  });

  it("translates all scene camera and object fields using the real object name", () => {
    const source: MotionScene3DLayer = { ...layer(), type: "scene3d", object: { kind: "box" }, objects: [
      { id: "object-1", name: "物体 {name} $&", object: { kind: "box" } },
      { id: "unnamed", object: { kind: "box" } },
    ] };
    const snapshot = JSON.stringify(source);
    expect(MOTION_SCENE_CAMERA_PROPERTY_NAMES.map(field => motionPropertyLabel(`scene.camera.${field}`, "fallback", source))).toEqual(locale === "zh-CN" ? [
      "摄像机位置 X", "摄像机位置 Y", "摄像机位置 Z", "摄像机目标 X", "摄像机目标 Y", "摄像机目标 Z", "摄像机视野角度", "摄像机近裁剪面", "摄像机远裁剪面",
    ] : ["Camera Position X", "Camera Position Y", "Camera Position Z", "Camera Target X", "Camera Target Y", "Camera Target Z", "Camera Field of View", "Camera Near Plane", "Camera Far Plane"]);
    expect(MOTION_SCENE_OBJECT_PROPERTY_NAMES.map(field => motionPropertyLabel(`scene.object.object-1.${field}`, "fallback", source))).toEqual((locale === "zh-CN" ? [
      "位置 X", "位置 Y", "位置 Z", "旋转 X", "旋转 Y", "旋转 Z", "缩放 X", "缩放 Y", "缩放 Z", "不透明度", "盖子角度",
    ] : ["Position X", "Position Y", "Position Z", "Rotation X", "Rotation Y", "Rotation Z", "Scale X", "Scale Y", "Scale Z", "Opacity", "Lid Angle"]).map(label => `物体 {name} $& ${label}`));
    expect(motionPropertyLabel("scene.object.unnamed.opacity", "fallback", source)).toBe(locale === "zh-CN" ? "unnamed 不透明度" : "unnamed Opacity");
    expect(motionPropertyLabel("scene.object.missing.opacity", "Missing object label", source)).toBe("Missing object label");
    expect(motionPropertyLabel("modifier.missing.angle", "Missing modifier label", source)).toBe("Missing modifier label");
    expect(JSON.stringify(source)).toBe(snapshot);
  });

  it("translates nested group transforms and paths with exact user names", () => {
    const group: MotionShapeGroupItem = { kind: "group", id: "group-1", name: "组 {name} $&",
      transform: { anchor: { x: 0, y: 0 }, position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1 },
      items: [{ kind: "path", id: "path-1", name: "路径 {name} $&", shapeType: "rectangle", width: 100, height: 100, position: { x: 0, y: 0 } }],
    };
    const source = { ...layer(), contents: [{ ...group, id: "outer", name: "Outer", items: [group] }] };
    const snapshot = JSON.stringify(source);
    const descriptors = getMotionLayerContentsPropertyDescriptors(source);
    expect(descriptors.filter(item => item.property.startsWith("contents.group-1.transform.")).map(item => motionPropertyLabel(item.property, item.label, source))).toEqual(
      (locale === "zh-CN" ? ["位置 X", "位置 Y", "缩放 X", "缩放 Y", "旋转", "不透明度"]
        : ["Position X", "Position Y", "Scale X", "Scale Y", "Rotation", "Opacity"]).map(label => `组 {name} $& › ${label}`),
    );
    expect(motionPropertyLabel("contents.path-1.pathData", "fallback", source)).toBe(locale === "zh-CN" ? "路径 {name} $& › 路径" : "路径 {name} $& › Path");
    expect(motionPropertyLabel("contents.missing.pathData", "Original extension label", source)).toBe("Original extension label");
    const graph = getGraphEditorAvailableProperties(source);
    for (const descriptor of descriptors) {
      expect(graph.find(item => item.property === descriptor.property)).toEqual({
        ...descriptor, label: motionPropertyLabel(descriptor.property, descriptor.label, source),
      });
    }
    expect(JSON.stringify(source)).toBe(snapshot);
  });

  it.each(MOTION_SHAPE_MODIFIER_PRESETS)("translates nested $type operator fields without changing their numeric descriptors", preset => {
    const operator = { ...preset.create("operator-1"), name: "操作器 {name} $&" };
    const group: MotionShapeGroupItem = { kind: "group", id: "group-1", name: "组 {name} $&",
      transform: { anchor: { x: 0, y: 0 }, position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1 },
      items: [], operators: [operator],
    };
    const source = { ...layer(), contents: [group] };
    const snapshot = JSON.stringify(source);
    const descriptors = getMotionLayerContentsPropertyDescriptors(source).filter(item => item.property.startsWith("contents.group-1.operator."));
    const graph = getGraphEditorAvailableProperties(source);
    expect(descriptors.length).toBeGreaterThan(0);
    for (const descriptor of descriptors) {
      const label = motionPropertyLabel(descriptor.property, descriptor.label, source);
      expect(label.startsWith("组 {name} $& › 操作器 {name} $& ")).toBe(true);
      if (locale === "zh-CN") expect(label).not.toBe(descriptor.label);
      expect(graph.find(item => item.property === descriptor.property)).toEqual({ ...descriptor, label });
    }
    expect(motionPropertyLabel("contents.group-1.operator.missing.angle", "Missing operator", source)).toBe("Missing operator");
    expect(motionPropertyLabel("contents.group-1.operator.operator-1.extension", "Extension parameter", source)).toBe("Extension parameter");
    expect(JSON.stringify(source)).toBe(snapshot);
  });

});
