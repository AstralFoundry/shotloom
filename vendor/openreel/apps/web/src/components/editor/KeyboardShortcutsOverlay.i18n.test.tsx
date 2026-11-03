import "../../test/install-local-storage-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { configureShotloomLocale } from "../../shotloom-mode";
import { keyboardShortcuts, formatKeyComboDisplay } from "../../services/keyboard-shortcuts";
import { KeyboardShortcutsOverlay } from "./KeyboardShortcutsOverlay";

describe.each(["en-US", "zh-CN"] as const)("shortcut overlay (%s)", locale => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => {
    configureShotloomLocale(locale);
    keyboardShortcuts.resetAllShortcuts();
  });
  afterEach(() => {
    cleanup();
    keyboardShortcuts.resetAllShortcuts();
    configureShotloomLocale("en-US");
  });
  function openUndo() {
    render(<KeyboardShortcutsOverlay isOpen onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: ui("Search shortcuts", "搜索快捷键") }), {
      target: { value: ui("Undo last action", "撤销上次操作") },
    });
    expect(screen.getByText(ui("Undo", "撤销"))).toBeInTheDocument();
    expect(screen.queryByText(ui("Play/Pause", "播放/暂停"))).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: formatKeyComboDisplay(keyboardShortcuts.getShortcut("editing.undo")!.currentKey) }));
    return screen.getByRole("textbox", { name: ui("Set shortcut for Undo", "设置撤销快捷键") });
  }
  it("reads current-language metadata without changing stored shortcut definitions", () => {
    const before = keyboardShortcuts.getAllShortcuts().map(({ id, action, currentKey, category }) => ({ id, action, currentKey, category }));
    expect(keyboardShortcuts.getCategoryName("playback")).toBe(ui("Playback", "播放"));
    configureShotloomLocale(locale === "zh-CN" ? "en-US" : "zh-CN");
    expect(keyboardShortcuts.getShortcut("editing.undo")!.name).toBe(locale === "zh-CN" ? "Undo" : "撤销");
    expect(keyboardShortcuts.getAllShortcuts().map(({ id, action, currentKey, category }) => ({ id, action, currentKey, category }))).toEqual(before);
  });

  it("searches localized descriptions and saves a real key combination under the stable action ID", () => {
    const input = openUndo();
    fireEvent.keyDown(input, { key: "9", metaKey: true, altKey: true, shiftKey: true });
    expect(keyboardShortcuts.getShortcut("editing.undo")).toMatchObject({
      id: "editing.undo", action: "editing.undo", currentKey: "cmd+shift+alt+9", name: ui("Undo", "撤销"),
    });
    expect(JSON.parse(localStorage.getItem("openreel_shortcuts")!)).toMatchObject({ "editing.undo": "cmd+shift+alt+9" });
  });
  it("shows a translated conflict without changing the assigned key", () => {
    const original = keyboardShortcuts.getShortcut("editing.undo")!.currentKey;
    fireEvent.keyDown(openUndo(), { key: "c", metaKey: true });
    expect(screen.getByRole("status")).toHaveTextContent(ui(
      "This shortcut is used by Copy. Choose a different key.", "此快捷键已用于“复制”，请选择其他按键。",
    ));
    expect(keyboardShortcuts.getShortcut("editing.undo")!.currentKey).toBe(original);
  });
  it("applies and resets a preset without translating its ID or key mapping", () => {
    render(<KeyboardShortcutsOverlay isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: ui("OpenReel Default", "OpenReel 默认") }));
    fireEvent.click(screen.getByRole("button", { name: ui("Apply Adobe Premiere preset", "应用Adobe Premiere预设") }));
    expect(keyboardShortcuts.getActivePreset()).toBe("premiere");
    expect(keyboardShortcuts.getShortcut("editing.split")!.currentKey).toBe("cmd+k");
    fireEvent.click(screen.getByRole("button", { name: ui("Reset All", "全部重置") }));
    expect(keyboardShortcuts.getActivePreset()).toBe("openreel");
    expect(keyboardShortcuts.getShortcut("editing.split")!.currentKey).toBe(keyboardShortcuts.getShortcut("editing.split")!.defaultKey);
  });
});
