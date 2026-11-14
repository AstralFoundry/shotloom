import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { useSettingsStore } from "../../../stores/settings-store";
import { SettingsDialog } from "./SettingsDialog";
vi.mock("./GeneralPanel", () => ({ GeneralPanel: () => <div data-testid="general-panel" /> }));
vi.mock("./ApiKeysPanel", () => ({ ApiKeysPanel: () => <div data-testid="keys-panel" /> }));
vi.mock("./McpPanel", () => ({ McpPanel: () => null }));
describe.each(["en-US", "zh-CN"] as const)("settings navigation (%s)", locale => {
  beforeEach(() => { configureShotloomLocale(locale); useSettingsStore.getState().openSettings("general"); });
  afterEach(() => { cleanup(); useSettingsStore.getState().closeSettings(); configureShotloomLocale("en-US"); });
  it("uses translated tabs while preserving panel and tab identifiers", () => {
    render(<SettingsDialog />);
    expect(screen.getByRole("tablist", { name: locale === "zh-CN" ? "设置" : "Settings" })).toBeInTheDocument();
    expect(screen.getByTestId("general-panel")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: locale === "zh-CN" ? "API 密钥" : "API Keys" }));
    expect(useSettingsStore.getState().settingsTab).toBe("api-keys");
    expect(screen.getByRole("tabpanel")).toHaveAttribute("id", "settings-tabpanel-api-keys");
    expect(screen.getByTestId("keys-panel")).toBeInTheDocument();
  });
});
