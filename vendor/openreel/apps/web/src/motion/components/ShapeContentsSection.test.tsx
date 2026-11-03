import { configureShotloomLocale } from "../../shotloom-mode";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  DEFAULT_MOTION_TRANSFORM,
  createShapePathItem,
  hasExplicitShapeContents,
  type MotionComposition,
  type MotionShapeGroupItem,
  type MotionShapeItem,
  type MotionShapeLayer,
} from "@openreel/core";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { ShapeContentsSection } from "./ShapeContentsSection";

const LAYER_ID = "layer-shape";
const COMP_ID = "comp-contents";

function shapeLayer(contents?: readonly MotionShapeItem[]): MotionShapeLayer {
  return {
    id: LAYER_ID,
    type: "shape",
    name: "Block",
    startTime: 0,
    duration: 4,
    visible: true,
    locked: false,
    transform: DEFAULT_MOTION_TRANSFORM,
    keyframes: [],
    shapeType: "rectangle",
    width: 400,
    height: 240,
    style: {
      fill: { type: "solid", color: "#14b8a6", opacity: 1 },
      stroke: { color: "#ffffff", width: 8, opacity: 1 },
    },
    ...(contents ? { contents } : {}),
  };
}

function composition(layer: MotionShapeLayer): MotionComposition {
  return {
    id: COMP_ID,
    name: "Comp",
    width: 1280,
    height: 720,
    frameRate: 30,
    duration: 4,
    backgroundColor: "#101820",
    layers: [layer],
    assets: [],
    variables: [],
    markers: [],
    createdAt: 1,
    modifiedAt: 1,
  };
}

function storedComposition(): MotionComposition {
  const project = useProjectStore.getState().project;
  const found = (project.motionCompositions ?? []).find(
    (entry) => entry.id === COMP_ID,
  );
  if (!found) throw new Error("composition not stored");
  return found;
}

function storedLayer(): MotionShapeLayer {
  return storedComposition().layers[0] as MotionShapeLayer;
}

function seed(comp: MotionComposition): void {
  useProjectStore.setState({
    hasOpenProject: true,
    project: {
      ...createEmptyProject("Contents test"),
      motionCompositions: [comp],
    },
  });
}

function renderSection(layer: MotionShapeLayer) {
  return render(
    <ShapeContentsSection composition={composition(layer)} layer={layer} />,
  );
}

describe.each(["en-US", "zh-CN"] as const)("ShapeContentsSection (%s)", locale => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => configureShotloomLocale(locale));
  afterEach(() => {
    cleanup();
    configureShotloomLocale("en-US");
    useProjectStore.setState({ hasOpenProject: false });
  });

  it("renders a Group contents CTA for legacy layers", () => {
    seed(composition(shapeLayer()));
    renderSection(shapeLayer());
    expect(
      screen.getByRole("button", { name: ui("Group contents", "内容分组") }),
    ).toBeInTheDocument();
  });

  it("materializes contents on Group contents click", async () => {
    seed(composition(shapeLayer()));
    renderSection(shapeLayer());

    fireEvent.click(screen.getByRole("button", { name: ui("Group contents", "内容分组") }));

    await waitFor(() => {
      expect(hasExplicitShapeContents(storedLayer())).toBe(true);
    });
    const contents = storedLayer().contents ?? [];
    expect(contents).toHaveLength(1);
    expect(contents[0].kind).toBe("group");
    expect(contents[0].name).toBe(ui("Group 1", "分组 1"));
  });

  it("adds a group to the root", async () => {
    seed(composition(shapeLayer()));
    renderSection(shapeLayer());

    fireEvent.click(screen.getByRole("button", { name: ui("Group contents", "内容分组") }));
    await waitFor(() => {
      expect(hasExplicitShapeContents(storedLayer())).toBe(true);
    });

    cleanup();
    renderSection(storedLayer());
    fireEvent.click(screen.getByRole("button", { name: ui("Add group", "添加分组") }));

    await waitFor(() => {
      expect(storedLayer().contents ?? []).toHaveLength(2);
    });
  });

  it("adds a shape into the selected group", async () => {
    const group: MotionShapeGroupItem = {
      kind: "group",
      id: "grp-1",
      name: "Group 1",
      transform: {
        anchor: { x: 0, y: 0 },
        position: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
        opacity: 1,
      },
      items: [],
    };
    seed(composition(shapeLayer([group])));
    renderSection(shapeLayer([group]));

    fireEvent.click(screen.getByRole("button", { name: /Group 1/i }));
    fireEvent.click(screen.getByRole("button", { name: ui("Add shape", "添加形状") }));

    await waitFor(() => {
      const stored = storedLayer().contents?.[0] as MotionShapeGroupItem;
      expect(stored.items).toHaveLength(1);
      expect(stored.items[0].kind).toBe("path");
      expect(stored.items[0].name).toBe(ui("Shape", "形状"));
    });
  });

  it("renames an item on Enter and commits once", async () => {
    const group: MotionShapeGroupItem = {
      kind: "group",
      id: "grp-1",
      name: "Group 1",
      transform: {
        anchor: { x: 0, y: 0 },
        position: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
        opacity: 1,
      },
      items: [],
    };
    seed(composition(shapeLayer([group])));
    renderSection(shapeLayer([group]));

    const row = screen.getByText("Group 1");
    expect(row).toHaveAttribute("data-shotloom-user-content");
    fireEvent.doubleClick(row);
    const input = screen.getByRole("textbox", { name: ui("Rename item", "重命名内容项") });
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      const stored = storedLayer().contents?.[0] as MotionShapeGroupItem;
      expect(stored.name).toBe("Renamed");
    });
  });

  it("writes mergeMode via the merge-mode select", async () => {
    const group: MotionShapeGroupItem = {
      kind: "group",
      id: "grp-1",
      name: "Group 1",
      transform: {
        anchor: { x: 0, y: 0 },
        position: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
        opacity: 1,
      },
      items: [],
    };
    seed(composition(shapeLayer([group])));
    renderSection(shapeLayer([group]));

    fireEvent.click(screen.getByRole("button", { name: /Group 1/i }));
    const select = screen.getByLabelText(ui("Merge mode", "合并模式"));
    fireEvent.change(select, { target: { value: "union" } });

    await waitFor(() => {
      const stored = storedLayer().contents?.[0] as MotionShapeGroupItem;
      expect(stored.mergeMode).toBe("union");
    });
  });

  it("adds a twist operator with defaults to the group stack", async () => {
    const group: MotionShapeGroupItem = {
      kind: "group",
      id: "grp-1",
      name: "Group 1",
      transform: {
        anchor: { x: 0, y: 0 },
        position: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
        opacity: 1,
      },
      items: [],
    };
    seed(composition(shapeLayer([group])));
    renderSection(shapeLayer([group]));

    fireEvent.click(screen.getByRole("button", { name: /Group 1/i }));
    const operatorSelect = screen.getByLabelText(ui("Add operator", "添加操作器"));
    fireEvent.change(operatorSelect, { target: { value: "twist" } });
    fireEvent.click(screen.getByRole("button", { name: ui("Add operator to group", "向分组添加操作器") }));

    await waitFor(() => {
      const stored = storedLayer().contents?.[0] as MotionShapeGroupItem;
      const operators = stored.operators ?? [];
      expect(operators).toHaveLength(1);
      expect(operators[0].type).toBe("twist");
      expect(operators[0].name).toBe(ui("Twist", "扭转"));
    });
  });

  it("reorders items via the move-down button", async () => {
    const items: MotionShapeItem[] = [
      {
        kind: "group",
        id: "grp-a",
        name: "Alpha",
        transform: {
          anchor: { x: 0, y: 0 },
          position: { x: 0, y: 0 },
          scale: { x: 1, y: 1 },
          rotation: 0,
          opacity: 1,
        },
        items: [],
      },
      {
        kind: "group",
        id: "grp-b",
        name: "Beta",
        transform: {
          anchor: { x: 0, y: 0 },
          position: { x: 0, y: 0 },
          scale: { x: 1, y: 1 },
          rotation: 0,
          opacity: 1,
        },
        items: [],
      },
    ];
    seed(composition(shapeLayer(items)));
    renderSection(shapeLayer(items));

    fireEvent.click(screen.getByRole("button", { name: /Alpha/i }));
    fireEvent.click(screen.getByRole("button", { name: ui("Move down", "下移") }));

    await waitFor(() => {
      const contents = storedLayer().contents ?? [];
      expect(contents[0].id).toBe("grp-b");
      expect(contents[1].id).toBe("grp-a");
    });
  });

  it("toggles item visibility via the eye button", async () => {
    const group: MotionShapeGroupItem = {
      kind: "group",
      id: "grp-1",
      name: "Group 1",
      transform: {
        anchor: { x: 0, y: 0 },
        position: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
        opacity: 1,
      },
      items: [],
    };
    seed(composition(shapeLayer([group])));
    renderSection(shapeLayer([group]));

    fireEvent.click(screen.getByRole("button", { name: ui("Toggle visibility", "切换可见性") }));

    await waitFor(() => {
      const stored = storedLayer().contents?.[0] as MotionShapeGroupItem;
      expect(stored.visible).toBe(false);
    });
  });

  it("edits a group transform field", async () => {
    const group: MotionShapeGroupItem = {
      kind: "group",
      id: "grp-1",
      name: "Group 1",
      transform: {
        anchor: { x: 0, y: 0 },
        position: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
        opacity: 1,
      },
      items: [],
    };
    seed(composition(shapeLayer([group])));
    renderSection(shapeLayer([group]));

    fireEvent.click(screen.getByRole("button", { name: /Group 1/i }));
    const detail = screen.getByTestId("shape-contents-detail");
    const spinbuttons = within(detail).getAllByRole("spinbutton");
    const rotation = spinbuttons[4];
    fireEvent.change(rotation, { target: { value: "45" } });

    await waitFor(() => {
      const stored = storedLayer().contents?.[0] as MotionShapeGroupItem;
      expect(stored.transform.rotation).toBe(45);
    });
  });

  it("commits one undoable gesture for a multi-change transform scrub", async () => {
    const group: MotionShapeGroupItem = {
      kind: "group",
      id: "grp-1",
      name: "Group 1",
      transform: {
        anchor: { x: 0, y: 0 },
        position: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
        opacity: 1,
      },
      items: [],
    };
    seed(composition(shapeLayer([group])));

    const realCommit =
      useProjectStore.getState().commitMotionCompositionGesture;
    const realPreview =
      useProjectStore.getState().updateMotionCompositionPreview;
    const realUpsert = useProjectStore.getState().upsertMotionComposition;
    const commitSpy = vi.fn(realCommit);
    const previewSpy = vi.fn(realPreview);
    const upsertSpy = vi.fn(realUpsert);
    useProjectStore.setState({
      commitMotionCompositionGesture: commitSpy,
      updateMotionCompositionPreview: previewSpy,
      upsertMotionComposition: upsertSpy,
    });

    renderSection(shapeLayer([group]));
    fireEvent.click(screen.getByRole("button", { name: /Group 1/i }));
    const detail = screen.getByTestId("shape-contents-detail");
    const rotation = within(detail).getAllByRole("spinbutton")[4];

    fireEvent.change(rotation, { target: { value: "10" } });
    fireEvent.change(rotation, { target: { value: "20" } });
    fireEvent.change(rotation, { target: { value: "30" } });

    expect(commitSpy).not.toHaveBeenCalled();
    expect(upsertSpy).not.toHaveBeenCalled();
    expect(previewSpy.mock.calls.length).toBeGreaterThanOrEqual(1);

    fireEvent.pointerUp(window);

    await waitFor(() => {
      expect(commitSpy).toHaveBeenCalledTimes(1);
    });
    expect(upsertSpy).not.toHaveBeenCalled();

    await waitFor(() => {
      const stored = storedLayer().contents?.[0] as MotionShapeGroupItem;
      expect(stored.transform.rotation).toBe(30);
    });
  });

  it("keeps a pending scrub when a discrete edit interleaves", async () => {
    const group: MotionShapeGroupItem = {
      kind: "group",
      id: "grp-1",
      name: "Group 1",
      transform: {
        anchor: { x: 0, y: 0 },
        position: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
        opacity: 1,
      },
      items: [],
    };
    seed(composition(shapeLayer([group])));

    const realCommit =
      useProjectStore.getState().commitMotionCompositionGesture;
    const realUpsert = useProjectStore.getState().upsertMotionComposition;
    const commitSpy = vi.fn(realCommit);
    const upsertSpy = vi.fn(realUpsert);
    useProjectStore.setState({
      commitMotionCompositionGesture: commitSpy,
      upsertMotionComposition: upsertSpy,
    });

    renderSection(shapeLayer([group]));
    fireEvent.click(screen.getByRole("button", { name: /Group 1/i }));
    const detail = screen.getByTestId("shape-contents-detail");
    const rotation = within(detail).getAllByRole("spinbutton")[4];

    fireEvent.change(rotation, { target: { value: "30" } });
    expect(commitSpy).not.toHaveBeenCalled();
    expect(upsertSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: ui("Toggle visibility", "切换可见性") }));

    await waitFor(() => {
      expect(upsertSpy).toHaveBeenCalledTimes(1);
    });
    expect(commitSpy).toHaveBeenCalledTimes(1);

    const stored = storedLayer().contents?.[0] as MotionShapeGroupItem;
    expect(stored.transform.rotation).toBe(30);
    expect(stored.visible).toBe(false);
  });

  it("removes the selected item", async () => {
    const group: MotionShapeGroupItem = {
      kind: "group",
      id: "grp-1",
      name: "Group 1",
      transform: {
        anchor: { x: 0, y: 0 },
        position: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
        opacity: 1,
      },
      items: [],
    };
    seed(composition(shapeLayer([group])));
    renderSection(shapeLayer([group]));

    fireEvent.click(screen.getByRole("button", { name: /Group 1/i }));
    fireEvent.click(screen.getByRole("button", { name: ui("Delete", "删除") }));

    await waitFor(() => {
      expect(storedLayer().contents ?? []).toHaveLength(0);
    });
  });
  it("edits path geometry and style without changing user names", async () => {
    const item = createShapePathItem({ name: "Rectangle {keep}", shapeType: "rectangle" });
    const layer = shapeLayer([item]);
    seed(composition(layer));
    renderSection(layer);
    fireEvent.click(screen.getByRole("button", { name: "Rectangle {keep}" }));
    expect(screen.getByRole("button", { name: "Rectangle {keep}" })).toHaveAttribute("data-shotloom-user-content");
    expect(screen.getByRole("option", { name: ui("Arrow", "箭头") })).toHaveValue("arrow");
    fireEvent.change(screen.getByLabelText(ui("Shape type", "形状类型")), { target: { value: "polygon" } });
    await waitFor(() => expect(storedLayer().contents?.[0]).toMatchObject({ shapeType: "polygon", name: "Rectangle {keep}" }));
    fireEvent.click(screen.getByRole("checkbox", { name: ui("Inherit style", "继承样式") }));
    await waitFor(() => expect(storedLayer().contents?.[0]).toMatchObject({ name: "Rectangle {keep}", style: { fill: { type: "solid" }, stroke: { width: 8 } } }));
  });

});
