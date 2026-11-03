import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configureShotloomLocale } from "../shotloom-mode";
import type { MotionComposition, Project } from "@openreel/core";
import type { CreationProjectState, CreationScene } from "@openreel/core/creation/index";
import {
  findRecoverableScene3DLayers,
  planRecoverMotionScene3DLayer,
} from "./creation-recovery";

function composition(): MotionComposition {
  return {
    id: "comp-moon",
    name: "Moon Scene",
    width: 1920,
    height: 1080,
    duration: 5,
    frameRate: 30,
    backgroundColor: "#020617",
    layers: [
      {
        id: "layer-astronaut",
        type: "scene3d",
        name: "Astronaut Render",
        startTime: 0,
        duration: 5,
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
        lighting: { environment: "dark", ambient: 0.4, keyIntensity: 2 },
        camera: {
          position: { x: 0, y: 2.5, z: 8 },
          target: { x: 0, y: 1, z: 0 },
          fov: 32,
        },
        objects: [
          {
            id: "render-astronaut",
            name: "Astronaut",
            object: { kind: "model", modelUrl: "file:///astronaut.glb", size: 0.8 },
            material: { color: "#f8fafc", roughness: 0.5 },
            transform3d: {
              position: { x: 0, y: 0.85, z: 0 },
              rotation: { x: 0, y: 18, z: 0 },
              scale: { x: 1.2, y: 1.2, z: 1.2 },
            },
          },
          {
            id: "render-flag",
            name: "Ghana Flag",
            object: { kind: "text3d", text: "GHANA", extrude: 0.08 },
            material: { color: "#22c55e", metalness: 0.1, roughness: 0.35 },
            transform3d: {
              position: { x: 1.2, y: 1.4, z: 0 },
              rotation: { x: 0, y: -12, z: 0 },
              scale: { x: 0.8, y: 0.8, z: 0.8 },
            },
          },
        ],
      },
    ],
    assets: [],
    variables: [],
    markers: [],
    createdAt: 1,
    modifiedAt: 1,
  };
}

function project(creation?: CreationProjectState): Project {
  return {
    id: "project-1",
    name: "Project",
    createdAt: 1,
    modifiedAt: 1,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    mediaLibrary: { items: [] },
    timeline: { tracks: [], duration: 0 } as unknown as Project["timeline"],
    motionCompositions: [composition()],
    motionInstances: [],
    creation,
  };
}

function boundCreation(scene: CreationScene): CreationProjectState {
  return {
    version: "0.1.0",
    assets: [],
    scenes: [scene],
    activeSceneId: scene.id,
    operationHistory: [],
  };
}

describe.each(["en-US", "zh-CN"] as const)("creation scene3d recovery (%s)", (locale) => {
  beforeEach(() => configureShotloomLocale(locale));
  afterEach(() => configureShotloomLocale("en-US"));
  it("finds render-only multi-object scene3d layers", () => {
    const recoverable = findRecoverableScene3DLayers(undefined, [composition()]);

    expect(recoverable).toEqual([
      {
        compositionId: "comp-moon",
        compositionName: "Moon Scene",
        layerId: "layer-astronaut",
        layerName: "Astronaut Render",
        objectCount: 2,
        duration: 5,
      },
    ]);
  });

  it("plans creation assets, scene objects, and render bindings from a scene3d layer", () => {
    const plan = planRecoverMotionScene3DLayer(
      project(),
      "comp-moon",
      "layer-astronaut",
      123,
    );

    expect("error" in plan).toBe(false);
    if ("error" in plan) return;

    expect(plan.operations.map((operation) => operation.type)).toEqual([
      "asset/upsert",
      "asset/upsert",
      "scene/upsert",
      "scene/set-active",
    ]);
    expect(plan.assets).toHaveLength(2);
    expect(plan.scene.objects).toHaveLength(2);
    expect(plan.scene.cameras[0]).toMatchObject({
      position: { x: 0, y: 2.5, z: 8 },
      target: { x: 0, y: 1, z: 0 },
      fov: 32,
    });
    expect(plan.scene.environment.kind).toBe("space");

    const astronaut = plan.scene.objects.find((object) => object.name === "Astronaut");
    expect(astronaut?.transform).toEqual({
      position: { x: 0, y: 0.85, z: 0 },
      rotation: { x: 0, y: 18, z: 0 },
      scale: { x: 1.2, y: 1.2, z: 1.2 },
    });

    expect(plan.scene.renderBindings[0]?.objectBindings).toEqual([
      {
        sceneObjectId: astronaut?.id,
        renderObjectId: "render-astronaut",
      },
      {
        sceneObjectId: plan.scene.objects[1]?.id,
        renderObjectId: "render-flag",
      },
    ]);
    expect(plan.assets[0]?.dependencies[0]).toMatchObject({
      kind: "mesh",
      uri: "file:///astronaut.glb",
    });
  });

  it("does not offer recovery after the layer has a creation binding", () => {
    const plan = planRecoverMotionScene3DLayer(
      project(),
      "comp-moon",
      "layer-astronaut",
      123,
    );
    if ("error" in plan) throw new Error(plan.error);

    const creation = boundCreation(plan.scene);
    expect(findRecoverableScene3DLayers(creation, [composition()])).toHaveLength(0);
    expect(
      planRecoverMotionScene3DLayer(
        project(creation),
        "comp-moon",
        "layer-astronaut",
        124,
      ),
    ).toEqual({ error: locale === "zh-CN" ? "三维图层已绑定到创作场景" : "Scene3D layer is already bound to a Creation scene" });
  });
  it("localizes missing recovery targets and empty layers", () => {
    const id = "合成 {id} $&";
    expect(planRecoverMotionScene3DLayer(project(), id, id)).toEqual({
      error: locale === "zh-CN" ? `找不到动画合成：${id}` : `Motion composition not found: ${id}`,
    });
    expect(planRecoverMotionScene3DLayer(project(), "comp-moon", id)).toEqual({
      error: locale === "zh-CN" ? `找不到三维场景图层：${id}` : `Motion scene3d layer not found: ${id}`,
    });
    const original = project();
    const empty = { ...original, motionCompositions: original.motionCompositions!.map(comp => ({
      ...comp, layers: comp.layers.map(layer => layer.type === "scene3d" ? { ...layer, objects: [] } : layer),
    })) };
    expect(planRecoverMotionScene3DLayer(empty, "comp-moon", "layer-astronaut")).toEqual({
      error: locale === "zh-CN" ? "三维图层中没有可恢复的场景对象" : "Scene3D layer has no recoverable scene objects",
    });
  });

  it("localizes newly recovered names and history while keeping user names, IDs and bindings stable", () => {
    const original = project();
    const customName = "用户 {name} $&";
    const source = { ...original, motionCompositions: original.motionCompositions!.map(comp => ({
      ...comp, name: "", layers: comp.layers.map(layer => layer.type === "scene3d" ? {
        ...layer, name: "", objects: layer.objects!.map((object, index) => ({
          ...object, name: index === 0 ? customName : undefined,
        })),
      } : layer),
    })) };
    const snapshot = JSON.stringify(source);
    const plan = planRecoverMotionScene3DLayer(source, "comp-moon", "layer-astronaut", 456);
    if ("error" in plan) throw new Error(plan.error);
    const objectName = locale === "zh-CN" ? "恢复的对象 2" : "Recovered object 2";
    const sceneName = locale === "zh-CN" ? "恢复的三维场景" : "Recovered 3D Scene";
    expect(plan.scene.name).toBe(sceneName);
    expect(plan.scene.objects.map(object => object.name)).toEqual([customName, objectName]);
    expect(plan.assets.map(asset => asset.name)).toEqual([customName, objectName]);
    expect(plan.assets.map(asset => asset.nodes[0].name)).toEqual([customName, objectName]);
    expect(plan.assets[0].materials[0].name).toBe(locale === "zh-CN" ? `${customName} 材质` : `${customName} material`);
    expect(plan.scene.cameras[0]).toMatchObject({ id: "camera-hero", name: locale === "zh-CN" ? "主摄像机" : "Hero camera" });
    expect(plan.scene.lights.map(light => light.name)).toEqual(locale === "zh-CN" ? ["环境补光", "主光源"] : ["Ambient fill", "Key light"]);
    expect(plan.operations.map(operation => operation.label)).toEqual([
      ...(locale === "zh-CN" ? [`恢复 ${customName}`, `恢复 ${objectName}`, `恢复 ${sceneName}`, `激活 ${sceneName}`]
        : [`Recover ${customName}`, `Recover ${objectName}`, `Recover ${sceneName}`, `Activate ${sceneName}`]),
    ]);
    configureShotloomLocale(locale === "zh-CN" ? "en-US" : "zh-CN");
    const other = planRecoverMotionScene3DLayer(source, "comp-moon", "layer-astronaut", 456);
    if ("error" in other) throw new Error(other.error);
    expect(plan.scene.id).toBe(other.scene.id);
    expect(plan.scene.objects.map(object => object.id)).toEqual(other.scene.objects.map(object => object.id));
    expect(plan.assets.map(asset => asset.id)).toEqual(other.assets.map(asset => asset.id));
    expect(plan.operations.map(operation => operation.id)).toEqual(other.operations.map(operation => operation.id));
    expect(plan.scene.renderBindings).toEqual(other.scene.renderBindings);
    expect(plan.assets.map(asset => asset.dependencies)).toEqual(other.assets.map(asset => asset.dependencies));
    expect(plan.scene.name).toBe(sceneName);
    expect(JSON.stringify(source)).toBe(snapshot);
  });

});
