import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { MasterPasswordDialog } from "./MasterPasswordDialog";

describe.each(["en-US", "zh-CN"] as const)("master password (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => configureShotloomLocale(locale));
  afterEach(() => { cleanup(); configureShotloomLocale("en-US"); });
  it("validates setup and passes the unchanged password to storage", async () => {
    const submit = vi.fn().mockResolvedValue(true);
    render(<MasterPasswordDialog isOpen mode="setup" onClose={vi.fn()} onSubmit={submit} />);
    fireEvent.change(screen.getByLabelText(ui("Password", "密码")), { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: ui("Set Password", "设置密码") }));
    expect(screen.getByText(ui("Password must be at least 8 characters", "密码至少需要 8 个字符"))).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(ui("Password", "密码")), { target: { value: "fixture-passphrase" } });
    fireEvent.change(screen.getByLabelText(ui("Confirm Password", "确认密码")), { target: { value: "different" } });
    fireEvent.click(screen.getByRole("button", { name: ui("Set Password", "设置密码") }));
    expect(screen.getByText(ui("Passwords do not match", "两次输入的密码不一致"))).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(ui("Confirm Password", "确认密码")), { target: { value: "fixture-passphrase" } });
    fireEvent.click(screen.getByRole("button", { name: ui("Set Password", "设置密码") }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith("fixture-passphrase", undefined));
  });
  it("translates an invalid password and preserves an upstream failure", async () => {
    const submit = vi.fn().mockResolvedValueOnce(false).mockRejectedValueOnce(new Error("fixture keychain error"));
    render(<MasterPasswordDialog isOpen mode="unlock" onClose={vi.fn()} onSubmit={submit} />);
    fireEvent.change(screen.getByLabelText(ui("Master Password", "主密码")), { target: { value: "fixture-passphrase" } });
    fireEvent.click(screen.getByRole("button", { name: ui("Unlock", "解锁") }));
    expect(await screen.findByText(ui("Incorrect password", "密码不正确"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ui("Unlock", "解锁") }));
    expect(await screen.findByText("fixture keychain error")).toBeInTheDocument();
  });
});
