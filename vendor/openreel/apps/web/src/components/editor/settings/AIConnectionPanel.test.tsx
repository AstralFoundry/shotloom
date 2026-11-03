import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { AIConnectionPanel } from "./AIConnectionPanel";
import { AI_PROVIDER_DEFAULTS, useAIConnectionStore } from "../../../stores/ai-connection-store";

beforeEach(() => useAIConnectionStore.getState().configure({ provider: "openai", ...AI_PROVIDER_DEFAULTS.openai, apiKey: "" }));
afterEach(() => { vi.restoreAllMocks(); });

describe.each(["en-US", "zh-CN"] as const)("AI settings session connections (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => configureShotloomLocale(locale));
  afterEach(() => { cleanup(); configureShotloomLocale("en-US"); });
  it("accepts custom model IDs and localhost endpoints with a keyless compatible adapter", () => {
    render(<AIConnectionPanel />);
    fireEvent.change(screen.getByLabelText(ui("AI provider", "AI 服务商")), { target: { value: "compatible" } });
    fireEvent.change(screen.getByLabelText(ui("AI base URL", "AI 接口地址")), { target: { value: "http://localhost:11434/v1" } });
    fireEvent.change(screen.getByLabelText(ui("AI model ID", "AI 模型 ID")), { target: { value: "my-custom/model" } });
    expect(useAIConnectionStore.getState()).toMatchObject({ provider: "compatible", baseUrl: "http://localhost:11434/v1", model: "my-custom/model", apiKey: "" });
  });
  it("masks and forgets the session key without writing credentials to browser storage", () => {
    const saved = vi.spyOn(Storage.prototype, "setItem");
    render(<AIConnectionPanel />);
    const key = screen.getByLabelText(ui("Session API key", "会话 API 密钥"));
    expect(key).toHaveAttribute("type", "password");
    fireEvent.change(key, { target: { value: "fixture-session-key" } });
    expect(useAIConnectionStore.getState().apiKey).toBe("fixture-session-key");
    expect(saved).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText(ui("Forget key", "清除密钥")));
    expect(useAIConnectionStore.getState().apiKey).toBe("");
    expect(saved).not.toHaveBeenCalled();
  });
});
