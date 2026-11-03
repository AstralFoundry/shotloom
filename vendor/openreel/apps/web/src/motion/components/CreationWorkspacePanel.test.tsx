import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CreationProjectState, CreationScene } from "@openreel/core/creation/index";
import { IDENTITY_TRANSFORM } from "@openreel/core/creation/index";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useMotionStore } from "../stores/motion-store";
import { configureShotloomLocale } from "../../shotloom-mode";
import { CreationWorkspacePanel } from "./CreationWorkspacePanel";

const h = vi.hoisted(() => ({
  executeTool: vi.fn(),
  host: { id: "host" },
  runExclusive: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

vi.mock("@openreel/agent", () => ({
  executeTool: h.executeTool,
}));

vi.mock("../../services/agent/host-singleton", () => ({
  getLiveEditorHost: () => h.host,
  runExclusive: h.runExclusive,
}));

function creationScene(): CreationScene {
  return {
    id: "scene-sync",
    name: "Unsynced Scene",
    duration: 4,
    frameRate: 30,
    objects: [
      {
        id: "object-1",
        name: "Renderable object",
        assetId: "asset-1",
        materialId: "mat-1",
        transform: IDENTITY_TRANSFORM,
        visible: true,
        selectable: true,
        tags: ["agent-created"],
      },
    ],
    cameras: [
      {
        id: "camera-1",
        name: "Hero camera",
        position: { x: 0, y: 1, z: 5 },
        target: { x: 0, y: 0, z: 0 },
        fov: 35,
      },
    ],
    activeCameraId: "camera-1",
    lights: [],
    animations: [],
    environment: { kind: "studio", backgroundColor: "#101522" },
    renderBindings: [],
    createdAt: 1,
    modifiedAt: 1,
  };
}

function projectCreation(): CreationProjectState {
  return {
    version: "0.1.0",
    assets: [
      {
        id: "asset-1",
        name: "Asset",
        kind: "prop",
        seed: "asset",
        parameters: {},
        nodes: [],
        materials: [
          {
            id: "mat-1",
            name: "Material",
            model: "pbr",
            baseColor: "#ffffff",
          },
        ],
        dependencies: [],
        caches: [],
        createdAt: 1,
        modifiedAt: 1,
      },
    ],
    scenes: [creationScene()],
    activeSceneId: "scene-sync",
    operationHistory: [],
  };
}

describe.each(["en-US", "zh-CN"] as const)("CreationWorkspacePanel in %s", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => {
    configureShotloomLocale(locale);
    vi.clearAllMocks();
    useProjectStore.setState({
      hasOpenProject: true,
      project: {
        ...createEmptyProject("Creation sync test"),
        creation: projectCreation(),
        motionCompositions: [],
      },
    });
    useMotionStore.setState({
      activeCompositionId: null,
      selectedLayerId: null,
      selectedLayerIds: [],
      leftTab: "creation",
      rightTab: "properties",
      playhead: 0,
    });
  });

  afterEach(() => {
    configureShotloomLocale("en-US");
    vi.restoreAllMocks();
    cleanup();
    useProjectStore.setState({
      hasOpenProject: false,
      project: createEmptyProject("Reset"),
    });
  });

  it("syncs an unbound creation scene through the shared MCP motion tool", async () => {
    h.executeTool.mockResolvedValue({
      ok: true,
      summary: "Synced",
      data: { compositionId: "comp-synced", layerId: "layer-synced" },
    });

    render(<CreationWorkspacePanel />);

    fireEvent.click(screen.getByRole("button", { name: ui("Sync render scene", "同步渲染场景") }));

    await waitFor(() => {
      expect(h.executeTool).toHaveBeenCalledWith(
        "sync_creation_scene_to_motion",
        { sceneId: "scene-sync" },
        h.host,
      );
    });
    expect(h.runExclusive).toHaveBeenCalledTimes(1);
    expect(useMotionStore.getState().activeCompositionId).toBe("comp-synced");
    expect(useMotionStore.getState().selectedLayerId).toBe("layer-synced");
    expect(useMotionStore.getState().leftTab).toBe("layers");
    expect(useMotionStore.getState().rightTab).toBe("properties");
  });

  it("reports sync errors without leaving the creation workspace", async () => {
    h.executeTool.mockResolvedValue({
      ok: false,
      summary: "Creation scene has no objects to render",
      error: {
        code: "INVALID_PARAMS",
        message: "Creation scene has no objects to render",
      },
    });

    render(<CreationWorkspacePanel />);

    fireEvent.click(screen.getByRole("button", { name: ui("Sync render scene", "同步渲染场景") }));

    expect(
      await screen.findByText("Creation scene has no objects to render"),
    ).toBeInTheDocument();
    expect(useMotionStore.getState().leftTab).toBe("creation");
  });

  it("edits object values through the real store without translating IDs or user names", async () => {
    const update = vi.spyOn(useProjectStore.getState(), "updateCreationObject");
    render(<CreationWorkspacePanel />);
    const name = "用户 {name} $& Object";
    fireEvent.change(screen.getByRole("textbox", { name: ui("Name", "名称") }), { target: { value: name } });
    fireEvent.change(screen.getAllByRole("textbox", { name: ui("Position 1", "位置 1") })[1], { target: { value: "2.5" } });
    fireEvent.change(screen.getByRole("textbox", { name: ui("Metal", "金属度") }), { target: { value: "0.7" } });
    fireEvent.click(screen.getByRole("button", { name: ui("Apply object edit", "应用对象修改") }));
    await waitFor(() => {
      expect(update).toHaveBeenCalledWith("scene-sync", "object-1", expect.objectContaining({ name, position: { x: 2.5, y: 0, z: 0 }, material: expect.objectContaining({ metallic: 0.7 }) }));
      const stored = useProjectStore.getState().project.creation?.scenes[0].objects[0];
      expect(stored).toMatchObject({ id: "object-1", assetId: "asset-1", name, transform: { position: { x: 2.5 } } });
    });
  });

  it("edits the camera through the real store with numeric parameters", async () => {
    const update = vi.spyOn(useProjectStore.getState(), "updateCreationCamera");
    render(<CreationWorkspacePanel />);
    const name = "镜头 {camera} $&";
    fireEvent.change(screen.getByRole("textbox", { name: ui("Camera", "摄像机") }), { target: { value: name } });
    fireEvent.change(screen.getByRole("textbox", { name: ui("FOV", "视野角度") }), { target: { value: "50" } });
    fireEvent.change(screen.getByRole("textbox", { name: ui("Focus", "焦距") }), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("switch", { name: ui("DOF", "景深") }));
    fireEvent.click(screen.getByRole("button", { name: ui("Apply camera edit", "应用摄像机修改") }));
    await waitFor(() => {
      expect(update).toHaveBeenCalledWith("scene-sync", "camera-1", expect.objectContaining({ name, fov: 50, focusDistance: 8, depthOfField: true, active: true }));
      expect(useProjectStore.getState().project.creation?.scenes[0].cameras[0]).toMatchObject({ id: "camera-1", name, fov: 50, focusDistance: 8, depthOfField: true });
    });
  });

  it("localizes inspection issues while preserving their codes", () => {
    const scene = { ...creationScene(), objects: [], cameras: [] };
    useProjectStore.setState((state) => ({ project: { ...state.project, creation: { ...projectCreation(), scenes: [scene] } } }));
    render(<CreationWorkspacePanel />);
    expect(screen.getByText(ui("Scene has no objects", "场景中没有对象"))).toBeInTheDocument();
    expect(screen.getByText(ui("Scene has no camera", "场景中没有摄像机"))).toBeInTheDocument();
    expect(screen.getByText(ui("Scene is using renderer default lighting", "场景使用渲染器默认灯光"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ui("Sync render scene", "同步渲染场景") })).toBeDisabled();
  });

  it("uses a localized fallback for unexpected sync failures and keeps the workspace open", async () => {
    h.executeTool.mockRejectedValueOnce(null);
    render(<CreationWorkspacePanel />);
    fireEvent.click(screen.getByRole("button", { name: ui("Sync render scene", "同步渲染场景") }));
    expect(await screen.findByText(ui("Could not sync render scene", "无法同步渲染场景"))).toBeInTheDocument();
    expect(useMotionStore.getState().leftTab).toBe("creation");
  });

  it("shows localized planner rejection from the real edit store without changing the project", async () => {
    const current = useProjectStore.getState().project;
    const creation = current.creation!;
    const missingMaterial = { ...current, creation: { ...creation,
      assets: creation.assets.map(asset => ({ ...asset, materials: [] })),
    } };
    useProjectStore.setState({ project: missingMaterial });
    render(<CreationWorkspacePanel />);
    fireEvent.click(screen.getByRole("button", { name: ui("Apply object edit", "应用对象修改") }));
    expect(await screen.findByText(ui("Creation material not found: mat-1", "找不到创作材质：mat-1"))).toBeInTheDocument();
    expect(useProjectStore.getState().project).toBe(missingMaterial);
    expect(useMotionStore.getState().leftTab).toBe("creation");
  });

});
