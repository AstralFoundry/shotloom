import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyProject } from "../stores/project/project-helpers";
import { configureShotloomLocale } from "../shotloom-mode";
import { useNotificationStore } from "../stores/notification-store";
import { useProjectFonts } from "./useProjectFonts";

const mocks = vi.hoisted(() => ({ ensure: vi.fn() }));
vi.mock("../services/project-fonts", () => ({
  collectProjectFonts: () => [{ family: "User Font {name}", weight: "700", sample: "原文 Sample" }],
  ensureFontFamily: mocks.ensure,
}));
const originalFonts = Object.getOwnPropertyDescriptor(document, "fonts");

describe.each(["en-US", "zh-CN"] as const)("Project font feedback (%s)", locale => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => {
    configureShotloomLocale(locale);
    mocks.ensure.mockReset();
    useNotificationStore.getState().clearAll();
    Object.defineProperty(document, "fonts", { value: {}, configurable: true });
  });
  afterEach(() => {
    cleanup(); configureShotloomLocale("en-US");
    useNotificationStore.getState().clearAll();
    if (originalFonts) Object.defineProperty(document, "fonts", originalFonts);
    else Reflect.deleteProperty(document, "fonts");
  });
  it("repaints once after loading the original font request", async () => {
    mocks.ensure.mockResolvedValue(undefined);
    const { result } = renderHook(() => useProjectFonts(createEmptyProject("User project")));
    await waitFor(() => expect(result.current).toBe(1));
    expect(mocks.ensure).toHaveBeenCalledWith("User Font {name}", "700", "原文 Sample");
    expect(useNotificationStore.getState().notifications).toHaveLength(0);
  });
  it("translates the warning title while preserving upstream diagnostics", async () => {
    mocks.ensure.mockRejectedValue(new Error("Network {name} $& offline"));
    renderHook(() => useProjectFonts(createEmptyProject("User project")));
    await waitFor(() => expect(useNotificationStore.getState().notifications.at(-1)).toMatchObject({
      type: "warning", title: ui("Font unavailable", "字体不可用"), message: "Network {name} $& offline",
    }));
  });
  it("translates the fallback message for unknown failures", async () => {
    mocks.ensure.mockRejectedValue(null);
    renderHook(() => useProjectFonts(createEmptyProject("User project")));
    await waitFor(() => expect(useNotificationStore.getState().notifications.at(-1)?.message).toBe(
      ui("Choose another font or check your connection.", "请选择其他字体或检查网络连接。"),
    ));
  });
  it("does not emit a late warning after the preview unmounts", async () => {
    let reject!: (reason: unknown) => void;
    mocks.ensure.mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
    const { unmount } = renderHook(() => useProjectFonts(createEmptyProject("User project")));
    unmount();
    await act(async () => reject(new Error("Late failure")));
    expect(useNotificationStore.getState().notifications).toHaveLength(0);
  });
});
