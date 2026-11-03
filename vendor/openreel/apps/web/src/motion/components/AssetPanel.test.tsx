import "../../test/install-local-storage-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MediaItem, MotionAsset, MotionComposition } from "@openreel/core";

import { createEmptyProject } from "../../stores/project/project-helpers";
import { useNotificationStore } from "../../stores/notification-store";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import { useMotionStore } from "../stores/motion-store";
import { configureShotloomLocale } from "../../shotloom-mode";
import { AssetPanel } from "./AssetPanel";

const composition: MotionComposition = {
  id: "asset-panel-composition",
  name: "Asset Panel Scene",
  width: 1920,
  height: 1080,
  frameRate: 30,
  duration: 5,
  backgroundColor: "transparent",
  layers: [],
  assets: [],
  variables: [],
  markers: [],
  guides: [],
  createdAt: 1,
  modifiedAt: 1,
};

function seedProject() {
  useProjectStore.setState({
    hasOpenProject: true,
    project: {
      ...createEmptyProject("Asset Panel Test"),
      motionCompositions: [composition],
    },
  });
}

describe("AssetPanel", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.location.hash = "";
    useNotificationStore.getState().clearAll();
    useUIStore.setState({ desktopPage: "motion" });
    useMotionStore.setState({ playhead: 2.5, selectedLayerId: null, selectedLayerIds: [] });
    seedProject();
  });

  afterEach(() => {
    configureShotloomLocale("en-US");
    cleanup();
    vi.restoreAllMocks();
    window.localStorage.clear();
    window.location.hash = "";
    useNotificationStore.getState().clearAll();
    useProjectStore.setState({ project: createEmptyProject("Reset") });
  });

  it("renders the assets header, search, category tabs and compositions list", () => {
    render(<AssetPanel composition={composition} />);

    expect(screen.getByText("Assets")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Import SVG" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Import Lottie" })).toBeTruthy();
    expect(
      screen.getByPlaceholderText(/search assets/i),
    ).toBeTruthy();
    for (const tab of ["All", "Footage", "Images", "Audio", "Solids", "Comps"]) {
      expect(screen.getByText(tab)).toBeTruthy();
    }
    expect(screen.getByText("Compositions")).toBeTruthy();
    expect(screen.getByText(composition.name)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Show scene assets only" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it.each(["en-US", "zh-CN"] as const)("adds media at the current playhead in %s without changing its name", async (locale) => {
    configureShotloomLocale(locale);
    const image: MediaItem = {
      id: "media-photo",
      name: "用户 {name} $& photo.png",
      type: "image",
      fileHandle: null,
      blob: null,
      metadata: {
        duration: 0,
        width: 1200,
        height: 800,
        frameRate: 0,
        codec: "png",
        sampleRate: 0,
        channels: 0,
        fileSize: 100,
      },
      thumbnailUrl: "data:image/png;base64,AA==",
      waveformData: null,
    };
    useProjectStore.setState((state) => ({
      project: {
        ...state.project,
        mediaLibrary: { items: [image] },
      },
    }));

    render(<AssetPanel composition={composition} />);
    fireEvent.click(screen.getByRole("button", { name: "用户 {name} $& photo.png" }));

    await waitFor(() => {
      const stored = useProjectStore.getState().getMotionComposition(composition.id);
      expect(stored?.layers).toHaveLength(1);
      expect(stored?.layers[0]).toMatchObject({
        type: "image",
        name: "用户 {name} $& photo.png",
        startTime: 2.5,
        duration: 2.5,
      });
      expect(stored?.assets).toHaveLength(1);
      expect(useMotionStore.getState().selectedLayerId).toBe(stored?.layers[0]?.id);
      expect(useNotificationStore.getState().notifications.at(-1)).toMatchObject({
        title: locale === "zh-CN" ? "已添加图层" : "Layer added",
        message: locale === "zh-CN" ? "已将 用户 {name} $& photo.png 添加到播放头位置。" : "用户 {name} $& photo.png added at the playhead.",
      });
    });
  });

  it("reuses an existing scene asset as another layer", async () => {
    const asset: MotionAsset = {
      id: "existing-image",
      type: "image",
      name: "Reusable Logo",
      width: 640,
      height: 320,
    };
    const withAsset: MotionComposition = {
      ...composition,
      assets: [asset],
    };
    useProjectStore.setState((state) => ({
      project: { ...state.project, motionCompositions: [withAsset] },
    }));

    render(<AssetPanel composition={withAsset} />);
    fireEvent.click(screen.getByRole("button", { name: "Reusable Logo" }));

    await waitFor(() => {
      const stored = useProjectStore.getState().getMotionComposition(composition.id);
      expect(stored?.layers).toHaveLength(1);
      expect(stored?.layers[0]).toMatchObject({
        assetId: asset.id,
        startTime: 2.5,
      });
      expect(stored?.assets).toHaveLength(1);
    });
  });

  it("filters Chinese categories and search without translating saved composition names", () => {
    configureShotloomLocale("zh-CN");
    const named = { ...composition, name: "用户 {name} $& 合成" };
    useProjectStore.setState((state) => ({ project: { ...state.project, motionCompositions: [named] } }));
    render(<AssetPanel composition={named} />);
    expect(screen.getByRole("button", { name: "导入 SVG" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "仅显示合成素材" }));
    expect(screen.getByRole("button", { name: "仅显示合成素材" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("此合成中还没有可复用素材。")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "合成" }));
    const input = screen.getByRole("textbox", { name: "搜索素材" });
    fireEvent.change(input, { target: { value: "不存在" } });
    expect(screen.queryByTitle("将 用户 {name} $& 合成 添加到合成")).toBeNull();
    fireEvent.change(input, { target: { value: "用户" } });
    const item = screen.getByTitle("将 用户 {name} $& 合成 添加到合成");
    fireEvent.click(item);
    expect(useMotionStore.getState().activeCompositionId).toBe(named.id);
    expect(useProjectStore.getState().project.motionCompositions?.[0].name).toBe(named.name);
  });


  it("creates a localized default scene name without renaming existing compositions", async () => {
    configureShotloomLocale("zh-CN");
    render(<AssetPanel composition={composition} />);
    fireEvent.click(screen.getByRole("button", { name: "创建运动合成" }));
    await waitFor(() => {
      const comps = useProjectStore.getState().project.motionCompositions ?? [];
      expect(comps).toHaveLength(2);
      expect(comps[0].name).toBe(composition.name);
      expect(comps[1].name).toBe("运动合成");
    });
  });

  it("retains upstream errors when adding an existing asset fails in Chinese", async () => {
    configureShotloomLocale("zh-CN");
    const withAsset = { ...composition, assets: [{ id: "failed-image", type: "image", name: "用户 {name} $&", width: 640, height: 320 } as MotionAsset] };
    const message = "storage {path} $& /用户文件.png";
    vi.spyOn(useProjectStore.getState(), "upsertMotionComposition").mockResolvedValueOnce({ success: false, error: { code: "STORAGE_FULL", message } });
    render(<AssetPanel composition={withAsset} />);
    fireEvent.click(screen.getByRole("button", { name: "用户 {name} $&" }));
    await waitFor(() => expect(useNotificationStore.getState().notifications.at(-1)).toMatchObject({ type: "error", title: "无法添加素材", message }));
    expect(useProjectStore.getState().getMotionComposition(composition.id)?.layers).toHaveLength(0);
    expect(useMotionStore.getState().selectedLayerId).toBeNull();
  });

});
