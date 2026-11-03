import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { MarkerIndicator } from "./MarkerIndicator";

describe.each(["en-US", "zh-CN"] as const)("marker controls (%s)", (locale) => {
  const marker = { id: "marker-original", time: 2.5, label: "Scene A · 用户内容", color: "#112233" };
  beforeEach(() => configureShotloomLocale(locale));
  afterEach(() => { cleanup(); configureShotloomLocale("en-US"); });
  it("localizes editing and removal while preserving authored labels and identifiers", () => {
    const onSeek = vi.fn(), onRemove = vi.fn(), onUpdate = vi.fn();
    const { container } = render(<MarkerIndicator marker={marker} pixelsPerSecond={60} scrollX={30} onSeek={onSeek} onRemove={onRemove} onUpdate={onUpdate} />);
    expect(container.firstChild).toHaveStyle({ left: "120px" });
    fireEvent.click(screen.getByText(marker.label));
    expect(onSeek).toHaveBeenCalledWith(2.5);
    fireEvent.doubleClick(screen.getByText(marker.label));
    const input = screen.getByRole("textbox", { name: locale === "zh-CN" ? "标记名称" : "Marker label" });
    expect(input).toHaveValue(marker.label);
    fireEvent.change(input, { target: { value: "New 用户标记" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onUpdate).toHaveBeenCalledWith(marker.id, { label: "New 用户标记" });
    fireEvent.mouseEnter(container.firstChild as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: locale === "zh-CN" ? "移除标记" : "Remove marker" }));
    expect(onRemove).toHaveBeenCalledWith(marker.id);
  });
});
