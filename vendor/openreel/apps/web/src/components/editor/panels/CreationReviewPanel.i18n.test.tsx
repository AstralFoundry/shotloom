import "../../../test/install-local-storage-mock";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreationProjectState } from "@openreel/core/creation/index";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import { CreationReviewPanel } from "./CreationReviewPanel";

describe.each(["en-US", "zh-CN"] as const)("Creation review panel (%s)", locale => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => {
    configureShotloomLocale(locale);
    useProjectStore.setState({ project: createEmptyProject("User project"), hasOpenProject: true });
  });
  afterEach(() => {
    cleanup(); configureShotloomLocale("en-US");
    useProjectStore.setState({ hasOpenProject: false });
  });
  it("shows a localized empty state and invokes the close action", () => {
    const close = vi.fn();
    render(<CreationReviewPanel onClose={close} />);
    expect(screen.getByText(ui("Creation Review", "创作检查"))).toBeInTheDocument();
    expect(screen.getByText(ui("No agent-created 3D scenes yet. Use the creation tools to build a product, character, or scene.", "暂无 Agent 创建的三维场景。使用创作工具构建产品、角色或场景。"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ui("Close creation review", "关闭创作检查") }));
    expect(close).toHaveBeenCalledOnce();
  });
  it("renders scene statistics and diagnostics without changing stored content", () => {
    const project = useProjectStore.getState().project;
    const creation: CreationProjectState = {
      version: "0.1.0", assets: [], activeSceneId: "scene-original", operationHistory: [],
      scenes: [{ id: "scene-original", name: "My {objects} scene", duration: 4, frameRate: 30,
        objects: [], cameras: [], lights: [], animations: [], renderBindings: [],
        environment: { kind: "studio" }, createdAt: 0, modifiedAt: 0 }],
    };
    useProjectStore.setState({ project: { ...project, creation } });
    const original = structuredClone(creation);
    render(<CreationReviewPanel />);
    expect(screen.getByText("My {objects} scene")).toBeInTheDocument();
    expect(screen.getByText(ui("Assets: 0 · Scenes: 1", "资产：0 · 场景：1"))).toBeInTheDocument();
    expect(screen.getByText(ui("Objects: 0 · Cameras: 0 · Animations: 0", "物体：0 · 相机：0 · 动画：0"))).toBeInTheDocument();
    expect(screen.getByText(ui("Scene has no objects", "场景中没有物体"))).toBeInTheDocument();
    expect(useProjectStore.getState().project.creation).toEqual(original);
  });
});
