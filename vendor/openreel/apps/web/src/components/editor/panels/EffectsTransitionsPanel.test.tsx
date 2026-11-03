import "../../../test/install-local-storage-mock";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Clip } from "@openreel/core";
import { disposeTransitionBridge } from "../../../bridges/transition-bridge";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { EffectsPanel, TransitionsPanel } from "./EffectsTransitionsPanel";

describe("editor effect and transition catalogs", () => {
  beforeEach(() => {
    useUIStore.getState().clearSelection();
  });

  afterEach(() => {
    cleanup();
    configureShotloomLocale("en-US");
    disposeTransitionBridge();
    useUIStore.getState().clearSelection();
    useProjectStore.setState({
      hasOpenProject: false,
      project: createEmptyProject("Reset"),
    });
  });

  it("keeps search text intact inside translated empty-result messages", () => {
    configureShotloomLocale("zh-CN");
    const query = "用户搜索 {query} $&";
    const { unmount } = render(<EffectsPanel />);
    fireEvent.change(screen.getByPlaceholderText("搜索效果"), { target: { value: query } });
    expect(screen.getByText(`没有与“${query}”匹配的效果。`)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("搜索效果")).toHaveValue(query);
    unmount();
    render(<TransitionsPanel />);
    fireEvent.change(screen.getByPlaceholderText("搜索转场"), { target: { value: query } });
    expect(screen.getByText(`没有与“${query}”匹配的转场。`)).toBeInTheDocument();
  });

  it("offers directional transition variants with animated preview cards", () => {
    render(<TransitionsPanel />);

    expect(
      screen.getByRole("button", {
        name: /^Wipe Left\. Drag onto a clip edge/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /^Slide Down\. Drag onto a clip edge/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Whip Pan")).toBeInTheDocument();
    expect(screen.getByText("Soft Wipe Left")).toBeInTheDocument();
    expect(screen.getByText("Push Down")).toBeInTheDocument();
    expect(screen.getByText("Punch Zoom")).toBeInTheDocument();
    expect(screen.getByText("Pixelate")).toBeInTheDocument();
    expect(screen.getByText("Glitch Cut")).toBeInTheDocument();
    expect(screen.getByText("Venetian Blinds")).toBeInTheDocument();
    expect(screen.getByText("Diamond Reveal")).toBeInTheDocument();
    expect(screen.getByText("Spin Clockwise")).toBeInTheDocument();
    expect(screen.getByText("Flip Vertical")).toBeInTheDocument();
    expect(screen.getByText("Split Horizontal")).toBeInTheDocument();
    expect(screen.getByText("Flash Cut")).toBeInTheDocument();
    expect(screen.getByText("Film Burn")).toBeInTheDocument();
    expect(screen.getByText("Red Film Burn")).toBeInTheDocument();
    expect(screen.getByText("Cool Light Leak")).toBeInTheDocument();
    expect(screen.getByText("Mosaic Reveal")).toBeInTheDocument();
    expect(screen.getByText("Ripple")).toBeInTheDocument();
    expect(screen.getByText("Page Turn Left")).toBeInTheDocument();
    expect(screen.getByText("Page Turn Right")).toBeInTheDocument();
    expect(screen.getByText("Color Split")).toBeInTheDocument();
    for (const category of ["Dissolves", "Wipes", "Movement", "Stylized"]) {
      expect(screen.getByText(category)).toBeInTheDocument();
    }
  });

  it("resolves every transition name and description after locale configuration", () => {
    configureShotloomLocale("en-US");
    const { unmount } = render(<TransitionsPanel />);
    const readCatalog = () => screen.getAllByRole("button")
      .filter((button) => button.draggable)
      .map((button) => button.textContent);
    const english = readCatalog();
    expect(english.length).toBeGreaterThan(40);
    unmount();
    configureShotloomLocale("zh-CN");
    render(<TransitionsPanel />);
    const chinese = readCatalog();
    expect(chinese).toHaveLength(english.length);
    chinese.forEach((text, index) => {
      expect(text).not.toBe(english[index]);
      expect(text).not.toContain("editor.transitionPreview.");
      expect(text).toMatch(/[\u4e00-\u9fff]/);
    });
    expect(screen.getByText("下一片段向左滑入")).toBeInTheDocument();
    expect(screen.getByText("将当前镜头向右翻折")).toBeInTheDocument();
  });

  it("filters the expanded transition library by production category", () => {
    render(<TransitionsPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Stylized 13" }));

    expect(screen.getByRole("button", { name: "Stylized 13" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("Film Burn")).toBeInTheDocument();
    expect(screen.getByText("Punch Zoom")).toBeInTheDocument();
    expect(screen.queryByText("Wipe Left")).not.toBeInTheDocument();
    expect(screen.queryByText("Push Down")).not.toBeInTheDocument();
  });

  it.each(["en-US", "zh-CN"])("searches localized variants and preserves drag params in %s", (locale) => {
    configureShotloomLocale(locale);
    render(<TransitionsPanel />);
    const search = screen.getByPlaceholderText(locale === "zh-CN" ? "搜索转场" : "Search transitions");
    fireEvent.change(search, { target: { value: locale === "zh-CN" ? "向左柔边擦除" : "Soft Wipe Left" } });
    const card = screen.getByRole("button", { name: locale === "zh-CN" ? /^向左柔边擦除。/ : /^Soft Wipe Left\./ });
    expect(screen.getByText(locale === "zh-CN" ? "沿指定方向以羽化边缘展开画面" : "Feathered directional reveal")).toBeInTheDocument();
    expect(screen.queryByText(locale === "zh-CN" ? "向右柔边擦除" : "Soft Wipe Right")).not.toBeInTheDocument();
    const payloads = new Map<string, string>();
    fireEvent.dragStart(card, { dataTransfer: { effectAllowed: "", setData: (type: string, value: string) => payloads.set(type, value) } });
    expect(JSON.parse(payloads.get("application/x-openreel-transition")!)).toEqual({ transitionType: "wipe", transitionParams: { direction: "left", softness: 0.45 } });
    expect(payloads.get("text/plain")).toBe("transition:wipe");
  });

  it("includes tonal balance and chroma key in the effect browser", () => {
    render(<EffectsPanel />);

    expect(screen.getByText("Tonal Balance")).toBeInTheDocument();
    expect(screen.getByText("Chroma Key")).toBeInTheDocument();
    expect(screen.getByText("Cinematic Punch")).toBeInTheDocument();
    expect(screen.getByText("Golden Hour")).toBeInTheDocument();
    expect(screen.getByText("Soft Focus")).toBeInTheDocument();
    expect(screen.getByText("Dream Bloom")).toBeInTheDocument();
    expect(screen.getByText("Retro Grain")).toBeInTheDocument();
    expect(screen.getByText("RGB Split")).toBeInTheDocument();
    expect(screen.getByText("VHS")).toBeInTheDocument();
    expect(screen.getByText("Posterize")).toBeInTheDocument();
    expect(screen.getByText("Duotone")).toBeInTheDocument();
    expect(screen.getByText("Prism Split")).toBeInTheDocument();
    expect(screen.getByText("Fisheye")).toBeInTheDocument();
    expect(screen.getByText("Wave Warp")).toBeInTheDocument();
    expect(screen.getByText("Scanlines")).toBeInTheDocument();
    expect(screen.getByText("Edge Glow")).toBeInTheDocument();
    const preview = screen
      .getByRole("button", {
        name: /^Golden Hour\. Drag onto a clip to apply/i,
      })
      .querySelector('[data-effect-preview="golden-hour"]');
    expect(preview).toHaveAttribute("data-preview-progress", "0.72");
  });

  it("filters visual effects by category without losing previews", () => {
    render(<EffectsPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Stylize 10" }));

    expect(screen.getByRole("button", { name: "Stylize 10" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("Dream Bloom")).toBeInTheDocument();
    expect(screen.getByText("RGB Split")).toBeInTheDocument();
    expect(screen.queryByText("Brightness")).not.toBeInTheDocument();
    expect(screen.queryByText("Golden Hour")).not.toBeInTheDocument();
    expect(document.querySelectorAll("[data-effect-preview]")).toHaveLength(10);
  });

  it("applies curated effect parameters to the selected overlay", async () => {
    useProjectStore.getState().createNewProject("Curated effect application");
    await useProjectStore.getState().addTrack("text");
    const textTrack = useProjectStore
      .getState()
      .project.timeline.tracks.find((track) => track.type === "text");
    if (!textTrack) throw new Error("text track not created");
    const textClip = useProjectStore
      .getState()
      .createTextClip(textTrack.id, 0, "Golden title", 5);
    if (!textClip) throw new Error("text clip not created");
    useUIStore
      .getState()
      .select({ type: "clip", id: textClip.id, trackId: textTrack.id });
    render(<EffectsPanel />);

    fireEvent.doubleClick(
      screen.getByRole("button", {
        name: /^Golden Hour\. Drag onto a clip to apply/i,
      }),
    );
    fireEvent.doubleClick(
      screen.getByRole("button", {
        name: /^VHS\. Drag onto a clip to apply/i,
      }),
    );

    await waitFor(() => {
      expect(
        useProjectStore
          .getState()
          .project.textClips?.find((clip) => clip.id === textClip.id)
          ?.effects,
      ).toEqual([
        expect.objectContaining({
          type: "temperature",
          params: { value: 35 },
        }),
        expect.objectContaining({
          type: "shader",
          params: {
            shaderId: "vhs",
            intensity: 0.75,
            scanlines: 0.4,
            jitter: 0.45,
          },
        }),
      ]);
    });
  });

  it("double-clicks an effect onto a selected text overlay", async () => {
    useProjectStore.getState().createNewProject("Text effect application");
    await useProjectStore.getState().addTrack("text");
    const textTrack = useProjectStore
      .getState()
      .project.timeline.tracks.find((track) => track.type === "text");
    if (!textTrack) throw new Error("text track not created");
    const textClip = useProjectStore
      .getState()
      .createTextClip(textTrack.id, 0, "Effect title", 5);
    if (!textClip) throw new Error("text clip not created");
    useUIStore
      .getState()
      .select({ type: "clip", id: textClip.id, trackId: textTrack.id });
    render(<EffectsPanel />);

    fireEvent.doubleClick(
      screen.getByRole("button", {
        name: /^Brightness\. Drag onto a clip to apply/i,
      }),
    );

    await waitFor(() => {
      expect(
        useProjectStore
          .getState()
          .project.textClips?.find((clip) => clip.id === textClip.id)
          ?.effects,
      ).toEqual([
        expect.objectContaining({ type: "brightness", enabled: true }),
      ]);
    });
  });

  it.each(["en-US", "zh-CN"])("applies a transition with unchanged params in %s", async (locale) => {
    configureShotloomLocale(locale);
    const first = clip("transition-a", 0);
    const second = clip("transition-b", 3);
    const project = createEmptyProject("Transition application");
    useProjectStore.setState({
      hasOpenProject: true,
      project: {
        ...project,
        timeline: {
          ...project.timeline,
          duration: 6,
          tracks: [
            {
              id: "transition-track",
              type: "video",
              name: "Video",
              clips: [first, second],
              transitions: [],
              locked: false,
              hidden: false,
              muted: false,
              solo: false,
            },
          ],
        },
      },
    });
    useUIStore.getState().selectMultiple([
      { type: "clip", id: first.id, trackId: first.trackId },
      { type: "clip", id: second.id, trackId: second.trackId },
    ]);
    render(<TransitionsPanel />);

    fireEvent.click(screen.getByRole("button", { name: locale === "zh-CN" ? /^运动 \d+$/ : /^Movement \d+$/ }));
    fireEvent.change(screen.getByPlaceholderText(locale === "zh-CN" ? "搜索转场" : "Search transitions"), { target: { value: locale === "zh-CN" ? "运动" : "Movement" } });
    fireEvent.doubleClick(
      screen.getByRole("button", { name: locale === "zh-CN" ? /^向右翻页。拖到片段边缘/ : /Page Turn Right\. Drag onto/i }),
    );

    await waitFor(() => {
      const transition =
        useProjectStore.getState().project.timeline.tracks[0]?.transitions[0];
      expect(transition).toMatchObject({
        clipAId: first.id,
        clipBId: second.id,
        type: "pageTurn",
        params: { direction: "right", shadow: 0.55 },
      });
    });
  });
});

function clip(id: string, startTime: number): Clip {
  return {
    id,
    mediaId: `media-${id}`,
    trackId: "transition-track",
    startTime,
    duration: 3,
    inPoint: 0,
    outPoint: 3,
    effects: [],
    audioEffects: [],
    transform: {
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      anchor: { x: 0.5, y: 0.5 },
      opacity: 1,
    },
    volume: 1,
    keyframes: [],
  };
}
