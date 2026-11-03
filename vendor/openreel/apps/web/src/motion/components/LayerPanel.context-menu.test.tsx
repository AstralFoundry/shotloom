import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  DEFAULT_MOTION_TRANSFORM,
  type MotionComposition,
  type MotionShapeLayer,
} from "@openreel/core";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useMotionStore } from "../stores/motion-store";
import { configureShotloomLocale } from "../../shotloom-mode";
import { LayerPanel } from "./LayerPanel";

function shapeLayer(id: string, name: string): MotionShapeLayer {
  return {
    id,
    type: "shape",
    name,
    startTime: 0,
    duration: 5,
    visible: true,
    locked: false,
    transform: DEFAULT_MOTION_TRANSFORM,
    keyframes: [],
    shapeType: "rectangle",
    width: 240,
    height: 120,
    style: {
      fill: { type: "solid", color: "#8b5cf6", opacity: 1 },
      stroke: { color: "#ffffff", width: 0, opacity: 1 },
    },
  };
}

function composition(): MotionComposition {
  return {
    id: "layer-panel-comp",
    name: "Layer Panel Comp",
    width: 1920,
    height: 1080,
    frameRate: 30,
    duration: 5,
    backgroundColor: "transparent",
    layers: [
      shapeLayer("layer-one", "Layer One"),
      shapeLayer("layer-two", "Layer Two"),
    ],
    assets: [],
    variables: [],
    markers: [],
    createdAt: 1,
    modifiedAt: 1,
  };
}

function storedComposition(): MotionComposition {
  const stored = (useProjectStore.getState().project.motionCompositions ?? []).find(
    (candidate) => candidate.id === "layer-panel-comp",
  );
  if (!stored) throw new Error("layer panel composition missing");
  return stored;
}

describe.each(["en-US", "zh-CN"] as const)("LayerPanel contextual layer workflow in %s", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => {
    configureShotloomLocale(locale);
    useProjectStore.setState({
      hasOpenProject: true,
      project: {
        ...createEmptyProject("Layer panel context menu"),
        motionCompositions: [composition()],
      },
    });
    useMotionStore.setState({
      timelineColumnMode: "switches",
      selectedLayerId: null,
      selectedLayerIds: [],
      selectedKeyframeIds: [],
      playhead: 0,
    });
  });

  afterEach(() => {
    configureShotloomLocale("en-US");
    cleanup();
    useProjectStore.setState({ hasOpenProject: false });
  });

  it("renames a layer inline on double click", async () => {
    render(<LayerPanel composition={composition()} />);

    fireEvent.doubleClick(screen.getByRole("button", { name: ui("Select Layer One", "选择 Layer One") }));
    const input = screen.getByRole("textbox", { name: ui("Rename Layer One", "重命名 Layer One") });
    fireEvent.change(input, { target: { value: "Hero Title" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(storedComposition().layers[0]?.name).toBe("Hero Title");
    });
  });

  it("exposes layer switches with stable names and pressed state", () => {
    render(<LayerPanel composition={composition()} />);

    for (const button of screen.getAllByRole("button", {
      name: ui("Layer visibility", "图层可见性"),
    })) {
      expect(button).toHaveAttribute("aria-pressed", "true");
    }
    for (const name of [ui("Solo layer", "独显图层"), ui("Lock layer", "锁定图层"), ui("Guide layer", "参考图层"), ui("Shy layer", "隐藏标记图层")]) {
      for (const button of screen.getAllByRole("button", { name })) {
        expect(button).toHaveAttribute("aria-pressed", "false");
      }
    }
  });

  it("opens a right-click menu and duplicates the contextual selection", async () => {
    render(<LayerPanel composition={composition()} />);

    fireEvent.contextMenu(
      screen.getByRole("button", { name: ui("Select Layer One", "选择 Layer One") }),
      { clientX: 120, clientY: 160 },
    );

    expect(screen.getByRole("menu", { name: ui("Layer actions", "图层操作") })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ui("Duplicate selection", "复制所选图层") }));

    await waitFor(() => {
      const stored = storedComposition();
      expect(stored.layers).toHaveLength(3);
      expect(stored.layers.some((layer) => layer.name === ui("Layer One Copy", "Layer One 副本"))).toBe(
        true,
      );
      expect(useMotionStore.getState().selectedLayerIds).toHaveLength(1);
    });
  });

  it("preserves a multi-selection and groups it from the context menu", async () => {
    render(<LayerPanel composition={composition()} />);

    fireEvent.click(screen.getByRole("button", { name: ui("Select Layer One", "选择 Layer One") }));
    fireEvent.click(screen.getByRole("button", { name: ui("Select Layer Two", "选择 Layer Two") }), {
      ctrlKey: true,
    });
    fireEvent.contextMenu(
      screen.getByRole("button", { name: ui("Select Layer Two", "选择 Layer Two") }),
      { clientX: 140, clientY: 180 },
    );
    fireEvent.click(screen.getByRole("button", { name: ui("Group selection", "将所选图层编组") }));

    await waitFor(() => {
      const stored = storedComposition();
      const group = stored.layers.find((layer) => layer.type === "group");
      expect(group).toBeDefined();
      expect(group?.name).toBe(ui("Group", "组"));
      expect(
        stored.layers
          .filter((layer) => layer.type === "shape")
          .every((layer) => layer.parentId === group?.id),
      ).toBe(true);
      expect(useMotionStore.getState().selectedLayerIds).toEqual([group?.id]);
    });
  });

  it("applies and clears a label color across the contextual multi-selection", async () => {
    const view = render(<LayerPanel composition={composition()} />);

    fireEvent.click(screen.getByRole("button", { name: ui("Select Layer One", "选择 Layer One") }));
    fireEvent.click(screen.getByRole("button", { name: ui("Select Layer Two", "选择 Layer Two") }), {
      ctrlKey: true,
    });
    fireEvent.contextMenu(
      screen.getByRole("button", { name: ui("Select Layer Two", "选择 Layer Two") }),
      { clientX: 140, clientY: 180 },
    );
    fireEvent.click(screen.getByRole("button", { name: ui("Set layer label Blue", "设置图层标签为蓝色") }));

    await waitFor(() => {
      expect(storedComposition().layers.every((layer) => layer.labelColor === "#5d91d8")).toBe(true);
    });

    view.rerender(<LayerPanel composition={storedComposition()} />);
    fireEvent.contextMenu(
      screen.getByRole("button", { name: ui("Select Layer Two", "选择 Layer Two") }),
      { clientX: 140, clientY: 180 },
    );
    fireEvent.click(screen.getByRole("button", { name: ui("Clear layer label color", "清除图层标签颜色") }));

    await waitFor(() => {
      expect(storedComposition().layers.every((layer) => layer.labelColor === undefined)).toBe(true);
    });
  });

  it("creates localized shape names and enables position keyframes using stable property IDs", async () => {
    const view = render(<LayerPanel composition={composition()} />);
    fireEvent.click(screen.getByRole("button", { name: ui("Layer tools", "图层工具") }));
    fireEvent.click(screen.getByRole("button", { name: ui("Shape layer", "形状图层") }));
    await waitFor(() => expect(storedComposition().layers).toHaveLength(3));
    const layer = storedComposition().layers[2];
    expect(layer.name).toBe(ui("Shape Layer", "形状图层"));
    expect(layer.type).toBe("shape");
    view.rerender(<LayerPanel composition={storedComposition()} />);
    const expandButtons = screen.getAllByRole("button", { name: ui("Expand layer", "展开图层") });
    fireEvent.click(expandButtons[0]);
    fireEvent.click(screen.getByRole("button", { name: ui("Animate Position", "为位置添加动画") }));
    await waitFor(() => {
      const animated = storedComposition().layers.find((candidate) => candidate.keyframes.length > 0);
      expect(animated?.keyframes.map((key) => key.property).sort()).toEqual(["transform.position.x", "transform.position.y"]);
    });
  });


  it("translates blend options while persisting their original IDs", async () => {
    useMotionStore.setState({ timelineColumnMode: "modes" });
    render(<LayerPanel composition={composition()} />);
    const selects = screen.getAllByRole("combobox", { name: ui("Layer blend mode", "图层混合模式") });
    expect(screen.getAllByRole("option", { name: ui("Multiply", "正片叠底") })).toHaveLength(2);
    fireEvent.change(selects[0], { target: { value: "multiply" } });
    await waitFor(() => expect(storedComposition().layers.some((layer) => layer.blendMode === "multiply")).toBe(true));
  });

});
