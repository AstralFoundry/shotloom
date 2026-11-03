import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { useSettingsStore } from "../../../stores/settings-store";
import { ApiKeysPanel } from "./ApiKeysPanel";
const secure = vi.hoisted(() => ({
  isMasterPasswordSet: vi.fn(), isSessionUnlocked: vi.fn(), listSecrets: vi.fn(),
  saveSecret: vi.fn(), getSecret: vi.fn(), deleteSecret: vi.fn(), lockSession: vi.fn(),
  setupMasterPassword: vi.fn(), unlockSession: vi.fn(), changeMasterPassword: vi.fn(), hasSecret: vi.fn(),
}));
vi.mock("../../../services/secure-storage", () => ({ ...secure, onSessionLock: vi.fn() }));

describe.each(["en-US", "zh-CN"] as const)("API keys (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => {
    configureShotloomLocale(locale);
    vi.resetAllMocks();
    secure.isMasterPasswordSet.mockResolvedValue(true);
    secure.isSessionUnlocked.mockReturnValue(true);
    secure.listSecrets.mockResolvedValue([]);
    secure.getSecret.mockResolvedValue("fixture-secret");
    useSettingsStore.setState({ configuredServices: [] });
  });
  afterEach(() => { cleanup(); configureShotloomLocale("en-US"); useSettingsStore.setState({ configuredServices: [] }); });
  it("saves the original service ID and secret, then reveals, deletes and locks", async () => {
    render(<ApiKeysPanel />);
    fireEvent.click(await screen.findByRole("button", { name: ui("Add ElevenLabs API key", "添加 ElevenLabs API 密钥") }));
    fireEvent.change(screen.getByLabelText(ui("API key", "API 密钥")), { target: { value: "  fixture-secret  " } });
    secure.listSecrets.mockResolvedValue([{ id: "elevenlabs", label: "ElevenLabs", createdAt: 0, updatedAt: 0 }]);
    fireEvent.click(screen.getByRole("button", { name: ui("Save Key", "保存密钥") }));
    await waitFor(() => expect(secure.saveSecret).toHaveBeenCalledWith("elevenlabs", "ElevenLabs", "fixture-secret"));
    fireEvent.click(await screen.findByRole("button", { name: ui("Show key", "显示密钥") }));
    expect(await screen.findByText("fixture-secret")).toBeInTheDocument();
    expect(secure.getSecret).toHaveBeenCalledWith("elevenlabs");
    secure.listSecrets.mockResolvedValue([]);
    fireEvent.click(screen.getByRole("button", { name: ui("Delete key", "删除密钥") }));
    await waitFor(() => expect(secure.deleteSecret).toHaveBeenCalledWith("elevenlabs"));
    fireEvent.click(screen.getByRole("button", { name: ui("Lock", "锁定") }));
    expect(secure.lockSession).toHaveBeenCalledOnce();
    expect(await screen.findByText(ui("Session Locked", "会话已锁定"))).toBeInTheDocument();
  });
  it("opens password setup with translated labels when storage is not configured", async () => {
    secure.isMasterPasswordSet.mockResolvedValue(false);
    secure.isSessionUnlocked.mockReturnValue(false);
    render(<ApiKeysPanel />);
    fireEvent.click(await screen.findByRole("button", { name: ui("Set Up Master Password", "设置主密码") }));
    expect(screen.getByLabelText(ui("Confirm Password", "确认密码"))).toBeInTheDocument();
  });
});
