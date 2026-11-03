import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { useSettingsStore } from "../../../stores/settings-store";
import { useChatStore } from "../../../stores/chat-store";
import { AISettingsPanel } from "./AISettingsPanel";

describe.each(["en-US", "zh-CN"] as const)("AI settings (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => {
    configureShotloomLocale(locale);
    useChatStore.setState({ status: "idle" });
    useSettingsStore.setState({ agentAutoConfirm: false, agentDryRun: false });
    useSettingsStore.getState().openSettings("ai-editor");
  });
  afterEach(() => {
    cleanup();
    useSettingsStore.setState({ agentAutoConfirm: false, agentDryRun: false });
    useChatStore.setState({ status: "idle" });
    useSettingsStore.getState().closeSettings();
    configureShotloomLocale("en-US");
  });
  it("updates preview and approval preferences through translated controls", () => {
    render(<AISettingsPanel />);
    fireEvent.click(screen.getByRole("switch", { name: ui("Preview edits only", "仅预览编辑") }));
    expect(useSettingsStore.getState().agentDryRun).toBe(true);
    fireEvent.click(screen.getByRole("switch", { name: ui("Auto-approve edits", "自动批准编辑") }));
    expect(useSettingsStore.getState().agentAutoConfirm).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: ui("Done", "完成") }));
    expect(useSettingsStore.getState().settingsOpen).toBe(false);
  });
  it("keeps model and permission controls disabled during an edit", () => {
    useChatStore.setState({ status: "running" });
    render(<AISettingsPanel />);
    expect(screen.getByRole("status")).toHaveTextContent(ui("You can change these settings when the current edit finishes.", "当前编辑完成后即可修改这些设置。"));
    expect(screen.getByLabelText(ui("AI provider", "AI 服务商"))).toBeDisabled();
    for (const control of screen.getAllByRole("switch")) expect(control).toBeDisabled();
  });
});
