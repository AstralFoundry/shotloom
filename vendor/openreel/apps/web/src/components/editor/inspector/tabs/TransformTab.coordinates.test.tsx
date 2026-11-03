import { configureShotloomLocale } from "../../../../shotloom-mode";
import "../../../../test/install-local-storage-mock";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Transform } from "@openreel/core";
import { TransformTab } from "./TransformTab";

const overlayTransform: Transform = {
  position: { x: 0.5, y: 0.5 },
  scale: { x: 1, y: 1 },
  rotation: 0,
  anchor: { x: 0.5, y: 0.5 },
  opacity: 1,
};

afterEach(() => { cleanup(); configureShotloomLocale("en-US"); });

describe.each(["en-US", "zh-CN"] as const)("TransformTab (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => configureShotloomLocale(locale));
  it("displays normalized overlay positions as canvas pixels", () => {
    const onChange = vi.fn();
    render(
      <TransformTab
        clipId="text-1"
        clipType="text"
        selectedClip={{ id: "text-1", mediaId: "text-text-1" }}
        showTransformControls
        showVideoControls={false}
        transform={overlayTransform}
        canvasWidth={1920}
        canvasHeight={1080}
        handleTransformChange={onChange}
      />,
    );

    expect(screen.getByRole("textbox", { name: ui("Position X", "位置 X") })).toHaveValue(
      "960",
    );
    expect(screen.getByRole("textbox", { name: ui("Position Y", "位置 Y") })).toHaveValue(
      "540",
    );
    expect(screen.getByRole("textbox", { name: ui("Anchor Point X", "锚点 X") })).toHaveValue(
      "50%",
    );
    expect(screen.getByText(ui("Canvas pixels", "画布像素"))).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: ui("Position X", "位置 X") }), {
      target: { value: "1200" },
    });
    expect(onChange).toHaveBeenLastCalledWith({
      position: { x: 0.625, y: 0.5 },
    });

    fireEvent.click(screen.getByRole("button", { name: ui("Nudge right 1 pixel", "向右微调一像素") }));
    expect(onChange).toHaveBeenLastCalledWith({
      position: { x: 0.5 + 1 / 1920, y: 0.5 },
    });
  });

  it("keeps media positions as pixel offsets from canvas center", () => {
    const onChange = vi.fn();
    render(
      <TransformTab
        clipId="video-1"
        clipType="video"
        selectedClip={{ id: "video-1", mediaId: "media-1" }}
        showTransformControls
        showVideoControls={false}
        transform={{
          ...overlayTransform,
          position: { x: 120, y: -40 },
        }}
        canvasWidth={1920}
        canvasHeight={1080}
        handleTransformChange={onChange}
      />,
    );

    expect(screen.getByRole("textbox", { name: ui("Position X", "位置 X") })).toHaveValue(
      "120",
    );
    expect(screen.getByRole("textbox", { name: ui("Position Y", "位置 Y") })).toHaveValue(
      "-40",
    );
    expect(screen.getByText(ui("Offset pixels", "偏移像素"))).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: ui("Expand Alignment section", "展开对齐区域") }));
    fireEvent.click(screen.getByRole("button", { name: ui("Center on Canvas", "在画布上居中") }));
    expect(onChange).toHaveBeenLastCalledWith({
      position: { x: 0, y: 0 },
    });
  });
  it("exposes named scale, rotation, opacity and radius controls", () => {
    const onChange = vi.fn();
    render(<TransformTab clipId="video-1" clipType="video" selectedClip={null}
      showTransformControls showVideoControls={false} transform={overlayTransform}
      canvasWidth={1920} canvasHeight={1080} handleTransformChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("slider", { name: ui("Scale", "缩放") }), { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith({ scale: { x: 1.01, y: 1.01 } });
    fireEvent.keyDown(screen.getByRole("slider", { name: ui("Opacity", "不透明度") }), { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith({ opacity: 0.99 });
    fireEvent.keyDown(screen.getByRole("slider", { name: ui("Radius", "圆角半径") }), { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith({ borderRadius: 1 });
    fireEvent.change(screen.getByRole("textbox", { name: ui("Rotation", "旋转") }), { target: { value: "45°" } });
    expect(onChange).toHaveBeenLastCalledWith({ rotation: 45 });
    fireEvent.click(screen.getByRole("button", { name: ui("Increase rotation", "增加旋转角度") }));
    expect(onChange).toHaveBeenLastCalledWith({ rotation: 1 });
    fireEvent.click(screen.getByRole("button", { name: ui("Decrease rotation", "减小旋转角度") }));
    expect(onChange).toHaveBeenLastCalledWith({ rotation: -1 });
  });

  it("keeps fit mode identifiers unchanged through translated actions", () => {
    const onChange = vi.fn();
    render(<TransformTab clipId="video-1" clipType="video" selectedClip={null}
      showTransformControls showVideoControls={false} transform={overlayTransform}
      canvasWidth={1920} canvasHeight={1080} handleTransformChange={onChange} />);
    for (const [mode, label] of [["contain", "适应"], ["cover", "填充"], ["stretch", "拉伸"]]) {
      fireEvent.click(screen.getByRole("button", { name: ui(`Set fit mode to ${mode}`, `将适配模式设为${label}`) }));
      expect(onChange).toHaveBeenLastCalledWith({ fitMode: mode });
    }
  });

});
