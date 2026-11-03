import { configureShotloomLocale } from "../shotloom-mode";
import "../test/install-local-storage-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MotionComposition } from "@openreel/core";
import { createEmptyProject } from "../stores/project/project-helpers";
import { useProjectStore } from "../stores/project-store";
import { useNotificationStore } from "../stores/notification-store";
import { useUIStore } from "../stores/ui-store";
import { MotionCreatorShell } from "./MotionCreatorShell";
import { useMotionStore } from "./stores/motion-store";

vi.mock("./components/StageCanvas", () => ({
  StageCanvas: () => <div data-testid="stage-canvas" />,
}));
vi.mock("./components/MotionTimeline", () => ({
  MotionTimeline: () => <div data-testid="motion-timeline" />,
}));
vi.mock("./components/LayerPanel", () => ({
  LayerPanel: () => <div>Layer panel</div>,
}));
vi.mock("./components/CreationWorkspacePanel", () => ({
  CreationWorkspacePanel: () => <div>Creation workspace</div>,
}));
vi.mock("./components/AssetPanel", () => ({
  AssetPanel: () => <div>Asset panel</div>,
}));
vi.mock("./components/MotionTemplateBrowser", () => ({
  MotionTemplateBrowser: () => <div>Template browser</div>,
}));
vi.mock("./components/MotionStartPanel", () => ({
  MotionStartPanel: () => <div>Start panel</div>,
}));
vi.mock("./components/PropertiesPanel", () => ({
  PropertiesPanel: () => <div>Properties panel</div>,
}));
vi.mock("./components/DeformPanel", () => ({
  DeformPanel: () => <div>Deform panel</div>,
}));
vi.mock("./components/AnimationPresetsPanel", () => ({
  AnimationPresetsPanel: () => <div>Animation presets panel</div>,
}));
vi.mock("./components/MotionSyncPanel", () => ({
  MotionSyncPanel: () => <div>Motion sync panel</div>,
}));
vi.mock("./components/MotionTrackingPanel", () => ({
  MotionTrackingPanel: () => <div>Motion tracking panel</div>,
}));
vi.mock("./components/GraphEditorPanel", () => ({
  GraphEditorPanel: () => <div>Graph editor panel</div>,
}));
vi.mock("./components/EffectsPanel", () => ({
  EffectsPanel: () => <div>Effects panel</div>,
}));
vi.mock("./components/MasksPanel", () => ({
  MasksPanel: () => <div>Masks panel</div>,
}));
vi.mock("./components/VariablesPanel", () => ({
  VariablesPanel: () => <div>Variables panel</div>,
}));
vi.mock("./components/RenderQueuePanel", () => ({
  RenderQueuePanel: () => <div>Render queue panel</div>,
}));

function pointerEvent(
  type: string,
  init: { pointerId: number; clientX?: number; clientY?: number },
): Event {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
  });
  Object.defineProperty(event, "pointerId", { value: init.pointerId });
  return event;
}

const composition: MotionComposition = {
  id: "composition-shell-test",
  name: "Shell Test Scene",
  width: 1920,
  height: 1080,
  frameRate: 30,
  duration: 6,
  backgroundColor: "#10151f",
  layers: [],
  assets: [],
  variables: [],
  markers: [],
  guides: [],
  createdAt: 1,
  modifiedAt: 1,
};

function renderShell(): HTMLElement {
  const project = {
    ...createEmptyProject("Motion Shell Test"),
    motionCompositions: [composition],
  };
  useProjectStore.setState({ project });
  render(<MotionCreatorShell composition={composition} embedded />);
  const layout = screen.getByTestId("motion-creator-layout");
  const shell = layout.closest("[data-testid='motion-creator-shell']");
  if (shell) {
    shell.getBoundingClientRect = () =>
      ({
        width: 1440,
        height: 900,
        top: 0,
        left: 0,
        right: 1440,
        bottom: 900,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
  }
  layout.getBoundingClientRect = () =>
    ({
      width: 1440,
      height: 900,
      top: 0,
      left: 0,
      right: 1440,
      bottom: 900,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  return layout;
}

describe.each(["en-US", "zh-CN"] as const)("MotionCreatorShell layout (%s)", locale => {
  const labels: Record<string, string> = {"Start": "开始", "Layers": "图层", "Media": "媒体", "Kits": "模板", "Scenes": "场景", "Edit": "编辑", "Animate": "动画", "Assist": "辅助", "Deliver": "交付", "Video Editing": "视频剪辑", "Motion Creation": "动效创作", "Render Queue": "渲染队列", "Export": "导出", "Use in Editor": "添加到剪辑", "Resize workspace": "调整工作区宽度", "Resize inspector": "调整属性面板宽度", "Resize timeline": "调整时间线高度", "Motion scene added": "已添加动效场景"};
  const ui = (label: string) => locale === "zh-CN" ? labels[label] ?? label : label;
  beforeEach(() => {
    configureShotloomLocale(locale);
    window.localStorage.clear();
    window.location.hash = "";
    useNotificationStore.getState().clearAll();
    useUIStore.setState({ desktopPage: "motion" });
    useMotionStore.setState({
      leftTab: "layers",
      rightTab: "properties",
      activeCompositionId: composition.id,
      compositionNavigationStack: [],
      selectedLayerId: null,
      selectedLayerIds: [],
      selectedLightId: null,
      selectedProperty: null,
      isPlaying: false,
      playhead: 0,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    configureShotloomLocale("en-US");
    window.localStorage.clear();
    window.location.hash = "";
    useNotificationStore.getState().clearAll();
    useProjectStore.setState({ project: createEmptyProject("Reset") });
  });

  it("organizes motion creation around start and workflow groups", () => {
    renderShell();

    for (const label of ["Start", "Layers", "Media", "Kits", "Scenes"]) {
      expect(screen.getByRole("button", { name: ui(label) })).toBeInTheDocument();
    }

    for (const groupLabel of ["Edit", "Animate", "Assist", "Deliver"]) {
      expect(
        screen.getAllByRole("button", { name: ui(groupLabel) }).length,
      ).toBeGreaterThan(0);
    }

    for (const panelText of [
      "Properties panel",
      "Effects panel",
      "Masks panel",
    ]) {
      expect(screen.getByText(panelText)).toBeInTheDocument();
    }

    expect(screen.queryByText("Animation presets panel")).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: ui("Animate") })[0]);

    expect(screen.getByText("Animation presets panel")).toBeInTheDocument();
    expect(screen.getByText("Graph editor panel")).toBeInTheDocument();
    expect(screen.getByText("Deform panel")).toBeInTheDocument();
    expect(screen.getByText("Motion sync panel")).toBeInTheDocument();
  });

  it("keeps the embedded motion header focused on motion actions", () => {
    renderShell();

    expect(
      screen.queryByRole("button", { name: ui("Video Editing") }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: ui("Motion Creation") }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: ui("Render Queue") }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: ui("Export") })).toBeInTheDocument();
  });

  it("exposes keyboard-resizable workspace and inspector separators", () => {
    renderShell();

    const workspaceHandle = screen.getByRole("separator", {
      name: ui("Resize workspace"),
    });
    const inspectorHandle = screen.getByRole("separator", {
      name: ui("Resize inspector"),
    });
    expect(workspaceHandle).toHaveAttribute("aria-valuenow", "360");
    expect(inspectorHandle).toHaveAttribute("aria-valuenow", "320");

    fireEvent.keyDown(workspaceHandle, { key: "ArrowRight" });
    fireEvent.keyDown(inspectorHandle, { key: "ArrowLeft" });

    expect(workspaceHandle).toHaveAttribute("aria-valuenow", "384");
    expect(inspectorHandle).toHaveAttribute("aria-valuenow", "344");
  });

  it("resizes the timeline with keyboard controls", () => {
    renderShell();

    const timelineHandle = screen.getByRole("separator", {
      name: ui("Resize timeline"),
    });
    expect(timelineHandle).toHaveAttribute("aria-valuenow", "340");

    fireEvent.keyDown(timelineHandle, { key: "ArrowUp" });

    expect(timelineHandle).toHaveAttribute("aria-valuenow", "372");
    expect(
      window.localStorage.getItem("openreel.motionCreator.timelineHeight.v2"),
    ).toBe("372");
  });

  it("resizes the inspector with a pointer drag", () => {
    renderShell();

    const inspectorHandle = screen.getByRole("separator", {
      name: ui("Resize inspector"),
    }) as HTMLElement & {
      setPointerCapture: (pointerId: number) => void;
      releasePointerCapture: (pointerId: number) => void;
    };
    inspectorHandle.setPointerCapture = vi.fn();
    inspectorHandle.releasePointerCapture = vi.fn();

    expect(inspectorHandle).toHaveAttribute("aria-valuenow", "320");

    fireEvent(inspectorHandle, pointerEvent("pointerdown", { pointerId: 1, clientX: 900 }));
    fireEvent(window, pointerEvent("pointermove", { pointerId: 1, clientX: 840 }));
    fireEvent(window, pointerEvent("pointerup", { pointerId: 1, clientX: 840 }));

    expect(inspectorHandle).toHaveAttribute("aria-valuenow", "380");
    expect(
      window.localStorage.getItem("openreel.motionCreator.rightPanelWidth.v2"),
    ).toBe("380");
  });

  it("resizes the timeline with a pointer drag", () => {
    renderShell();

    const timelineHandle = screen.getByRole("separator", {
      name: ui("Resize timeline"),
    }) as HTMLElement & {
      setPointerCapture: (pointerId: number) => void;
      releasePointerCapture: (pointerId: number) => void;
    };
    timelineHandle.setPointerCapture = vi.fn();
    timelineHandle.releasePointerCapture = vi.fn();

    expect(timelineHandle).toHaveAttribute("aria-valuenow", "340");

    fireEvent(timelineHandle, pointerEvent("pointerdown", { pointerId: 2, clientY: 500 }));
    fireEvent(window, pointerEvent("pointermove", { pointerId: 2, clientY: 420 }));
    fireEvent(window, pointerEvent("pointerup", { pointerId: 2, clientY: 420 }));

    expect(timelineHandle).toHaveAttribute("aria-valuenow", "420");
    expect(
      window.localStorage.getItem("openreel.motionCreator.timelineHeight.v2"),
    ).toBe("420");
  });

  it("creates a sequence with localized defaults and keeps existing names", async () => {
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: composition.name }));
    expect(screen.getByText(locale === "zh-CN" ? "序列 · 1" : "Sequences · 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: locale === "zh-CN" ? "新建序列" : "New sequence" }));
    await waitFor(() => expect(useProjectStore.getState().project.motionCompositions).toHaveLength(2));
    const scenes = useProjectStore.getState().project.motionCompositions!;
    expect(scenes[0].name).toBe(composition.name);
    expect(scenes[1].name).toBe(locale === "zh-CN" ? "动效场景" : "Motion Scene");
    expect(useMotionStore.getState().activeCompositionId).toBe(scenes[1].id);
  });

  it("localizes an insertion failure while retaining upstream error details", async () => {
    const detail = "storage {name} $& 用户文件";
    vi.spyOn(useProjectStore.getState(), "insertMotionInstance").mockRejectedValueOnce(new Error(detail));
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: ui("Export") }));
    fireEvent.click(screen.getByRole("button", { name: ui("Use in Editor") }));
    await waitFor(() => expect(useNotificationStore.getState().notifications.at(-1)).toMatchObject({
      type: "error", title: locale === "zh-CN" ? "无法添加动效场景" : "Could not add motion scene", message: detail,
    }));
    expect(useProjectStore.getState().project.motionInstances ?? []).toHaveLength(0);
  });

  it("sends the motion composition to the editor timeline", async () => {
    renderShell();

    fireEvent.click(screen.getByRole("button", { name: ui("Export") }));
    fireEvent.click(screen.getByRole("button", { name: ui("Use in Editor") }));

    await waitFor(() => {
      expect(useProjectStore.getState().project.motionInstances).toHaveLength(1);
    });

    const project = useProjectStore.getState().project;
    const instance = project.motionInstances?.[0];
    const motionClip = project.timeline.tracks
      .flatMap((track) => track.clips)
      .find((clip) => clip.metadata?.motionInstanceId === instance?.id);

    expect(instance).toMatchObject({
      compositionId: composition.id,
      name: composition.name,
      startTime: 0,
      duration: composition.duration,
    });
    expect(motionClip).toMatchObject({
      startTime: 0,
      duration: composition.duration,
      metadata: {
        motionClip: true,
        motionCompositionId: composition.id,
        motionInstanceId: instance?.id,
      },
    });
    expect(useUIStore.getState().desktopPage).toBe("edit");
    expect(window.location.hash).toBe("#/editor");
    expect(useNotificationStore.getState().notifications[0]).toMatchObject({
      type: "success",
      title: ui("Motion scene added"),
    });
  });
});
