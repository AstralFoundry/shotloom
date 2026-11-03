import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => {
  const state: any = {
    project: {}, hasOpenProject: true,
    importMedia: vi.fn(),
    loadProject: (project: any) => { state.project = project; },
    getFullProject: () => state.project,
    actionHistory: { restoreEntries: vi.fn(), getHistoryEntries: () => [], getRedoEntries: () => [] },
    canUndo: () => false, canRedo: () => false,
  };
  const project = { getState: () => state, setState: (value: any) => Object.assign(state, value), subscribe: () => () => {} };
  const timelineState: any = { playheadPosition: 0, pixelsPerSecond: 50, scrollX: 0, scrollY: 0 };
  const timeline = { getState: () => timelineState, setState: (value: any) => Object.assign(timelineState, value), subscribe: () => () => {} };
  const ui = { getState: () => ({ selectedItems: [], setSkipWelcomeScreen() {}, clearSelection() {} }), setState() {}, subscribe: () => () => {} };
  return { state, project, timeline, ui, disposeEngine: vi.fn(), disposePlayback: vi.fn(), disposeAudio: vi.fn(), disposeEffects: vi.fn(), disposeTransitions: vi.fn() };
});

vi.mock("./stores/project-store", () => ({ useProjectStore: fixture.project }));
vi.mock("./stores/timeline-store", () => ({ useTimelineStore: fixture.timeline }));
vi.mock("./stores/ui-store", () => ({ useUIStore: fixture.ui }));
vi.mock("./stores/theme-store", () => ({ useThemeStore: { getState: () => ({ setMode() {} }) } }));
vi.mock("./bridges/playback-bridge", () => ({ initializePlaybackBridge: async () => {}, getPlaybackBridge: () => ({ seek: async () => {}, pause() {} }), disposePlaybackBridge: fixture.disposePlayback }));
vi.mock("./bridges/media-bridge", () => ({ initializeMediaBridge: async () => {} }));
vi.mock("./bridges/render-bridge", () => ({ initializeRenderBridge: async () => {} }));
vi.mock("./bridges/audio-bridge", () => ({ disposeAudioBridge: fixture.disposeAudio }));
vi.mock("./stores/engine-store", () => ({ useEngineStore: { getState: () => ({ initialized: true, dispose: fixture.disposeEngine }) } }));
vi.mock("./bridges/effects-bridge", () => ({ disposeEffectsBridge: fixture.disposeEffects, initializeEffectsBridge: async () => {} }));
vi.mock("./bridges/transition-bridge", () => ({ disposeTransitionBridge: fixture.disposeTransitions, initializeTransitionBridge() {} }));
vi.mock("./services/media-storage", () => ({ saveMediaBlob: async () => {} }));
vi.mock("./services/auto-save", () => ({ serializeProjectForAutoSave: JSON.stringify }));
vi.mock("./services/agent/editing-session", () => ({ EditingSession: class {} }));
vi.mock("./shotloom-mode", async (importOriginal) => {
  const original = await importOriginal<typeof import("./shotloom-mode")>();
  return {
  ...original,
  get shotloomMessage() { return original.shotloomMessage; },
  isShotloomMode: true, setShotloomPresentation() {}, setShotloomActive() {},
  isShotloomActive: () => false, syncShotloomPresentationClass() {}, bindShotloomHost() {},
};
});

import { collectShotloomState, createEmbeddedRuntime } from "./shotloom-bridge";

function payload() {
  return {
    assets: [{ key: "stable-asset", name: "broken.mp4", type: "video", bytes: new ArrayBuffer(3) }],
    tracks: [], width: 640, height: 360, fps: 30, duration: 7,
    nativeProject: {
      id: "native-owner", name: "Existing", settings: { width: 640, height: 360, frameRate: 30 },
      mediaLibrary: { items: [{ id: "original-media", shotloomAssetId: "stable-asset", name: "broken.mp4", type: "video", metadata: { duration: 10 } }] },
      timeline: { duration: 7, subtitles: [], markers: [], tracks: [{ id: "track", type: "video", clips: [{ id: "clip", mediaId: "original-media", startTime: 2, duration: 5, inPoint: 3, outPoint: 8, effects: [{ type: "blur" }] }] }] },
      textClips: [{ id: "caption", text: "保留字幕" }],
      shotloomSession: { undo: [{ id: "undo" }], redo: [], playhead: 4, view: { pixelsPerSecond: 120, scrollX: 30, scrollY: 0 } },
    },
  };
}

function runtime(locale = "zh-CN") {
  return createEmbeddedRuntime({
    root: document.body, shadowRoot: {} as ShadowRoot, presentation: "canvas", active: true,
    host: { app: { locale }, ready: Promise.resolve(), ui: {}, project: { bindFlush: () => () => {} } } as any,
    events: { onState() {}, onStatus() {}, onError() {}, onExportProgress() {} },
  });
}
async function load(value: unknown): Promise<Array<{type: string; error?: string}>> {
  try { await runtime().load(value as any); return [{ type: "shotloom:loaded" }]; }
  catch (error) { return [{ type: "shotloom:error", error: String(error) }]; }
}

describe("native media recovery through the direct runtime API", () => {
  beforeEach(() => { fixture.state.importMedia.mockReset(); fixture.state.actionHistory.restoreEntries.mockClear(); });

  it("localizes runtime failures without translating user filenames or upstream errors", async () => {
    const value = payload();
    value.assets[0].key = "unrecorded-localized-asset";
    value.assets[0].name = "用户素材 {name}.mp4";
    fixture.state.importMedia.mockResolvedValue({ success: false, error: { message: "原始解码错误 {name}" } });
    await expect(runtime("en-US").load(value as any)).rejects.toThrow(
      "Failed to import media: 用户素材 {name}.mp4 (原始解码错误 {name})");
    expect(value.assets[0].name).toBe("用户素材 {name}.mp4");
    fixture.state.exportSRT = vi.fn(async () => "");
    await expect(runtime("en-US").export({ format: "srt" })).rejects.toThrow("The current timeline has no subtitles to export.");
    await expect(runtime("zh-CN").export({ format: "srt" })).rejects.toThrow("当前时间线没有可导出的字幕");
  });

  it("waits for slow media recovery and then restores authoritative history", async () => {
    let finish!: (result: unknown) => void;
    fixture.state.importMedia.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const value = payload();
    const pending = load(value);
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    finish({ success: false, error: { message: "missing original file" } });
    const result = await pending;
    expect(result[0].type).toBe("shotloom:loaded");
    expect(collectShotloomState().overview).not.toHaveProperty("actionHistory");
    expect(fixture.state.project.timeline).toEqual(value.nativeProject.timeline);
    expect(fixture.state.actionHistory.restoreEntries).toHaveBeenCalledWith([{ id: "undo" }], []);
  });

  it("keeps timeline, effects, text, identity and history when an existing file cannot decode", async () => {
    const value = payload();
    fixture.state.importMedia.mockResolvedValue({ success: false, error: { message: "invalid container" } });
    const messages = await load(value);
    expect(messages.some(m => m.type === "shotloom:loaded")).toBe(true);
    expect(fixture.state.project.timeline).toEqual(value.nativeProject.timeline);
    expect(fixture.state.project.textClips).toEqual(value.nativeProject.textClips);
    expect(fixture.state.project.mediaLibrary.items[0]).toMatchObject({
      id: "original-media", shotloomAssetId: "stable-asset", isPlaceholder: true,
      shotloomOfflineReason: expect.stringContaining("invalid container"), blob: null,
    });
    expect(fixture.state.actionHistory.restoreEntries).toHaveBeenCalledWith([{ id: "undo" }], []);
    expect(fixture.timeline.getState()).toMatchObject(value.nativeProject.shotloomSession.view);
  });

  it("does not disguise a failed new import as an existing offline asset", async () => {
    const value = payload();
    value.assets[0].key = "unrecorded-asset";
    fixture.state.importMedia.mockResolvedValue({ success: false, error: { message: "new import failure" } });
    const messages = await load(value);
    expect(messages.find(m => m.type === "shotloom:error")?.error).toContain("new import failure");
    expect(messages.some(m => m.type === "shotloom:loaded")).toBe(false);
  });

  it("does not complete a stale load after its native project was replaced", async () => {
    fixture.state.importMedia.mockImplementation(async () => {
      fixture.state.project = { ...fixture.state.project, id: "another-project" };
      return { success: false, error: { message: "interrupted" } };
    });
    const messages = await load(payload());
    expect(messages.some(m => m.type === "shotloom:loaded")).toBe(false);
    expect(fixture.state.project.id).toBe("another-project");
  });

  it("releases document-owned resources once on departure, preserving a cached page", () => {
    const disposers = [fixture.disposeEngine, fixture.disposePlayback, fixture.disposeAudio, fixture.disposeEffects, fixture.disposeTransitions];
    disposers.forEach(dispose => dispose.mockClear());
    const cached = new Event("pagehide");
    Object.defineProperty(cached, "persisted", { value: true });
    window.dispatchEvent(cached);
    disposers.forEach(dispose => expect(dispose).not.toHaveBeenCalled());
    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(new Event("pagehide"));
    disposers.forEach(dispose => expect(dispose).toHaveBeenCalledTimes(1));
  });
});
