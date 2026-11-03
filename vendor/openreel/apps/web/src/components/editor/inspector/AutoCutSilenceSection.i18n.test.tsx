import "../../../test/install-local-storage-mock";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAudioEngine, type Clip, type MediaItem } from "@openreel/core";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import { useNotificationStore } from "../../../stores/notification-store";
import { getSilenceCutBridge, disposeSilenceCutBridge } from "../../../bridges/silence-cut-bridge";
import { AutoCutSilenceSection } from "./AutoCutSilenceSection";

const clip: Clip = { id: "silence-clip", mediaId: "user-audio", trackId: "track", startTime: 3, duration: 8, inPoint: 0, outPoint: 8, effects: [], audioEffects: [], keyframes: [], volume: 1, transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, anchor: { x: 0.5, y: 0.5 } } };
const media: MediaItem = { id: "user-audio", name: "原始音频.wav", type: "audio", fileHandle: null, blob: new Blob(["audio"]), thumbnailUrl: null, waveformData: null, metadata: { duration: 8, width: 0, height: 0, frameRate: 0, codec: "wav", sampleRate: 48000, channels: 2, fileSize: 5 } };

describe.each(["en-US", "zh-CN"] as const)("silence removal localization (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => {
    configureShotloomLocale(locale);
    useNotificationStore.getState().clearAll();
    const project = createEmptyProject("User project");
    useProjectStore.setState({ hasOpenProject: true, project: { ...project, mediaLibrary: { ...project.mediaLibrary, items: [media] }, timeline: { ...project.timeline, duration: 11, tracks: [{ id: "track", name: "Original track", type: "audio", clips: [structuredClone(clip)], transitions: [], locked: false, hidden: false, muted: false, solo: false }] } } });
  });
  afterEach(() => { cleanup(); disposeSilenceCutBridge(); Reflect.deleteProperty(media.blob!, "arrayBuffer"); vi.restoreAllMocks(); vi.unstubAllGlobals(); useNotificationStore.getState().clearAll(); configureShotloomLocale("en-US"); useProjectStore.setState({ hasOpenProject: false }); });

  it("passes the translated slider settings and original clip to analysis and cutting", async () => {
    const result = { silentRegions: [{ start: 1, end: 3, duration: 2 }, { start: 5, end: 6, duration: 1 }], totalSilenceDuration: 3, clipDuration: 8 };
    const bridge = getSilenceCutBridge();
    const analyze = vi.spyOn(bridge, "analyzeClip").mockResolvedValue(result);
    const cut = vi.spyOn(bridge, "cutSilence").mockResolvedValue({ success: true });
    render(<AutoCutSilenceSection clipId={clip.id} />);
    fireEvent.keyDown(screen.getByRole("slider", { name: ui("Silence Threshold", "静音阈值") }), { key: "ArrowRight" });
    fireEvent.click(screen.getByRole("button", { name: ui("Analyze", "分析") }));
    await waitFor(() => expect(screen.getByText(ui("3.0s of 8.0s (38%)", "共 8.0 秒，静音 3.0 秒（38%）"))).toBeInTheDocument());
    expect(analyze).toHaveBeenCalledWith(clip.id, { threshold: -39, minSilenceDuration: 0.5, paddingBefore: 0.1, paddingAfter: 0.1 }, expect.any(Function));
    fireEvent.click(screen.getByRole("button", { name: ui("Cut 2", "剪除 2 段") }));
    await waitFor(() => expect(cut).toHaveBeenCalledWith(clip.id, result.silentRegions, expect.any(Function)));
    await waitFor(() => expect(useNotificationStore.getState().notifications.at(-1)).toMatchObject({ type: "success", title: ui("Silence Removed", "已移除静音"), message: ui("Removed 2 silent sections", "已移除 2 个静音片段") }));
    expect(useProjectStore.getState().getMediaItem(media.id)?.name).toBe(media.name);
  });

  it("shows the empty analysis notice and preserves upstream error details", async () => {
    const analyze = vi.spyOn(getSilenceCutBridge(), "analyzeClip").mockResolvedValue({ silentRegions: [], totalSilenceDuration: 0, clipDuration: 8 });
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<AutoCutSilenceSection clipId={clip.id} />);
    fireEvent.click(screen.getByRole("button", { name: ui("Analyze", "分析") }));
    await waitFor(() => expect(useNotificationStore.getState().notifications.at(-1)?.title).toBe(ui("No Silence Detected", "未检测到静音")));
    expect(screen.queryByRole("button", { name: ui("Cut 0", "剪除 0 段") })).not.toBeInTheDocument();
    analyze.mockRejectedValue(new Error("decode: 原始音频.wav"));
    fireEvent.click(screen.getByRole("button", { name: ui("Re-analyze", "重新分析") }));
    await waitFor(() => expect(useNotificationStore.getState().notifications.at(-1)).toMatchObject({ title: ui("Analysis Failed", "分析失败"), message: "decode: 原始音频.wav" }));
  });

  it("localizes actual bridge progress while keeping silence bounds and raw threshold", async () => {
    const decoded = { duration: 8 } as AudioBuffer;
    const bytes = new ArrayBuffer(4);
    Object.defineProperty(media.blob!, "arrayBuffer", { configurable: true, value: vi.fn().mockResolvedValue(bytes) });
    const decode = vi.spyOn(AudioContext.prototype, "decodeAudioData").mockResolvedValue(decoded);
    const detect = vi.spyOn(getAudioEngine(), "detectSilence").mockReturnValue([{ start: 1, end: 3 }]);
    const progress: string[] = [];
    const result = await getSilenceCutBridge().analyzeClip(clip.id, { threshold: -42, minSilenceDuration: 0.5, paddingBefore: 0.1, paddingAfter: 0.2 }, (_value, message) => progress.push(message));
    expect(decode).toHaveBeenCalledWith(bytes);
    expect(detect).toHaveBeenCalledWith(decoded, -42);
    expect(result.silentRegions).toEqual([{ start: 1.1, end: 2.8, duration: 2.8 - 1.1 }]);
    expect(progress).toEqual(locale === "zh-CN" ? ["正在加载音频…", "正在检测静音…", "正在处理结果…", "正在完成处理…", "已完成"] : ["Loading audio...", "Detecting silence...", "Processing results...", "Finalizing...", "Complete"]);
    await expect(getSilenceCutBridge().analyzeClip("missing", { threshold: -40, minSilenceDuration: 0.5, paddingBefore: 0, paddingAfter: 0 })).rejects.toThrow(ui("Clip not found", "未找到片段"));
  });
});
