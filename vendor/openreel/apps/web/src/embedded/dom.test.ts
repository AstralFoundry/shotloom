import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmbeddedEnvironment } from "./dom";
let environments: ReturnType<typeof createEmbeddedEnvironment>[] = [];
afterEach(() => { environments.forEach(environment => environment.dispose()); environments = []; document.body.replaceChildren(); vi.unstubAllGlobals(); vi.useRealTimers(); });
function mount() {
  const host = document.createElement("div"); document.body.append(host);
  const shadow = host.attachShadow({ mode: "open" });
  const root = document.createElement("div"); root.className = "clip-studio-root"; shadow.append(root);
  const environment = createEmbeddedEnvironment(window, root); environments.push(environment);
  return { root, host, shadow, environment };
}
describe("embedded editor DOM isolation", () => {
  it("keeps classes, portals, queries and theme changes in its own shadow tree", () => {
    const first = mount(), second = mount();
    const portal = first.environment.document.createElement("div"); portal.id = "editor-dialog";
    first.environment.document.body.append(portal);
    first.environment.document.documentElement.classList.add("dark");
    first.environment.document.title = "Editor";
    expect(first.root.contains(portal)).toBe(true);
    expect(first.environment.document.getElementById("editor-dialog")).toBe(portal);
    expect(second.environment.document.getElementById("editor-dialog")).toBeNull();
    expect(document.getElementById("editor-dialog")).toBeNull();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(first.root.classList.contains("dark")).toBe(true);
    expect(document.title).not.toBe("Editor");
  });
  it("routes shortcuts only to their session while keeping drag release global", () => {
    const first = mount(), second = mount();
    const firstKey = vi.fn(), secondKey = vi.fn(), dragEnd = vi.fn();
    first.environment.window.addEventListener("keydown", firstKey);
    second.environment.window.addEventListener("keydown", secondKey);
    first.environment.window.addEventListener("mouseup", dragEnd);
    const input = document.createElement("input"); document.body.append(input);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, composed: true }));
    expect(firstKey).not.toHaveBeenCalled(); expect(secondKey).not.toHaveBeenCalled();
    first.root.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, composed: true }));
    expect(firstKey).toHaveBeenCalledTimes(1); expect(secondKey).not.toHaveBeenCalled();
    window.dispatchEvent(new MouseEvent("mouseup")); expect(dragEnd).toHaveBeenCalledTimes(1);
    first.environment.dispose();
    first.root.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    window.dispatchEvent(new MouseEvent("mouseup"));
    expect(firstKey).toHaveBeenCalledTimes(1); expect(dragEnd).toHaveBeenCalledTimes(1);
  });
  it("uses deep activeElement and isolates persisted UI values and window globals", () => {
    const first = mount(), second = mount();
    const button = document.createElement("button"); first.root.append(button);button.focus();
    expect(first.environment.document.activeElement).toBe(button);
    expect(second.environment.document.activeElement).toBe(second.root);
    first.environment.window.localStorage.setItem("view", "canvas");
    expect(second.environment.window.localStorage.getItem("view")).toBeNull();
    (first.environment.window as unknown as Record<string, unknown>).__editorProbe = 1;
    expect((second.environment.window as unknown as Record<string, unknown>).__editorProbe).toBeUndefined();
    expect((window as unknown as Record<string, unknown>).__editorProbe).toBeUndefined();
  });
  it("isolates custom notifications and cancels timers at disposal", () => {
    vi.useFakeTimers();
    const first = mount(), second = mount();
    const firstNotification = vi.fn(), secondNotification = vi.fn(), timeout = vi.fn();
    first.environment.window.addEventListener("openreel:preview-invalidate", firstNotification);
    second.environment.window.addEventListener("openreel:preview-invalidate", secondNotification);
    first.environment.window.dispatchEvent(new CustomEvent("openreel:preview-invalidate"));
    expect(firstNotification).toHaveBeenCalledTimes(1);
    expect(secondNotification).not.toHaveBeenCalled();
    first.environment.window.setTimeout(timeout, 20);
    first.environment.window.setInterval(timeout, 20);
    first.environment.dispose();
    vi.advanceTimersByTime(100);
    expect(timeout).not.toHaveBeenCalled();
  });

});
