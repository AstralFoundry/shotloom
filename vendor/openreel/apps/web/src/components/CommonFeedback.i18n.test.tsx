import "../test/install-local-storage-mock";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureShotloomLocale } from "../shotloom-mode";
import { ErrorBoundary, PanelErrorBoundary } from "./ErrorBoundary";
import { MobileBlocker } from "./MobileBlocker";
import { ToastContainer } from "./Toast";
import { useNotificationStore } from "../stores/notification-store";

describe.each(["en-US", "zh-CN"] as const)("Common feedback (%s)", locale => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => { configureShotloomLocale(locale); vi.spyOn(console, "error").mockImplementation(() => {}); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); useNotificationStore.getState().clearAll(); configureShotloomLocale("en-US"); });
  it("recovers after retry while preserving upstream error details", () => {
    let fail = true;
    const onError = vi.fn();
    function Child() { if (fail) throw new Error("Decode {name} $& failed"); return <p>Recovered content</p>; }
    render(<ErrorBoundary onError={onError}><Child /></ErrorBoundary>);
    expect(screen.getByText(ui("Something went wrong", "组件运行出错"))).toBeInTheDocument();
    expect(screen.getByText("Decode {name} $& failed")).toBeInTheDocument();
    expect(onError).toHaveBeenCalled();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: ui("Retry", "重试") }));
    expect(screen.getByText("Recovered content")).toBeInTheDocument();
  });
  it("localizes unknown errors and panel recovery without interpreting panel names", () => {
    function EmptyError(): never { throw new Error(""); }
    const { unmount } = render(<ErrorBoundary><EmptyError /></ErrorBoundary>);
    expect(screen.getByText(ui("An unexpected error occurred", "发生意外错误"))).toBeInTheDocument();
    unmount();
    render(<PanelErrorBoundary name="Custom {name} $&"><EmptyError /></PanelErrorBoundary>);
    expect(screen.getByText(ui("Custom {name} $& failed to load. Please refresh the page.", "Custom {name} $& 加载失败，请刷新页面。"))).toBeInTheDocument();
  });
  it("shows browser requirements only when required APIs are unavailable", () => {
    vi.stubGlobal("URL", class extends URL { static createObjectURL = vi.fn(() => "blob:test"); });
    const context = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const { unmount } = render(<MobileBlocker />);
    expect(screen.getByRole("alert")).toHaveTextContent(ui("Your browser needs an update", "请更新浏览器"));
    expect(screen.getByText(ui("OpenReel needs local file access and canvas rendering. Open this page in a current browser to edit on your phone, tablet or computer.", "OpenReel 需要本地文件访问和画布渲染能力。请使用新版浏览器打开此页面，在手机、平板或电脑上编辑。"))).toBeInTheDocument();
    unmount(); context.mockReturnValue({} as ReturnType<HTMLCanvasElement["getContext"]>);
    render(<MobileBlocker />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("dismisses the original notification through a localized control", async () => {
    const id = useNotificationStore.getState().addNotification({ type: "info", title: "Original {title}", message: "Untranslated upstream detail", duration: 0 });
    render(<ToastContainer />);
    expect(screen.getByRole("region", { name: ui("Notifications", "通知") })).toBeInTheDocument();
    expect(screen.getByText("Original {title}")).toBeInTheDocument();
    expect(screen.getByText("Untranslated upstream detail")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ui("Dismiss notification", "关闭通知") }));
    expect(useNotificationStore.getState().notifications.some(item => item.id === id)).toBe(false);
    await waitFor(() => expect(screen.queryByText("Original {title}")).not.toBeInTheDocument());
  });
});
