import "../../../test/install-local-storage-mock";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stickerLibrary } from "@openreel/core";
import { useEngineStore } from "../../../stores/engine-store";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useUIStore } from "../../../stores/ui-store";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { StickerPickerPanel } from "./StickerPickerPanel";

describe.each(["en-US", "zh-CN"] as const)("StickerPickerPanel custom sticker workflow (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => {
    configureShotloomLocale(locale);
    stickerLibrary.clearCustomStickers();
    useEngineStore.getState().getGraphicsEngine()?.clearCache();
    useProjectStore.setState({
      hasOpenProject: true,
      project: createEmptyProject("Custom sticker"),
    });
    useTimelineStore.setState({ playheadPosition: 3.5 });
    useUIStore.getState().clearSelection();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    configureShotloomLocale("en-US");
    stickerLibrary.clearCustomStickers();
    useEngineStore.getState().getGraphicsEngine()?.clearCache();
    useUIStore.getState().clearSelection();
    useProjectStore.setState({
      hasOpenProject: false,
      project: createEmptyProject("Reset"),
    });
  });

  it("imports, places, and selects a custom sticker at the playhead", async () => {
    render(<StickerPickerPanel />);
    const file = new File([new Uint8Array([137, 80, 78, 71])], "spark.png", {
      type: "image/png",
    });

    fireEvent.change(
      screen.getByLabelText(ui("Choose custom sticker image", "选择自定义贴纸图片")),
      { target: { files: [file] } },
    );

    await waitFor(() => {
      expect(screen.getByText(ui("spark added at 00:03:15", "已在 00:03:15 添加spark"))).toBeInTheDocument();
    });
    const state = useProjectStore.getState();
    const placementTrack = state.project.timeline.tracks.find(
      (track) => track.mode === "standard",
    );
    expect(placementTrack).toBeDefined();
    const stickers =
      useEngineStore.getState().getGraphicsEngine()?.getAllStickerClips() ?? [];
    expect(stickers).toHaveLength(1);
    expect(stickers[0]).toMatchObject({
      name: "spark",
      trackId: placementTrack?.id,
      startTime: 3.5,
      duration: 5,
    });
    expect(stickers[0]?.imageUrl).toMatch(/^data:image\/png;base64,/);
    expect(useUIStore.getState().getSelectedClipIds()).toEqual([stickers[0]?.id]);
    expect(state.project.stickerClips).toHaveLength(1);

    await state.undo();
    expect(useProjectStore.getState().project.stickerClips).toHaveLength(0);
    expect(useProjectStore.getState().project.timeline.tracks).toHaveLength(0);
  });

  it("searches translated emoji names and inserts the original emoji", async () => {
    const rasterize = vi.spyOn(stickerLibrary, "emojiToDataUrl").mockReturnValue("data:image/png;base64,dGVzdA==");
    render(<StickerPickerPanel />);
    fireEvent.change(screen.getByRole("textbox", { name: ui("Search emojis", "搜索表情") }), { target: { value: ui("Thinking", "思考") } });
    fireEvent.click(screen.getByRole("button", { name: ui("Add Thinking Face", "添加思考") }));
    await waitFor(() => expect(useProjectStore.getState().project.stickerClips).toHaveLength(1));
    expect(rasterize).toHaveBeenCalledWith("🤔");
    expect(useProjectStore.getState().project.stickerClips?.[0]).toMatchObject({ type: "emoji", name: "Thinking Face", category: "smileys", imageUrl: "data:image/png;base64,dGVzdA==", startTime: 3.5, duration: 5 });
  });

  it("rejects non-image files without changing the timeline", async () => {
    render(<StickerPickerPanel />);
    const file = new File(["not an image"], "notes.txt", {
      type: "text/plain",
    });

    fireEvent.change(
      screen.getByLabelText(ui("Choose custom sticker image", "选择自定义贴纸图片")),
      { target: { files: [file] } },
    );

    expect(
      await screen.findByRole("alert"),
    ).toHaveTextContent(ui("Choose a PNG, JPEG, WebP, GIF, or SVG image.", "请选择 PNG、JPEG、WebP、GIF 或 SVG 图片。"));
    expect(
      useProjectStore.getState().project.timeline.tracks,
    ).toHaveLength(0);
  });
});
