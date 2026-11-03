import "../../../test/install-local-storage-mock";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Transform } from "@openreel/core";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { AlignmentSection } from "./AlignmentSection";
const transform: Transform = { position: { x: 0.2, y: 0.3 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, anchor: { x: 0.5, y: 0.5 } };
describe.each(["en-US", "zh-CN"] as const)("alignment (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => configureShotloomLocale(locale));
  afterEach(() => { cleanup(); configureShotloomLocale("en-US"); });
  it.each(["text", "video"])("keeps %s coordinate semantics with translated actions", (clipType) => {
    const onTransformChange = vi.fn();
    render(<AlignmentSection clipType={clipType} transform={transform} canvasWidth={1920} canvasHeight={1080} onTransformChange={onTransformChange} />);
    const normalized = clipType === "text";
    for (const [en, zh, axis, value] of [
      ["Align Left", "左对齐", "x", normalized ? 0 : -960],
      ["Center Horizontally", "水平居中", "x", normalized ? 0.5 : 0],
      ["Align Right", "右对齐", "x", normalized ? 1 : 960],
      ["Align Top", "顶部对齐", "y", normalized ? 0 : -540],
      ["Center Vertically", "垂直居中", "y", normalized ? 0.5 : 0],
      ["Align Bottom", "底部对齐", "y", normalized ? 1 : 540],
    ] as const) {
      fireEvent.click(screen.getByRole("button", { name: ui(en, zh) }));
      expect(onTransformChange).toHaveBeenLastCalledWith({ position: { ...transform.position, [axis]: value } });
    }
    fireEvent.click(screen.getByRole("button", { name: ui("Center on Canvas", "在画布上居中") }));
    expect(onTransformChange).toHaveBeenLastCalledWith({ position: normalized ? { x: 0.5, y: 0.5 } : { x: 0, y: 0 } });
  });
});
