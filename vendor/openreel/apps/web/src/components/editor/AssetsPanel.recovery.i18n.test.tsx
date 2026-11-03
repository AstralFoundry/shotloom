import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configureShotloomLocale } from "../../shotloom-mode";
import { AssetsPanel } from "./AssetsPanel";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useNotificationStore } from "../../stores/notification-store";

vi.mock("../../shotloom-mode", async importOriginal => {
  const actual = await importOriginal<typeof import("../../shotloom-mode")>();
  return { ...actual, isShotloomMode: true, get editorMessage() { return actual.editorMessage; } };
});

afterEach(() => {
  cleanup(); configureShotloomLocale("en-US");
  useNotificationStore.getState().clearAll();
  useProjectStore.setState({ hasOpenProject: false });
});

describe.each(["en-US", "zh-CN"] as const)("Embedded media recovery feedback (%s)", locale => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  it("explains per-asset recovery in the host language and preserves offline data", () => {
    configureShotloomLocale(locale);
    useNotificationStore.getState().clearAll();
    const source = createEmptyProject("Original project");
    useProjectStore.setState({ hasOpenProject: true, project: { ...source, mediaLibrary: { items: [{
      id: "offline-media", name: "用户 Original.mp4", type: "video", blob: null,
      fileHandle: null, waveformData: null, thumbnailUrl: null, isPlaceholder: true,
      metadata: { duration: 5, width: 1920, height: 1080, frameRate: 30, codec: "vp9", sampleRate: 0, channels: 0, fileSize: 512 },
    }] } } });
    const before = useProjectStore.getState().project.mediaLibrary.items[0];
    render(<AssetsPanel />);
    fireEvent.click(screen.getByRole("button", { name: ui("Relink from Folder", "从文件夹重新关联") }));
    expect(useNotificationStore.getState().notifications.at(-1)).toMatchObject({
      type: "warning", title: ui("Recover media one at a time", "请逐项恢复素材"),
      message: ui("Use each offline asset’s recovery button to select its project file.", "使用每个离线素材的恢复按钮选择项目文件。"),
    });
    expect(useProjectStore.getState().project.mediaLibrary.items[0]).toEqual(before);
  });
});
