import "../../../../test/install-local-storage-mock";
import { useState, type ComponentType } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureShotloomLocale } from "../../../../shotloom-mode";
import { Flux2Form } from "./Flux2Form";
import { NanoBanana2Form } from "./NanoBanana2Form";
import { ZImageForm } from "./ZImageForm";
import { GrokForm } from "./GrokForm";
import { SeedreamForm } from "./SeedreamForm";
import { QwenForm } from "./QwenForm";
import { ASPECT_RATIO_OPTIONS, ASPECT_RATIO_OPTIONS_AUTO, ASPECT_RATIO_OPTIONS_BASIC, aspectRatioOptions } from "./shared";

const cases = [
  { Form: Flux2Form, model: "Flux 2", value: { prompt: "Original {model} $&", input_urls: ["https://example.test/ref.png"], aspect_ratio: "1:1", resolution: "1K" } },
  { Form: NanoBanana2Form, model: "Nano Banana 2", value: { prompt: "Original {model} $&", image_input: ["https://example.test/ref.png"], aspect_ratio: "auto", resolution: "2K", output_format: "png" } },
  { Form: ZImageForm, model: "Z-Image", value: { prompt: "Original {model} $&", aspect_ratio: "1:1" } },
  { Form: GrokForm, model: "Grok Imagine", value: { image_urls: ["https://example.test/ref.png"] } },
  { Form: SeedreamForm, model: "Seedream", value: { prompt: "Original {model} $&", image_urls: ["https://example.test/ref.png"], aspect_ratio: "1:1", quality: "basic" } },
  { Form: QwenForm, model: "Qwen", value: { prompt: "Original {model} $&", image_url: "https://example.test/ref.png", strength: 0.8, acceleration: "regular" } },
];

describe.each(["en-US", "zh-CN"] as const)("Image generation form localization (%s)", locale => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => configureShotloomLocale(locale));
  afterEach(() => { cleanup(); configureShotloomLocale("en-US"); });
  it.each(cases)("preserves $model inputs and enforces its existing submit state", ({ Form, model, value }) => {
    // A common harness drives the six forms; production props keep their model-specific types.
    const Component = Form as unknown as ComponentType<{ value: Record<string, unknown>; onChange: (value: Record<string, unknown>) => void; onSubmit: () => void; isLoading: boolean }>;
    const changed = vi.fn(), submit = vi.fn();
    function Harness({ loading = false }: { loading?: boolean }) {
      const [current, setCurrent] = useState<Record<string, unknown>>(value);
      return <Component value={current} onChange={next => { changed(next); setCurrent(next); }} onSubmit={submit} isLoading={loading} />;
    }
    const { rerender } = render(<Harness />);
    const prompt = screen.getByRole("textbox", { name: model === "Grok Imagine" ? ui("Prompt (optional)", "提示词（可选）") : ui("Prompt", "提示词") });
    expect(prompt).toHaveValue(value.prompt ?? "");
    expect(prompt).toHaveAttribute("placeholder", model === "Grok Imagine" ? ui("Optional: describe what you want to change or emphasize...", "可选：描述希望更改或强调的内容…") : ui("Describe the image you want to generate...", "描述你想生成的图片…"));
    fireEvent.change(prompt, { target: { value: "New {prompt} $&" } });
    expect(changed).toHaveBeenLastCalledWith({ ...value, prompt: "New {prompt} $&" });
    const ratio = screen.queryByRole("combobox", { name: ui("Aspect Ratio", "画面比例") });
    if (ratio) {
      fireEvent.change(ratio, { target: { value: "16:9" } });
      expect(changed).toHaveBeenLastCalledWith({ ...value, prompt: "New {prompt} $&", aspect_ratio: "16:9" });
    }
    if (model === "Seedream") {
      fireEvent.change(screen.getByRole("combobox", { name: ui("Quality", "质量") }), { target: { value: "high" } });
      expect(changed.mock.lastCall?.[0]).toMatchObject({ quality: "high", aspect_ratio: "16:9" });
      expect(screen.getByRole("option", { name: ui("High (4K)", "高清（4K）") })).toHaveValue("high");
    }
    if (model === "Qwen") {
      fireEvent.change(screen.getByRole("combobox", { name: ui("Acceleration", "加速") }), { target: { value: "none" } });
      fireEvent.change(screen.getByRole("combobox", { name: ui("Format", "格式") }), { target: { value: "jpeg" } });
      fireEvent.keyDown(screen.getByRole("slider", { name: ui("Strength", "变化强度") }), { key: "Home" });
      const negative = screen.getByRole("textbox", { name: ui("Negative Prompt (optional)", "反向提示词（可选）") });
      fireEvent.change(negative, { target: { value: "Do not translate {name}" } });
      expect(changed.mock.lastCall?.[0]).toMatchObject({ acceleration: "none", output_format: "jpeg", strength: 0, negative_prompt: "Do not translate {name}", image_url: value.image_url });
      fireEvent.change(negative, { target: { value: "" } });
      expect(changed.mock.lastCall?.[0].negative_prompt).toBeUndefined();
    }
    fireEvent.click(screen.getByRole("button", { name: ui(`Generate with ${model}`, `使用 ${model} 生成`) }));
    expect(submit).toHaveBeenCalledOnce();
    fireEvent.change(prompt, { target: { value: "" } });
    const button = screen.getByRole("button", { name: ui(`Generate with ${model}`, `使用 ${model} 生成`) });
    if (model === "Grok Imagine") { expect(button).toBeEnabled(); expect(changed.mock.lastCall?.[0].prompt).toBeUndefined(); }
    else expect(button).toBeDisabled();
    rerender(<Harness loading />);
    expect(screen.getByRole("button", { name: ui("Generating...", "正在生成…") })).toBeDisabled();
  });
  it("translates all ratio lists while preserving values and unknown labels", () => {
    for (const list of [ASPECT_RATIO_OPTIONS, ASPECT_RATIO_OPTIONS_AUTO, ASPECT_RATIO_OPTIONS_BASIC]) {
      const result = aspectRatioOptions(list);
      expect(result.map(item => item.value)).toEqual(list.map(item => item.value));
      expect(result[0].label).toBe(locale === "en-US" ? list[0].label : list[0].value === "auto" ? "自动" : "1:1 正方形");
      expect(result).not.toBe(list);
    }
    expect(aspectRatioOptions([{ value: "user-ratio", label: "User {label}" }])).toEqual([{ value: "user-ratio", label: "User {label}" }]);
  });
});
