import "../../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TextClip } from "@openreel/core";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useEngineStore } from "../../../stores/engine-store";
import { useProjectStore } from "../../../stores/project-store";
import { registerCustomFont } from "./font-options";
import { TextSection } from "./TextSection";
const caption = (id: string): TextClip => ({ id, trackId: "track", startTime: 0, duration: 5, text: "Original 原文 {name}", style: { fontFamily: "Inter", fontSize: 48, fontWeight: "normal", fontStyle: "normal", color: "#ffffff", textAlign: "left", verticalAlign: "middle", lineHeight: 1.2, letterSpacing: 0 }, transform: { position: { x: 0.2, y: 0.3 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 }, keyframes: [] });
describe.each(["en-US", "zh-CN"] as const)("text controls (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => {
    configureShotloomLocale(locale);
    const clips = [caption("first"), caption("second")];
    useEngineStore.getState().getTitleEngine()?.clear();
    useEngineStore.getState().getTitleEngine()?.loadTextClips(clips);
    useProjectStore.setState({ hasOpenProject: true, project: { ...createEmptyProject("Original project"), textClips: clips, modifiedAt: Date.now() } });
  });
  afterEach(() => { cleanup(); useEngineStore.getState().getTitleEngine()?.clear(); configureShotloomLocale("en-US"); });
  it("edits original text and style values through localized controls", async () => {
    render(<TextSection clipId="first" />);
    const input = screen.getByRole("textbox", { name: ui("Text Content", "文字内容") });
    expect(input).toHaveValue("Original 原文 {name}");
    fireEvent.change(input, { target: { value: "Edited 原文 {name} $&" } });
    expect(useProjectStore.getState().getTextClip("first")?.text).toBe("Edited 原文 {name} $&");
    for (const [en, zh] of [["Bold", "加粗"], ["Italic", "斜体"], ["Underline", "下划线"], ["Right", "右对齐"]]) {
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: ui(en, zh) })); });
    }
    expect(useProjectStore.getState().getTextClip("first")?.style).toMatchObject({ fontFamily: "Inter", fontWeight: "bold", fontStyle: "italic", textDecoration: "underline", textAlign: "right", color: "#ffffff" });
    expect(screen.getByRole("button", { name: ui("Select text color", "选择文字颜色") })).toBeInTheDocument();
  });
  it("centers selected clips and enables 3D using original properties", async () => {
    render(<TextSection clipId="first" clipIds={["first", "second"]} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: ui("Center Both", "水平垂直居中") })); });
    await act(async () => { fireEvent.click(screen.getByRole("switch", { name: ui("3D Text", "三维文字") })); });
    for (const id of ["first", "second"]) {
      expect(useProjectStore.getState().getTextClip(id)).toMatchObject({ text: "Original 原文 {name}", transform: { position: { x: 0.5, y: 0.5 } }, text3d: { enabled: true, material: "physical", depth: 12 } });
    }
  });
  it("localizes rejected custom font formats without loading the file", async () => {
    expect(await registerCustomFont(new File(["not a font"], "original.png"))).toEqual({ success: false, error: ui("Please upload a .ttf, .otf, .woff, or .woff2 font file.", "请上传 .ttf、.otf、.woff 或 .woff2 字体文件。") });
  });
});
