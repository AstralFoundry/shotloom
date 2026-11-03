import "../../test/install-local-storage-mock";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useEngineStore } from "../../stores/engine-store";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useUIStore } from "../../stores/ui-store";
import { configureShotloomLocale } from "../../shotloom-mode";
import { AssetsPanel } from "./AssetsPanel";

describe.each(["en-US", "zh-CN"] as const)("AssetsPanel graphics workflow (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => {
    configureShotloomLocale(locale);
    useEngineStore.getState().getGraphicsEngine()?.clearCache();
    useProjectStore.setState({
      hasOpenProject: true,
      project: createEmptyProject("Graphics workflow"),
    });
    useTimelineStore.setState({ playheadPosition: 2.25 });
    useUIStore.getState().clearSelection();
  });

  afterEach(() => {
    cleanup();
    configureShotloomLocale("en-US");
    useEngineStore.getState().getGraphicsEngine()?.clearCache();
    useUIStore.getState().clearSelection();
    useProjectStore.setState({
      hasOpenProject: false,
      project: createEmptyProject("Reset"),
    });
  });

  it("inserts a translated text preset without changing the stored style", async () => {
    render(<AssetsPanel />);
    fireEvent.click(screen.getByRole("button", { name: ui("Text", "文字") }));
    fireEvent.click(screen.getByRole("button", { name: ui("Hero", "主视觉标题") }));
    await waitFor(() => {
      const text = useEngineStore.getState().getTitleEngine()?.getAllTextClips().find((clip) => clip.id === useUIStore.getState().getSelectedClipIds()[0]);
      expect(text).toMatchObject({ text: ui("MAKE IT MOVE", "让画面动起来"), startTime: 2.25, style: { fontSize: 112, fontWeight: 900 } });
    });
  });

  it("places a new shape at the playhead and opens it in the inspector", async () => {
    render(<AssetsPanel />);
    fireEvent.click(screen.getByRole("button", { name: ui("Graphics", "图形") }));

    expect(
      screen.getByRole("button", { name: "Import & Add Sticker" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: ui("Gradient", "渐变") }));
    expect(screen.getByRole("button", { name: ui("Sunset", "日落") })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ui("Black", "黑色") })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ui("Rectangle", "矩形") }));

    await waitFor(() => {
      const shapes =
        useEngineStore.getState().getGraphicsEngine()?.getAllShapeClips() ?? [];
      expect(shapes).toHaveLength(1);
      expect(shapes[0]).toMatchObject({
        shapeType: "rectangle",
        startTime: 2.25,
      });
      expect(useUIStore.getState().getSelectedClipIds()).toEqual([shapes[0]?.id]);
    });
  });
});
