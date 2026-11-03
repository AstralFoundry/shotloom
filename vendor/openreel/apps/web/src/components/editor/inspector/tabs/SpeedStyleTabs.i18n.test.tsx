import "../../../../test/install-local-storage-mock";
import { configureShotloomLocale } from "../../../../shotloom-mode";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpeedTab } from "./SpeedTab";
import { StyleTab } from "./StyleTab";

vi.mock("../", () => ({
  SpeedSection: ({ clip }: { clip: { id: string } }) => <div data-testid="speed">{clip.id}</div>,
  StabilizationSection: ({ clip }: { clip: { id: string } }) => <div data-testid="stabilization">{clip.id}</div>,
  SpeedRampSection: ({ clip }: { clip: { id: string } }) => <div data-testid="curves">{clip.id}</div>,
  TextSection: ({ clipId }: { clipId: string }) => <div data-testid="text">{clipId}</div>,
  ShapeSection: ({ clipId }: { clipId: string }) => <div data-testid="shape">{clipId}</div>,
  SVGSection: ({ clipId }: { clipId: string }) => <div data-testid="svg">{clipId}</div>,
}));

describe.each(["en-US", "zh-CN"] as const)("Speed and style sections (%s)", locale => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => configureShotloomLocale(locale));
  afterEach(() => { cleanup(); configureShotloomLocale("en-US"); });
  function openSection(en: string, zh: string) {
    const title = ui(en, zh);
    const expand = screen.getByRole("button", { name: ui(`Expand ${title} section`, `展开${title}区域`) });
    expect(expand).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(expand);
    const collapse = screen.getByRole("button", { name: ui(`Collapse ${title} section`, `收起${title}区域`) });
    expect(collapse).toHaveAttribute("aria-expanded", "true");
    return collapse;
  }
  it("opens localized speed groups with the original selected clip", () => {
    render(<SpeedTab showVideoControls selectedClip={{ id: "original-clip", mediaId: "original-media" }} />);
    for (const [en, zh, id] of [
      ["Speed & Direction", "速度与方向", "speed"],
      ["Stabilization", "防抖", "stabilization"],
      ["Speed Curves", "速度曲线", "curves"],
    ]) {
      const collapse = openSection(en, zh);
      expect(screen.getByTestId(id)).toHaveTextContent("original-clip");
      fireEvent.click(collapse);
      expect(collapse).toHaveAttribute("aria-expanded", "false");
    }
  });
  it("preserves speed control eligibility for generated and missing clips", () => {
    const { rerender } = render(<SpeedTab showVideoControls={false} selectedClip={{ id: "clip", mediaId: "media" }} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    for (const mediaId of ["text-1", "shape-1", "svg-1", "sticker-1"]) {
      rerender(<SpeedTab showVideoControls selectedClip={{ id: "clip", mediaId }} />);
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    }
    rerender(<SpeedTab showVideoControls selectedClip={null} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
  it("opens localized style groups with the original clip identifier", () => {
    render(<StyleTab clipId="user-clip" showTextSection showShapeSection showSVGSection />);
    for (const [en, zh, id] of [
      ["Text Properties", "文字属性", "text"],
      ["Shape Properties", "形状属性", "shape"],
      ["SVG Properties", "SVG 属性", "svg"],
    ]) {
      openSection(en, zh);
      expect(screen.getByTestId(id)).toHaveTextContent("user-clip");
    }
  });
  it("shows only the requested style groups", () => {
    const { rerender } = render(<StyleTab clipId="clip" showTextSection={false} showShapeSection showSVGSection={false} />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    openSection("Shape Properties", "形状属性");
    expect(screen.queryByTestId("text")).not.toBeInTheDocument();
    expect(screen.queryByTestId("svg")).not.toBeInTheDocument();
    rerender(<StyleTab clipId="clip" showTextSection={false} showShapeSection={false} showSVGSection={false} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
