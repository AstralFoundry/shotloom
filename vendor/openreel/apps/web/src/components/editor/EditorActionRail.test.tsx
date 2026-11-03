import "../../test/install-local-storage-mock";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useThemeStore } from "../../stores/theme-store";
import { configureShotloomLocale } from "../../shotloom-mode";
import { useUIStore } from "../../stores/ui-store";
import { EditorActionRail } from "./EditorActionRail";

describe.each(["en-US", "zh-CN"] as const)("EditorActionRail (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => {
    configureShotloomLocale(locale);
    useThemeStore.getState().setMode("light");
  });

  afterEach(() => { cleanup(); configureShotloomLocale("en-US"); useUIStore.getState().closeModal(); });

  it("opens the same history and search routes through translated actions", () => {
    render(<EditorActionRail />);
    fireEvent.click(screen.getByRole("button", { name: ui("Action history", "操作历史") }));
    expect(useUIStore.getState().activeModal).toBe("history");
    fireEvent.click(screen.getByRole("button", { name: ui("Search tools, effects, or ask AI", "搜索工具、效果或询问 AI") }));
    expect(useUIStore.getState().activeModal).toBe("search");
  });

  it("exposes theme switching as a visible rail action", () => {
    render(<EditorActionRail />);

    fireEvent.click(
      screen.getByRole("button", {
        name: ui("Theme: Light. Switch to Dark", "主题：浅色。切换为深色"),
      }),
    );

    expect(useThemeStore.getState().mode).toBe("dark");
    expect(
      screen.getByRole("button", {
        name: ui("Theme: Dark. Switch to System", "主题：深色。切换为跟随系统"),
      }),
    ).toBeInTheDocument();
  });
});
