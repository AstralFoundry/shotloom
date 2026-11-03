import { configureShotloomLocale } from "../../../shotloom-mode";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, within } from "@testing-library/react";
import { Scene3DInspector } from "./Scene3DInspector";
import type { MotionScene3DLayer } from "@openreel/core";

const baseLayer = {
  id: "L1",
  type: "scene3d",
  name: "3D Scene",
  startTime: 0,
  duration: 5,
  visible: true,
  locked: false,
  transform: {},
  keyframes: [],
  object: { kind: "rounded-box" },
  objects: [
    {
      id: "o1",
      name: "Object 1",
      object: { kind: "rounded-box" },
      material: { color: "#10b981" },
      transform3d: {},
    },
  ],
  camera: { fov: 35 },
} as unknown as MotionScene3DLayer;

describe.each(["en-US", "zh-CN"] as const)("Scene3DInspector (%s)", locale => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => configureShotloomLocale(locale));
  afterEach(() => { cleanup(); configureShotloomLocale("en-US"); });
  it("adds an object and changes the active object's kind", () => {
    const replaceLayer = vi.fn();
    const view = render(<Scene3DInspector layer={baseLayer} replaceLayer={replaceLayer} />);

    fireEvent.click(screen.getByRole("button", { name: ui("Add object", "添加对象") }));
    expect(replaceLayer).toHaveBeenCalled();
    const added = replaceLayer.mock.calls.at(-1)![0] as MotionScene3DLayer;
    expect(added.objects?.length).toBe(2);
    expect(added.objects?.[0].name).toBe("Object 1");
    expect(added.objects?.[1].name).toBe(ui("Object 2", "对象 2"));
    view.rerender(<Scene3DInspector layer={added} replaceLayer={replaceLayer} />);
    expect(screen.getByRole("option", { name: ui("Rounded box", "圆角立方体") })).toHaveValue("rounded-box");

    fireEvent.click(screen.getByRole("button", { name: ui("Object 2", "对象 2") }));
    fireEvent.change(screen.getByLabelText(ui("Geometry kind", "几何体类型")), {
      target: { value: "sphere" },
    });
    const changed = replaceLayer.mock.calls.at(-1)![0] as MotionScene3DLayer;
    expect(changed.objects?.[1].object.kind).toBe("sphere");
    view.rerender(<Scene3DInspector layer={changed} replaceLayer={replaceLayer} />);
    fireEvent.click(screen.getByRole("button", { name: ui("Remove Object 2", "移除 对象 2") }));
    expect((replaceLayer.mock.calls.at(-1)![0] as MotionScene3DLayer).objects).toEqual(baseLayer.objects);
  });

  it("preserves user object names and model URLs", () => {
    const replaceLayer = vi.fn();
    const name = "Geometry {name} 用户";
    const layer = { ...baseLayer, objects: [{ ...baseLayer.objects![0], name, object: { kind: "model" as const, modelUrl: "https://example.com/Model.glb?q={keep}" } }] };
    render(<Scene3DInspector layer={layer} replaceLayer={replaceLayer} />);
    expect(screen.getByRole("button", { name })).toHaveAttribute("data-shotloom-user-content");
    const input = screen.getByPlaceholderText("https://…/model.glb");
    expect(input).toHaveValue("https://example.com/Model.glb?q={keep}");
    fireEvent.change(input, { target: { value: "https://example.com/New.gltf" } });
    const changed = replaceLayer.mock.calls.at(-1)![0] as MotionScene3DLayer;
    expect(changed.objects?.[0].name).toBe(name);
    expect(changed.objects?.[0].object.modelUrl).toBe("https://example.com/New.gltf");
  });

  it("edits material color, transform, and camera fov", () => {
    const replaceLayer = vi.fn();
    render(<Scene3DInspector layer={baseLayer} replaceLayer={replaceLayer} />);

    const colorGroup = screen.getByRole("group", { name: ui("Material color", "材质颜色") });
    fireEvent.change(within(colorGroup).getByRole("textbox"), {
      target: { value: "#ff0000" },
    });
    expect(
      (replaceLayer.mock.calls.at(-1)![0] as MotionScene3DLayer).objects?.[0]
        .material?.color,
    ).toBe("#ff0000");

    const fovGroup = screen.getByRole("group", { name: ui("Camera FOV", "相机视野角度") });
    fireEvent.change(within(fovGroup).getByRole("spinbutton"), {
      target: { value: "50" },
    });
    expect(
      (replaceLayer.mock.calls.at(-1)![0] as MotionScene3DLayer).camera?.fov,
    ).toBe(50);
  });
});
