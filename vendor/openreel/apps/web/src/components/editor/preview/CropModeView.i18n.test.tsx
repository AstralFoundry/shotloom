import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Clip } from "@openreel/core";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { CropModeView } from "./CropModeView";

const clip: Clip = { id: "original-clip", trackId: "track", mediaId: "original-media", startTime: 0, duration: 3, inPoint: 0, outPoint: 3, effects: [], audioEffects: [], keyframes: [], volume: 1,
  transform: { position: { x: .5, y: .5 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: .5, y: .5 }, opacity: 1 } };

describe.each(["en-US", "zh-CN"] as const)("crop controls (%s)", locale => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => configureShotloomLocale(locale));
  afterEach(() => { cleanup(); configureShotloomLocale("en-US"); });
  it("localizes loading and controls while preserving crop ratios, reset and commit", () => {
    const onCropChange = vi.fn(), onComplete = vi.fn(), onCancel = vi.fn();
    render(<CropModeView clip={clip} videoSrc="original-image.png" mediaType="image" currentTime={0} canvasWidth={800} canvasHeight={600} onCropChange={onCropChange} onComplete={onComplete} onCancel={onCancel} />);
    expect(screen.getByText(ui("Loading image...", "正在加载图片…"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ui("Apply", "应用") })).toBeDisabled();
    const image = screen.getByAltText(ui("Crop preview", "裁剪预览"));
    Object.defineProperties(image, { naturalWidth: { value: 800 }, naturalHeight: { value: 600 } });
    fireEvent.load(image);
    expect(image).toHaveAttribute("src", "original-image.png");
    fireEvent.click(screen.getByRole("button", { name: "16:9" }));
    expect(onCropChange).toHaveBeenLastCalledWith({ x: 0, y: 0.21875, width: 1, height: 0.5625 });
    fireEvent.click(screen.getByRole("button", { name: ui("Free", "自由比例") }));
    fireEvent.click(screen.getByRole("button", { name: ui("Reset crop", "重置裁剪") }));
    expect(onCropChange).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 1, height: 1 });
    fireEvent.click(screen.getByRole("button", { name: ui("Apply", "应用") }));
    expect(onComplete).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: ui("Cancel", "取消") }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
