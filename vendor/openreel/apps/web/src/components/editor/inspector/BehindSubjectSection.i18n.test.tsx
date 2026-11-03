import "../../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPersonSegmentationEngine, type TextClip } from "@openreel/core";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useEngineStore } from "../../../stores/engine-store";
import { useProjectStore } from "../../../stores/project-store";
import { BehindSubjectSection } from "./BehindSubjectSection";
const caption = (id: string): TextClip => ({ id, trackId: "track", startTime: 0, duration: 5, text: "Original 原文 {name}", style: { fontFamily: "Inter", fontSize: 48, fontWeight: "normal", fontStyle: "normal", color: "#ffffff", textAlign: "left", verticalAlign: "middle", lineHeight: 1.2, letterSpacing: 0 }, transform: { position: { x: 0.2, y: 0.3 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 }, keyframes: [] });
describe.each(["en-US", "zh-CN"] as const)("Behind subject (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  const textClip = () => useEngineStore.getState().getTitleEngine()?.getTextClip("first");
  beforeEach(() => {
    configureShotloomLocale(locale);
    const clips = [caption("first")];
    useEngineStore.getState().getTitleEngine()?.clear();
    useEngineStore.getState().getTitleEngine()?.loadTextClips(clips);
    useProjectStore.setState({ hasOpenProject: true, project: { ...createEmptyProject("Original project"), textClips: clips } });
    vi.spyOn(getPersonSegmentationEngine(), "isInitialized").mockReturnValue(false);
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); useEngineStore.getState().getTitleEngine()?.clear(); configureShotloomLocale("en-US"); });
  it("shows model loading and saves the real text property when initialization succeeds", async () => {
    let resolve!: () => void;
    vi.spyOn(getPersonSegmentationEngine(), "initialize").mockReturnValue(new Promise<void>((done) => { resolve = done; }));
    render(<BehindSubjectSection clipId="first" />);
    fireEvent.click(screen.getByRole("switch", { name: ui("Place Behind Subject", "置于主体后方") }));
    expect(screen.getByText(ui("Loading AI model...", "正在加载 AI 模型…"))).toBeInTheDocument();
    await act(async () => resolve());
    await waitFor(() => expect(textClip()?.behindSubject).toBe(true));
    expect(useProjectStore.getState().project.textClips?.[0].behindSubject).toBe(true);
    expect(textClip()?.text).toBe("Original 原文 {name}");
    expect(screen.getByRole("switch", { name: ui("Place Behind Subject", "置于主体后方") })).toBeChecked();
  });
  it("localizes initialization failure and restores the disabled property", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(getPersonSegmentationEngine(), "initialize").mockRejectedValue(new Error("model unavailable"));
    render(<BehindSubjectSection clipId="first" />);
    fireEvent.click(screen.getByRole("switch", { name: ui("Place Behind Subject", "置于主体后方") }));
    expect(await screen.findByText(ui("Failed to load AI model. Check your connection.", "AI 模型加载失败，请检查网络连接。"))).toBeInTheDocument();
    expect(textClip()?.behindSubject).toBe(false);
    expect(screen.getByRole("switch", { name: ui("Place Behind Subject", "置于主体后方") })).not.toBeChecked();
  });
  it("disables an existing effect without loading the model again", () => {
    useProjectStore.getState().updateTextBehindSubject("first", true);
    const initialize = vi.spyOn(getPersonSegmentationEngine(), "initialize");
    render(<BehindSubjectSection clipId="first" />);
    fireEvent.click(screen.getByRole("switch", { name: ui("Place Behind Subject", "置于主体后方") }));
    expect(textClip()?.behindSubject).toBe(false);
    expect(initialize).not.toHaveBeenCalled();
  });
});
