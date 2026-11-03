import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { MotionComposition, MotionLayer, MotionScene3DLayer } from "@openreel/core";
import { configureShotloomLocale } from "../../shotloom-mode";
import { DEFAULT_MOTION_TRANSFORM, createMotionEffect } from "@openreel/core";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { resetFrameCacheState } from "../frame-cache-state";
import { MotionTimeline } from "./MotionTimeline";

function layerWithScaleKeyframe(): MotionLayer {
  return {
    id: "layer-scale",
    type: "shape",
    name: "Accent Bar",
    startTime: 0,
    duration: 2,
    visible: true,
    locked: false,
    transform: DEFAULT_MOTION_TRANSFORM,
    keyframes: [
      {
        id: "kf-scale",
        property: "transform.scale.x",
        time: 0.5,
        value: 1,
        easing: "linear",
      },
    ],
    shapeType: "rectangle",
    width: 320,
    height: 180,
    style: {
      fill: { type: "solid", color: "#14b8a6", opacity: 1 },
      stroke: { color: "#0f766e", width: 0, opacity: 0 },
      cornerRadius: 12,
    },
  } as unknown as MotionLayer;
}

function composition(): MotionComposition {
  return {
    id: "comp-marker",
    name: "Comp",
    width: 1920,
    height: 1080,
    frameRate: 30,
    duration: 2,
    backgroundColor: "transparent",
    layers: [layerWithScaleKeyframe()],
    assets: [],
    variables: [],
    markers: [],
    createdAt: 1,
    modifiedAt: 1,
  } as MotionComposition;
}

async function seed(comp: MotionComposition): Promise<void> {
  useProjectStore.setState({ project: createEmptyProject("Marker") });
  useProjectStore.getState().actionExecutor.getHistory().clear();
  await useProjectStore.getState().upsertMotionComposition(comp);
}

describe.each(["en-US", "zh-CN"] as const)("MotionTimeline keyframe markers in %s", locale => {
  beforeEach(() => {
    configureShotloomLocale(locale);
    resetFrameCacheState();
  });

  afterEach(() => {
    configureShotloomLocale("en-US");
    cleanup();
    resetFrameCacheState();
  });

  it("renders keyframe markers as icons, not as visible property-name text", async () => {
    const comp = composition();
    await seed(comp);

    const { container } = render(<MotionTimeline composition={comp} />);

    let markers: HTMLElement[] = [];
    await waitFor(() => {
      markers = Array.from(
        container.querySelectorAll<HTMLElement>("button.rotate-45"),
      );
      expect(markers.length).toBeGreaterThan(0);
    });

    for (const marker of markers) {
      expect(marker.getAttribute("aria-label")).toBeTruthy();
      expect((marker.textContent ?? "").trim()).toBe("");
    }
  });
  it("uses translated dynamic effect labels on real timeline keyframe buttons", async () => {
    const comp = composition();
    const base = comp.layers[0];
    const effect = { ...createMotionEffect("blur", "effect-test"), name: "效果 {name} $&" };
    const dynamic = { ...base, effects: [effect], keyframes: [{
      id: "effect-frame", property: "effect.effect-test.radius" as const, time: 0.5, value: 12, easing: "linear" as const,
    }] };
    const source = { ...comp, layers: [dynamic] };
    await seed(source);
    render(<MotionTimeline composition={source} />);
    const label = locale === "zh-CN" ? "效果 {name} $& 半径" : "效果 {name} $& Radius";
    await waitFor(() => expect(screen.getAllByRole("button", { name: label }).length).toBeGreaterThan(0));
    expect(source.layers[0].keyframes[0]).toMatchObject({ id: "effect-frame", property: "effect.effect-test.radius", value: 12 });
  });

  it("shows the actual scene object name with localized keyframe fields", async () => {
    const comp = composition();
    const scene: MotionScene3DLayer = { ...comp.layers[0], type: "scene3d", object: { kind: "box" },
      objects: [{ id: "object-1", name: "箱子 {name} $&", object: { kind: "box" } }],
      keyframes: [{ id: "object-frame", property: "scene.object.object-1.opacity", time: 0.5, value: 0.5, easing: "linear" }],
    };
    const source = { ...comp, layers: [scene] };
    await seed(source);
    render(<MotionTimeline composition={source} />);
    const label = locale === "zh-CN" ? "箱子 {name} $& 不透明度" : "箱子 {name} $& Opacity";
    await waitFor(() => expect(screen.getAllByRole("button", { name: label }).length).toBeGreaterThan(0));
    expect(source.layers[0].keyframes[0]).toMatchObject({ id: "object-frame", property: "scene.object.object-1.opacity", value: 0.5 });
  });

  it("renders localized shape-content labels on actual timeline buttons", async () => {
    const comp = composition();
    const base = layerWithScaleKeyframe();
    if (base.type !== "shape") throw new Error("Expected shape fixture");
    const shape = { ...base, contents: [{ kind: "group" as const, id: "group-1", name: "组 {name} $&",
      transform: { anchor: { x: 0, y: 0 }, position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1 }, items: [],
    }], keyframes: [{ id: "contents-frame", property: "contents.group-1.transform.rotation" as const, time: 0.5, value: 45, easing: "linear" as const }] };
    const source = { ...comp, layers: [shape] };
    await seed(source);
    render(<MotionTimeline composition={source} />);
    const label = locale === "zh-CN" ? "组 {name} $& › 旋转" : "组 {name} $& › Rotation";
    await waitFor(() => expect(screen.getAllByRole("button", { name: label }).length).toBeGreaterThan(0));
    expect(source.layers[0].keyframes[0]).toMatchObject({ property: "contents.group-1.transform.rotation", value: 45 });
  });

});
