import "../../../test/install-local-storage-mock";
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaItem, Template, TemplateReplacements } from "@openreel/core";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import { TemplateVariablesPanel } from "./TemplateVariablesPanel";

const makeTemplate = (): Template => {
  const project = createEmptyProject("User project");
  return { id: "original-template", name: "我的模板", description: "原始说明", category: "custom", thumbnailUrl: null, previewUrl: null, createdAt: 1, modifiedAt: 1, settings: project.settings, timeline: { ...project.timeline, tracks: [], subtitles: [] }, placeholders: [
    { id: "title-id", type: "text", label: "用户标题", description: "Do not translate this description", required: false, defaultValue: "原始标题", constraints: { maxLength: 50 } },
    { id: "subtitle-id", type: "subtitle", label: "我的字幕", required: true },
    { id: "media-id", type: "media", label: "原始素材", required: false, constraints: { mediaTypes: ["image"] } },
  ], tags: [], version: "1" };
};
const makeMedia = (id: string, type: MediaItem["type"]): MediaItem => ({ id, name: `${id}.文件`, type, fileHandle: null, blob: null, metadata: { duration: 5, width: 100, height: 100, frameRate: 30, codec: "raw", sampleRate: 48000, channels: 2, fileSize: 5 }, thumbnailUrl: null, waveformData: null });

describe.each(["en-US", "zh-CN"] as const)("template variables (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  const changed = vi.fn();
  const apply = vi.fn();
  function Form({ initial = {} }: { initial?: TemplateReplacements }) {
    const [values, setValues] = useState(initial);
    return <TemplateVariablesPanel template={makeTemplate()} values={values} onChange={next => { changed(next); setValues(next); }} onApply={apply} />;
  }
  beforeEach(() => {
    configureShotloomLocale(locale); changed.mockClear(); apply.mockClear();
    const project = createEmptyProject("User project");
    useProjectStore.setState({ project: { ...project, mediaLibrary: { ...project.mediaLibrary, items: [makeMedia("图片", "image"), makeMedia("视频", "video")] } } });
  });
  afterEach(() => { cleanup(); configureShotloomLocale("en-US"); });

  it("keeps user labels and text intact, requires the original field, then submits", () => {
    render(<Form />);
    expect(screen.getByText("Do not translate this description")).toBeInTheDocument();
    expect(screen.getByText(ui("Fill in required fields: 我的字幕", "请填写必填项：我的字幕"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ui("Apply Template", "应用模板") })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "用户标题" }), { target: { value: "Original 用户文本" } });
    fireEvent.change(screen.getByRole("textbox", { name: "我的字幕" }), { target: { value: "Subtitle 原文" } });
    expect(changed).toHaveBeenLastCalledWith({ "title-id": { type: "text", value: "Original 用户文本" }, "subtitle-id": { type: "subtitle", value: "Subtitle 原文" } });
    fireEvent.click(screen.getByRole("button", { name: ui("Apply Template", "应用模板") }));
    expect(apply).toHaveBeenCalledOnce();
  });

  it("filters media and immediately resets text, subtitle and selection to defaults", () => {
    render(<Form initial={{ "title-id": { type: "text", value: "" }, "subtitle-id": { type: "subtitle", value: "Changed subtitle" } }} />);
    expect(screen.getByRole("textbox", { name: "用户标题" })).toHaveValue("");
    const image = screen.getByRole("checkbox", { name: "图片.文件" });
    expect(screen.queryByRole("checkbox", { name: "视频.文件" })).not.toBeInTheDocument();
    fireEvent.click(image);
    expect(changed.mock.calls.at(-1)?.[0]["media-id"]).toEqual({ type: "media", value: "图片" });
    fireEvent.click(screen.getByRole("button", { name: ui("Reset All", "全部重置") }));
    expect(changed).toHaveBeenLastCalledWith({});
    expect(screen.getByRole("textbox", { name: "用户标题" })).toHaveValue("原始标题");
    expect(screen.getByRole("textbox", { name: "我的字幕" })).toHaveValue("");
    expect(screen.getByRole("checkbox", { name: "图片.文件" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("button", { name: ui("Apply Template", "应用模板") })).toBeDisabled();
  });

  it("resets a changed text field without changing other replacement IDs", () => {
    render(<Form initial={{ "title-id": { type: "text", value: "Changed" }, "media-id": { type: "media", value: "图片" } }} />);
    fireEvent.click(screen.getByRole("button", { name: ui("Reset to default", "重置为默认值") }));
    expect(changed).toHaveBeenLastCalledWith({ "media-id": { type: "media", value: "图片" } });
    expect(screen.getByRole("textbox", { name: "用户标题" })).toHaveValue("原始标题");
  });

  it("localizes absent templates, no variables and unavailable media", () => {
    const view = render(<TemplateVariablesPanel template={null} values={{}} onChange={changed} />);
    expect(screen.getByText(ui("Select a template to edit variables", "选择模板以编辑变量"))).toBeInTheDocument();
    view.rerender(<TemplateVariablesPanel template={{ ...makeTemplate(), placeholders: [] }} values={{}} onChange={changed} />);
    expect(screen.getByText(ui("This template has no editable variables", "此模板没有可编辑的变量"))).toBeInTheDocument();
    useProjectStore.setState({ project: createEmptyProject("No media") });
    view.rerender(<TemplateVariablesPanel template={makeTemplate()} values={{}} onChange={changed} />);
    expect(screen.getByText(ui("No media available", "暂无可用素材"))).toBeInTheDocument();
  });
});
