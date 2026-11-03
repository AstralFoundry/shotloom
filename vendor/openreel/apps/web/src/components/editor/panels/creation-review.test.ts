import { afterEach, describe, it, expect } from "vitest";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { IDENTITY_TRANSFORM } from "@openreel/core/creation/index";
import type {
  CreationAssetRecipe,
  CreationProjectState,
  CreationScene,
  CreationSceneObject,
} from "@openreel/core/creation/index";
import type {
  MotionComposition,
  MotionLayer,
  MotionScene3DLayer,
} from "@openreel/core/motion/types";
import { reviewCreationState } from "./creation-review";

function asset(id: string, dirtyCache = false): CreationAssetRecipe {
  return {
    id,
    name: id,
    kind: "prop",
    seed: `${id}-seed`,
    parameters: {},
    nodes: [],
    materials: [{ id: `${id}-mat`, name: "Mat", model: "pbr", baseColor: "#ffffff" }],
    dependencies: [],
    caches: dirtyCache
      ? [{ id: `${id}-cache`, kind: "preview-mesh", status: "dirty" }]
      : [],
    createdAt: 0,
    modifiedAt: 0,
  };
}

function object(id: string, assetId: string, materialId?: string): CreationSceneObject {
  return {
    id,
    name: id,
    assetId,
    materialId,
    transform: IDENTITY_TRANSFORM,
    visible: true,
    selectable: true,
    tags: [],
  };
}

function scene(partial: Partial<CreationScene> & { id: string }): CreationScene {
  return {
    name: partial.id,
    duration: 4,
    frameRate: 30,
    objects: [],
    cameras: [],
    lights: [],
    animations: [],
    environment: { kind: "studio" },
    renderBindings: [],
    createdAt: 0,
    modifiedAt: 0,
    ...partial,
  };
}

function state(scenes: CreationScene[], assets: CreationAssetRecipe[]): CreationProjectState {
  return {
    version: "0.1.0",
    assets,
    scenes,
    activeSceneId: scenes[0]?.id,
    operationHistory: [],
  };
}

function motionComposition(
  id: string,
  layers: MotionLayer[] = [scene3dLayer("layer")],
): MotionComposition {
  return {
    id,
    name: id,
    width: 1920,
    height: 1080,
    frameRate: 30,
    duration: 4,
    backgroundColor: "#000000",
    layers,
    assets: [],
    variables: [],
    markers: [],
    createdAt: 0,
    modifiedAt: 0,
  };
}

function scene3dLayer(id: string): MotionScene3DLayer {
  return {
    id,
    type: "scene3d",
    name: id,
    startTime: 0,
    duration: 4,
    visible: true,
    locked: false,
    transform: {
      position: { x: 960, y: 540 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      anchor: { x: 0.5, y: 0.5 },
      opacity: 1,
    },
    keyframes: [],
    object: { kind: "box" },
  };
}

function nonSceneLayer(id: string): MotionLayer {
  return {
    id,
    type: "null",
    name: id,
    startTime: 0,
    duration: 4,
    visible: true,
    locked: false,
    transform: {
      position: { x: 960, y: 540 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      anchor: { x: 0.5, y: 0.5 },
      opacity: 1,
    },
    keyframes: [],
  };
}

describe("reviewCreationState", () => {
  it("reports unavailable when there is no creation state", () => {
    expect(reviewCreationState(undefined).available).toBe(false);
  });

  it("marks a well-formed scene as ok with no errors", () => {
    const review = reviewCreationState(healthyCreationState(), [
      motionComposition("comp"),
    ]);
    expect(review.available).toBe(true);
    expect(review.scenes[0]?.ok).toBe(true);
    expect(review.scenes[0]?.issues.some((issue) => issue.severity === "error")).toBe(false);
  });

  it("flags stale render bindings whose Motion composition or scene3d layer is missing", () => {
    const missingComposition = reviewCreationState(healthyCreationState(), []);
    expect(missingComposition.scenes[0]?.ok).toBe(false);
    expect(missingComposition.scenes[0]?.issues).toContainEqual(
      expect.objectContaining({ code: "MISSING_RENDER_COMPOSITION", severity: "error" }),
    );

    const missingLayer = reviewCreationState(healthyCreationState(), [
      motionComposition("comp", []),
    ]);
    expect(missingLayer.scenes[0]?.ok).toBe(false);
    expect(missingLayer.scenes[0]?.issues).toContainEqual(
      expect.objectContaining({ code: "MISSING_RENDER_LAYER", severity: "error" }),
    );

    const wrongLayerType = reviewCreationState(healthyCreationState(), [
      motionComposition("comp", [nonSceneLayer("layer")]),
    ]);
    expect(wrongLayerType.scenes[0]?.ok).toBe(false);
    expect(wrongLayerType.scenes[0]?.issues).toContainEqual(
      expect.objectContaining({ code: "MISSING_RENDER_LAYER", severity: "error" }),
    );
  });

  it("flags an empty scene as an error and a missing camera/unbaked mesh as warnings/info", () => {
    const review = reviewCreationState(
      state([scene({ id: "empty" })], []),
    );
    expect(review.scenes[0]?.ok).toBe(false);
    expect(review.scenes[0]?.issues.some((issue) => issue.code === "EMPTY_SCENE")).toBe(true);

    const warned = reviewCreationState(
      state([scene({ id: "s2", objects: [object("o1", "a1", "a1-mat")] })], [asset("a1", true)]),
    );
    const codes = warned.scenes[0]?.issues.map((issue) => issue.code) ?? [];
    expect(codes).toContain("NO_CAMERA");
    expect(codes).toContain("NO_RENDER_BINDING");
    expect(codes).toContain("UNBAKED_MESHES");
  });
});

function healthyCreationState(): CreationProjectState {
  return state(
    [
      scene({
        id: "s1",
        objects: [object("o1", "a1", "a1-mat")],
        cameras: [
          {
            id: "c1",
            name: "C",
            position: { x: 0, y: 0, z: 5 },
            target: { x: 0, y: 0, z: 0 },
            fov: 40,
          },
        ],
        lights: [{ id: "l1", name: "L", kind: "directional", color: "#fff", intensity: 1 }],
        renderBindings: [
          {
            id: "b1",
            kind: "motion-scene3d",
            compositionId: "comp",
            layerId: "layer",
            objectBindings: [{ sceneObjectId: "o1", renderObjectId: "r1" }],
            createdAt: 0,
            modifiedAt: 0,
          },
        ],
      }),
    ],
    [asset("a1")],
  );
}


describe.each(["en-US", "zh-CN"] as const)("creation review messages (%s)", locale => {
  afterEach(() => configureShotloomLocale("en-US"));

  it("localizes diagnostics while preserving names, identifiers and severity", () => {
    configureShotloomLocale(locale);
    const source = healthyCreationState();
    const original = structuredClone(source);
    const missing = reviewCreationState(source).scenes[0]!;
    expect(missing.name).toBe("s1");
    expect(missing.issues).toContainEqual({
      code: "MISSING_RENDER_COMPOSITION", severity: "error",
      message: locale === "zh-CN" ? "绑定的 Motion 合成不存在：comp" : "Bound Motion composition is missing: comp",
    });
    const badLayer = reviewCreationState(source, [motionComposition("comp", [])]).scenes[0]!;
    expect(badLayer.issues[0].message).toBe(locale === "zh-CN" ? "绑定的 Motion scene3d 图层不存在：layer" : "Bound Motion scene3d layer is missing: layer");
    const partial = reviewCreationState(source, [motionComposition("comp")]);
    expect(partial.scenes[0].issues).toEqual([]);
    expect(source).toEqual(original);
    const incompleteScene: CreationScene = {
      ...source.scenes[0],
      renderBindings: [{ ...source.scenes[0].renderBindings[0], objectBindings: [] }],
      animations: [{ id: "clip", name: "Original animation", duration: 4, tracks: [
        { id: "track-object", targetId: "missing-object", channel: "position", keyframes: [] },
        { id: "track-camera", targetId: "missing-camera", channel: "camera.fov", keyframes: [] },
      ] }],
    };
    const incomplete = reviewCreationState(state([incompleteScene], [...source.assets]), [motionComposition("comp")]);
    expect(incomplete.scenes[0].issues).toEqual([
      { code: "PARTIAL_RENDER_BINDING", severity: "warning", message: locale === "zh-CN" ? "已渲染物体：0/1" : "Rendered objects: 0/1" },
      { code: "ORPHAN_ANIMATION", severity: "warning", message: locale === "zh-CN" ? "目标缺失的动画轨道：2" : "Animation tracks with missing targets: 2" },
    ]);

    const name = "My {id} $& object";
    const broken = state([scene({ id: "Custom scene", objects: [{ ...object("o", "missing"), name }] })], []);
    const result = reviewCreationState(broken).scenes[0]!;
    expect(result.issues).toEqual(expect.arrayContaining([
      { code: "MISSING_ASSET", severity: "error", message: locale === "zh-CN" ? `物体 ${name} 引用了缺失的资产` : `Object ${name} references a missing asset` },
      { code: "NO_MATERIAL", severity: "warning", message: locale === "zh-CN" ? `物体 ${name} 没有材质` : `Object ${name} has no material` },
      { code: "NO_RENDER_BINDING", severity: "warning", message: locale === "zh-CN" ? "场景尚未绑定渲染" : "Scene has no render binding" },
      { code: "NO_CAMERA", severity: "warning", message: locale === "zh-CN" ? "场景中没有相机" : "Scene has no camera" },
      { code: "NO_LIGHTS", severity: "info", message: locale === "zh-CN" ? "使用默认光照" : "Using default lighting" },
    ]));
    const empty = reviewCreationState(state([scene({ id: "empty" })], []));
    expect(empty.scenes[0].issues[0].message).toBe(locale === "zh-CN" ? "场景中没有物体" : "Scene has no objects");
    const dirty = reviewCreationState(state([scene({ id: "dirty", objects: [object("o", "a")] })], [asset("a", true)]));
    expect(dirty.scenes[0].issues).toContainEqual({ code: "UNBAKED_MESHES", severity: "info", message: locale === "zh-CN" ? "待烘焙资产：1" : "Assets needing baking: 1" });
  });
});
