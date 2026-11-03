import { configureShotloomLocale } from "../../shotloom-mode";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUIStore } from "../../stores/ui-store";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { SearchModal } from "./SearchModal";

describe.each(["en-US", "zh-CN"] as const)("SearchModal inspector routing (%s)", locale => {
  const scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => {
    configureShotloomLocale(locale);
    vi.useFakeTimers();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, writable: true, value: vi.fn() });
    useUIStore.setState({
      selectedItems: [{ type: "text-clip", id: "text-1" }],
    });
  });

  afterEach(() => {
    cleanup();
    configureShotloomLocale("en-US");
    vi.useRealTimers();
    if (scrollIntoViewDescriptor) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scrollIntoViewDescriptor);
    else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
    document.querySelectorAll('[data-testid="search-target"]').forEach((node) =>
      node.remove(),
    );
  });

  it("discovers text shader materials and expands only the section header", () => {
    const section = document.createElement("section");
    section.dataset.testid = "search-target";
    section.dataset.sectionId = "text-properties";
    const header = document.createElement("div");
    header.dataset.slot = "toolcraft-panel-section-header";
    header.setAttribute("aria-expanded", "false");
    const headerClick = vi.fn();
    header.addEventListener("click", headerClick);
    const childButton = document.createElement("button");
    const childClick = vi.fn();
    childButton.addEventListener("click", childClick);
    section.append(header, childButton);
    document.body.append(section);
    section.scrollIntoView = vi.fn();

    const onClose = vi.fn();
    render(<SearchModal isOpen onClose={onClose} />);

    fireEvent.change(screen.getByRole("textbox", { name: ui("Search effects", "搜索效果") }), { target: { value: ui("material", "材质") } });
    expect(screen.getByText(ui("Text Materials & Shaders", "文字材质与着色器"))).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: ui("Open Text Materials & Shaders", "打开文字材质与着色器") }),
    );
    act(() => vi.advanceTimersByTime(100));

    expect(headerClick).toHaveBeenCalledOnce();
    expect(childClick).not.toHaveBeenCalled();
    expect(section.scrollIntoView).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("filters by stable categories and clears a localized empty search", () => {
    useUIStore.setState({ selectedItems: [] });
    render(<SearchModal isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("radio", { name: ui("Audio", "音频") }));
    expect(screen.getByRole("button", { name: ui("Open Audio Effects", "打开音频效果") })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ui("Open Visual Effects", "打开视觉效果") })).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: ui("Search effects", "搜索效果") }), { target: { value: "nonexistent-value-123" } });
    expect(screen.getByText(ui("No effects found", "未找到效果"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ui("Clear search", "清除搜索") }));
    expect(screen.getByRole("button", { name: ui("Open Audio Effects", "打开音频效果") })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: ui("Search effects", "搜索效果") })).toHaveValue("");
  });

  it("classifies ordinary clips from their project track instead of assuming video", () => {
    const project = createEmptyProject("Search routing");
    useProjectStore.setState({
      project: {
        ...project,
        timeline: {
          ...project.timeline,
          tracks: [
            {
              id: "audio-track",
              name: "Voiceover",
              type: "audio",
              clips: [
                {
                  id: "audio-clip",
                  mediaId: "audio-media",
                  trackId: "audio-track",
                  startTime: 0,
                  duration: 4,
                  inPoint: 0,
                  outPoint: 4,
                  speed: 1,
                  volume: 1,
                  transform: {
                    position: { x: 0, y: 0 },
                    scale: { x: 1, y: 1 },
                    rotation: 0,
                    anchor: { x: 0.5, y: 0.5 },
                    opacity: 1,
                  },
                  effects: [],
                  audioEffects: [],
                  keyframes: [],
                },
              ],
              transitions: [],
              muted: false,
              locked: false,
              hidden: false,
              solo: false,
            },
          ],
        },
      },
    });
    useUIStore.setState({
      selectedItems: [{ type: "clip", id: "audio-clip" }],
    });

    render(<SearchModal isOpen onClose={vi.fn()} />);

    expect(screen.getByText(ui("Audio Effects", "音频效果"))).toBeInTheDocument();
    expect(screen.queryByText(ui("Visual Effects", "视觉效果"))).toBeNull();
    expect(screen.getByText(ui("Find tools for the selected audio clip.", "查找适用于所选音频片段的工具。"))).toBeInTheDocument();
  });
});
