import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { useSettingsStore } from "../../../stores/settings-store";
import { McpPanel } from "./McpPanel";

describe.each(["en-US", "zh-CN"] as const)("McpPanel (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => { configureShotloomLocale(locale); useSettingsStore.setState({ mcpAutoAllowTrustedLocal: false }); });
  afterEach(() => {
    cleanup();
    configureShotloomLocale("en-US");
    useSettingsStore.setState({ mcpAutoAllowTrustedLocal: false });
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, "openreel");
  });

  it("shows the live MCP catalog size and organized workflow groups", async () => {
    Object.defineProperty(window, "openreel", {
      configurable: true,
      value: {
        platform: "desktop",
        mcp: {
          getStatus: vi.fn().mockResolvedValue({
            running: true,
            url: "http://127.0.0.1:4400/mcp",
            port: 4400,
            token: "token",
            shimPath: "/Applications/OpenReel/openreel-mcp.js",
            endpointFile: "/tmp/openreel-mcp.json",
          }),
          testConnection: vi.fn().mockResolvedValue({ ok: true, toolCount: 214 }),
          rotateToken: vi.fn(),
          onRequest: vi.fn(),
        },
      },
    });

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<McpPanel />);

    await waitFor(() => expect(screen.getByText(ui("214 available", "可用工具：214 个"))).toBeTruthy());
    expect(screen.getByText(ui("Video Editor", "视频编辑器"))).toBeTruthy();
    expect(screen.getByText(ui("Motion Creator", "动效创作"))).toBeTruthy();
    expect(screen.getByText(ui("Creation & 3D", "创作与三维"))).toBeTruthy();
    expect(screen.getByText(ui("Project Operations", "工程操作"))).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: ui("Copy config", "复制配置") }));
    expect(writeText).toHaveBeenCalledWith(JSON.stringify({ mcpServers: { openreel: { command: "node", args: ["/Applications/OpenReel/openreel-mcp.js"] } } }, null, 2));
    fireEvent.click(screen.getByRole("button", { name: ui("Show token", "显示令牌") }));
    expect(screen.getByText("token")).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: ui("Auto-allow destructive actions", "自动允许破坏性操作") }));
    expect(useSettingsStore.getState().mcpAutoAllowTrustedLocal).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: ui("Test connection", "测试连接") }));
    await waitFor(() => expect(window.openreel!.mcp!.testConnection).toHaveBeenCalledTimes(2));
  });
});
