import { configureShotloomLocale } from "../../../../shotloom-mode";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { InspectorTabs } from "./InspectorTabs";
import { getTabsForClipType } from "../clip-tabs.config";

describe.each(["en-US", "zh-CN"] as const)("InspectorTabs (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => configureShotloomLocale(locale));
  afterEach(() => { cleanup(); configureShotloomLocale("en-US"); });
  const tabs = () => getTabsForClipType("video");

  it("renders a tab button per def", () => {
    render(<InspectorTabs tabs={tabs()} activeId="transform" onSelect={() => {}} />);
    expect(screen.getByRole("tablist", { name: ui("Inspector tabs", "属性面板选项卡") })).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(tabs().length);
  });

  it("marks the active tab aria-selected", () => {
    render(<InspectorTabs tabs={tabs()} activeId="color" onSelect={() => {}} />);
    expect(screen.getByRole("tab", { name: ui("Color", "颜色") })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: ui("Transform", "变换") })).toHaveAttribute("aria-selected", "false");
  });

  it("calls onSelect with the tab id on click", () => {
    const onSelect = vi.fn();
    render(<InspectorTabs tabs={tabs()} activeId="transform" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("tab", { name: ui("Effects", "效果") }));
    expect(onSelect).toHaveBeenCalledWith("effects");
  });
});
