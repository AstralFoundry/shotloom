import "../../../test/install-local-storage-mock";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MUSIC_GENRES, MOOD_TAGS, SFX_CATEGORIES, type SoundItem, type SoundLibraryEngine } from "@openreel/core";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { useProjectStore } from "../../../stores/project-store";
import { useEngineStore } from "../../../stores/engine-store";
import { MusicLibraryPanel } from "./MusicLibraryPanel";

const music: SoundItem = {
  id: "music-electronic-beat-1", name: "Electronic Beat", category: "music", subcategory: "electronic",
  duration: 8.5, bpm: 128, tags: ["My custom tag"], mood: ["happy"],
  previewUrl: "", downloadUrl: "", isBuiltin: true, license: "royalty-free",
};
const other: SoundItem = { ...music, id: "user-music", name: "用户原声", subcategory: "jazz", duration: 65, mood: ["sad"], isBuiltin: false };
const sfx: SoundItem = { ...music, id: "sfx-ui-click-1", name: "Click", category: "sfx", subcategory: "ui", mood: undefined, bpm: undefined, duration: 0.3 };
const originalGetEngine = useEngineStore.getState().getSoundLibraryEngine;
const originalImport = useProjectStore.getState().importMedia;
const originalAdd = useProjectStore.getState().addClipToNewTrack;
const preview = vi.fn(async () => {});
const stop = vi.fn();
const blob = new Blob(["wave-data"], { type: "audio/wav" });
const getBlob = vi.fn((): Blob | null => blob);
const importMedia = vi.fn(async (_file: File) => ({ success: true, actionId: "actual-media-id" }));
const addClip = vi.fn(async () => ({ success: true }));

describe.each(["en-US", "zh-CN"] as const)("Music library (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => {
    vi.clearAllMocks(); configureShotloomLocale(locale);
    getBlob.mockReturnValue(blob);
    useEngineStore.setState({ getSoundLibraryEngine: async () => ({ getMusic: () => [music, other], getSFX: () => [sfx], stopPreview: stop, previewSound: preview, getSoundBlob: getBlob }) as unknown as SoundLibraryEngine });
    useProjectStore.setState({ importMedia, addClipToNewTrack: addClip });
  });
  afterEach(() => {
    cleanup(); configureShotloomLocale("en-US");
    useEngineStore.setState({ getSoundLibraryEngine: originalGetEngine });
    useProjectStore.setState({ importMedia: originalImport, addClipToNewTrack: originalAdd });
  });
  async function open() {
    render(<MusicLibraryPanel />);
    await screen.findByText(ui("Electronic Beat", "电子节拍"));
  }
  it("shows translated catalog and controls while preserving authored names, tags and metadata", async () => {
    await open();
    expect(screen.getByText(ui("Music & SFX", "音乐与音效"))).toBeInTheDocument();
    expect(screen.getByText(ui("8.5s", "8.5秒"))).toBeInTheDocument();
    expect(screen.getByText("1:05")).toBeInTheDocument();
    expect(screen.getAllByText("128 BPM")).toHaveLength(2);
    expect(screen.getByText("用户原声")).toBeInTheDocument();
    expect(screen.getAllByText("My custom tag")).toHaveLength(2);
    expect(screen.getByRole("textbox", { name: ui("Search sounds", "搜索声音") })).toHaveAttribute("placeholder", ui("Search sounds...", "搜索声音…"));
    expect(MUSIC_GENRES).toHaveLength(12); expect(SFX_CATEGORIES).toHaveLength(11); expect(MOOD_TAGS).toHaveLength(12);
  });
  it("filters by stable genre and mood IDs and searches both original and translated names", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: ui("Jazz", "爵士") }));
    expect(screen.queryByText(ui("Electronic Beat", "电子节拍"))).not.toBeInTheDocument();
    expect(screen.getByText("用户原声")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ui("All", "全部") }));
    fireEvent.click(screen.getByRole("button", { name: ui("Happy", "快乐") }));
    expect(screen.queryByText("用户原声")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ui("Happy", "快乐") }));
    const search = screen.getByRole("textbox", { name: ui("Search sounds", "搜索声音") });
    for (const text of ["Electronic", ui("Beat", "节拍")]) {
      fireEvent.change(search, { target: { value: text } });
      expect(screen.getByText(ui("Electronic Beat", "电子节拍"))).toBeInTheDocument();
      expect(screen.queryByText("用户原声")).not.toBeInTheDocument();
    }
    fireEvent.change(search, { target: { value: "not found" } });
    expect(screen.getByText(ui("No sounds found", "未找到声音"))).toBeInTheDocument();
  });
  it("previews and stops the original sound object through translated buttons", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: ui("Preview Electronic Beat", "试听电子节拍") }));
    await waitFor(() => expect(preview).toHaveBeenCalledWith(music));
    fireEvent.click(screen.getByRole("button", { name: ui("Stop Electronic Beat", "停止电子节拍") }));
    await waitFor(() => expect(screen.getByRole("button", { name: ui("Preview Electronic Beat", "试听电子节拍") })).toBeInTheDocument());
    expect(stop).toHaveBeenCalledTimes(2);
  });
  it("imports the original filename and uses the returned media ID for timeline addition", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: ui("Add Electronic Beat to timeline", "将电子节拍添加到时间线") }));
    await waitFor(() => expect(addClip).toHaveBeenCalledWith("actual-media-id"));
    expect(getBlob).toHaveBeenCalledWith("music-electronic-beat-1");
    const file = importMedia.mock.calls[0][0] as File;
    expect(file.name).toBe("Electronic Beat.wav"); expect(file.type).toBe("audio/wav"); expect(file.size).toBe(blob.size);
  });
  it("switches to translated SFX categories and retains original filters", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: ui("Sound FX", "音效") }));
    expect(await screen.findByText(ui("Click", "点击"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ui("Nature", "自然") }));
    expect(screen.getByText(ui("No sounds found", "未找到声音"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ui("UI Sounds", "界面音效") }));
    expect(screen.getByText(ui("Click", "点击"))).toBeInTheDocument();
  });
});
