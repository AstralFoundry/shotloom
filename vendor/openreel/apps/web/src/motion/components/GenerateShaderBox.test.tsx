import { configureShotloomLocale } from "../../shotloom-mode";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MotionShaderDef } from "@openreel/core";
import {
  clearGeneratedMotionShaders,
  getMotionShaderDef,
} from "@openreel/core/motion/shaders";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useSettingsStore } from "../../stores/settings-store";

const generateAiShaderMock = vi.fn();
const getSecretMock = vi.fn();
const isSessionUnlockedMock = vi.fn();
const makeBYOKClientMock = vi.fn();

vi.mock("../../services/ai-shader", () => ({
  generateAiShader: (...args: unknown[]) => generateAiShaderMock(...args),
}));

vi.mock("../../services/secure-storage", () => ({
  getSecret: (...args: unknown[]) => getSecretMock(...args),
  isSessionUnlocked: (...args: unknown[]) => isSessionUnlockedMock(...args),
  onSessionLock: () => undefined,
}));

vi.mock("../../services/agent/llm-transport", () => ({
  makeBYOKClient: (...args: unknown[]) => makeBYOKClientMock(...args),
}));

import { GenerateShaderBox } from "./GenerateShaderBox";

function sampleDef(): MotionShaderDef {
  return {
    id: "ai-holographic-foil-abcd1234",
    name: "Holographic Foil",
    category: "fill",
    glsl: "#version 300 es\nprecision highp float;\nin vec2 vUv;\nout vec4 fragColor;\nvoid main(){fragColor=vec4(vUv,0.0,1.0);}",
    params: [],
    origin: "generated",
  };
}

describe.each(["en-US", "zh-CN"] as const)("GenerateShaderBox in %s", locale => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => {
    configureShotloomLocale(locale);
    generateAiShaderMock.mockReset();
    getSecretMock.mockReset();
    isSessionUnlockedMock.mockReset();
    makeBYOKClientMock.mockReset();
    clearGeneratedMotionShaders();

    isSessionUnlockedMock.mockReturnValue(true);
    getSecretMock.mockResolvedValue("sk-test-key");
    makeBYOKClientMock.mockReturnValue({
      complete: vi.fn().mockResolvedValue({ text: "{}", toolUses: [], stopReason: "end_turn" }),
    });
    useSettingsStore.setState({
      defaultLlmProvider: "openai-compatible",
      llmBaseUrl: "https://gateway.example/v1",
      llmModel: "tool-capable-model",
      configuredServices: ["openai-compatible"],
    });

    useProjectStore.setState({
      hasOpenProject: true,
      project: createEmptyProject("Generate shader test"),
    });
  });

  afterEach(() => {
    configureShotloomLocale("en-US");
    vi.restoreAllMocks();
    cleanup();
    useProjectStore.setState({ hasOpenProject: false });
    clearGeneratedMotionShaders();
  });

  it("generates, registers, dispatches and reports the def", async () => {
    const def = sampleDef();
    generateAiShaderMock.mockResolvedValue({ ok: true, def });
    const onGenerated = vi.fn();

    render(<GenerateShaderBox category="fill" onGenerated={onGenerated} />);

    fireEvent.change(screen.getByRole("textbox", { name: ui("Describe a shader, e.g. holographic foil", "描述着色器效果，例如全息金属箔") }), {
      target: { value: "holographic foil" },
    });
    fireEvent.click(screen.getByRole("button", { name: ui("Generate shader", "生成着色器") }));

    expect(screen.getByText(ui("Generating shader...", "正在生成着色器…"))).toBeTruthy();

    await waitFor(() => {
      expect(onGenerated).toHaveBeenCalledWith(def);
    });

    expect(generateAiShaderMock).toHaveBeenCalledTimes(1);
    expect(generateAiShaderMock.mock.calls[0][0]).toBe("holographic foil");
    expect(generateAiShaderMock.mock.calls[0][1]).toBe("fill");
    expect(generateAiShaderMock.mock.calls[0][2].defaultName).toBe(ui("AI Shader", "AI 着色器"));
    expect(getMotionShaderDef(def.id)?.id).toBe(def.id);

    const project = useProjectStore.getState().project;
    expect((project.generatedShaders ?? []).some((entry) => entry.id === def.id)).toBe(true);
  });

  it("shows the provider guard and does not call generate when no key", async () => {
    getSecretMock.mockResolvedValue(null);
    const onGenerated = vi.fn();

    render(<GenerateShaderBox category="fill" onGenerated={onGenerated} />);

    fireEvent.change(screen.getByRole("textbox", { name: ui("Describe a shader, e.g. holographic foil", "描述着色器效果，例如全息金属箔") }), {
      target: { value: "holographic foil" },
    });
    fireEvent.click(screen.getByRole("button", { name: ui("Generate shader", "生成着色器") }));

    await waitFor(() => {
      expect(screen.getByText(ui("Configure an AI provider in settings", "请在设置中配置 AI 服务"))).toBeTruthy();
    });

    expect(generateAiShaderMock).not.toHaveBeenCalled();
    expect(onGenerated).not.toHaveBeenCalled();
  });

  it("supports a keyless OpenAI-compatible shader model", async () => {
    const def = sampleDef();
    generateAiShaderMock.mockResolvedValue({ ok: true, def });
    isSessionUnlockedMock.mockReturnValue(false);
    useSettingsStore.setState({
      defaultLlmProvider: "openai-compatible",
      llmBaseUrl: "http://localhost:11434/v1",
      llmModel: "qwen2.5-coder",
      configuredServices: [],
    });

    render(<GenerateShaderBox category="fill" onGenerated={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: ui("Describe a shader, e.g. holographic foil", "描述着色器效果，例如全息金属箔") }), {
      target: { value: "iridescent foil" },
    });
    fireEvent.click(screen.getByRole("button", { name: ui("Generate shader", "生成着色器") }));

    await waitFor(() => expect(generateAiShaderMock).toHaveBeenCalledOnce());
    expect(getSecretMock).not.toHaveBeenCalled();
    expect(makeBYOKClientMock).toHaveBeenCalledWith({
      provider: "openai-compatible",
      model: "qwen2.5-coder",
      apiKey: "",
      baseUrl: "http://localhost:11434/v1",
    });
  });

  it("surfaces the service error", async () => {
    generateAiShaderMock.mockResolvedValue({ ok: false, error: "shader failed to compile" });
    const onGenerated = vi.fn();

    render(<GenerateShaderBox category="effect" onGenerated={onGenerated} />);

    fireEvent.change(screen.getByRole("textbox", { name: ui("Describe a shader, e.g. holographic foil", "描述着色器效果，例如全息金属箔") }), {
      target: { value: "chromatic aberration" },
    });
    fireEvent.click(screen.getByRole("button", { name: ui("Generate shader", "生成着色器") }));

    await waitFor(() => {
      expect(screen.getByText("shader failed to compile")).toBeTruthy();
    });

    expect(onGenerated).not.toHaveBeenCalled();
  });
  it.each([
    ["empty-prompt", "Prompt is empty", "请输入着色器提示词"],
    ["invalid-json", "response was not valid JSON matching {name, glsl, params}", "模型回复不是符合 {name, glsl, params} 格式的有效 JSON"],
    ["no-attempts", "no attempts were made", "尚未执行生成尝试"],
    ["empty", "shader source is empty", "着色器源码为空"],
    ["version", "shader must declare #version 300 es", "着色器必须声明 #version 300 es"],
    ["output", "shader must declare out vec4 fragColor", "着色器必须声明 out vec4 fragColor"],
    ["input", "shader must declare uniform sampler2D u_input", "着色器必须声明 uniform sampler2D u_input"],
    ["progress", "text shader must declare uniform float u_progress", "文字着色器必须声明 uniform float u_progress"],
    ["fill-input", "fill shader must not reference u_input", "填充着色器不能引用 u_input"],
  ])("renders structured %s failures without translating diagnostic text", async (code, en, zh) => {
    generateAiShaderMock.mockResolvedValue({ ok: false, error: "Opaque internal diagnostic", issue: { code } });
    const onGenerated = vi.fn();
    render(<GenerateShaderBox category="fill" onGenerated={onGenerated} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "用户 {prompt} $&" } });
    fireEvent.click(screen.getByRole("button", { name: ui("Generate shader", "生成着色器") }));
    expect(await screen.findByText(ui(en, zh))).toBeInTheDocument();
    expect(generateAiShaderMock.mock.calls[0][0]).toBe("用户 {prompt} $&");
    expect(onGenerated).not.toHaveBeenCalled();
  });

  it("keeps compiler details opaque and allows retry after failure", async () => {
    const detail = "GLSL error {detail} $& line 7";
    generateAiShaderMock.mockResolvedValueOnce({ ok: false, error: "original", issue: { code: "compile", detail } })
      .mockResolvedValueOnce({ ok: true, def: sampleDef() });
    const onGenerated = vi.fn();
    render(<GenerateShaderBox category="fill" onGenerated={onGenerated} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "用户提示词" } });
    const button = screen.getByRole("button", { name: ui("Generate shader", "生成着色器") });
    fireEvent.click(button);
    expect(await screen.findByText(detail)).toHaveAttribute("data-shotloom-user-content");
    expect(input).toHaveValue("用户提示词");
    fireEvent.click(button);
    await waitFor(() => expect(onGenerated).toHaveBeenCalledWith(sampleDef()));
    expect(input).toHaveValue("");
  });

  it("uses localized fallback for unknown generation exceptions", async () => {
    generateAiShaderMock.mockRejectedValue(null);
    render(<GenerateShaderBox category="fill" onGenerated={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "foil" } });
    fireEvent.click(screen.getByRole("button", { name: ui("Generate shader", "生成着色器") }));
    expect(await screen.findByText(ui("Shader generation failed", "着色器生成失败"))).toBeInTheDocument();
  });

  it.each([undefined, "Save error {name} $&"])("reports save rejection %s and never announces success", async detail => {
    generateAiShaderMock.mockResolvedValue({ ok: true, def: sampleDef() });
    vi.spyOn(useProjectStore.getState(), "executeAction").mockResolvedValue({ success: false, error: detail ? { code: "INVALID_PARAMS", message: detail } : undefined });
    const onGenerated = vi.fn();
    render(<GenerateShaderBox category="fill" onGenerated={onGenerated} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "foil" } });
    fireEvent.click(screen.getByRole("button", { name: ui("Generate shader", "生成着色器") }));
    expect(await screen.findByText(detail ?? ui("Could not save the shader", "无法保存着色器"))).toBeInTheDocument();
    expect(onGenerated).not.toHaveBeenCalled();
    expect(getMotionShaderDef(sampleDef().id)).toBeUndefined();
  });

});
