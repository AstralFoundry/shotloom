import "../../../test/install-local-storage-mock";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useEngineStore } from "../../../stores/engine-store";
import { useProjectStore } from "../../../stores/project-store";
import { ShapeSection } from "./ShapeSection";

const CLIP_ID = "shape-shader-clip";
const originalShowPopover = HTMLElement.prototype.showPopover;
const originalHidePopover = HTMLElement.prototype.hidePopover;

beforeAll(() => {
  HTMLElement.prototype.showPopover = function showPopover() {
    this.setAttribute("data-testid-popover-open", "true");
  };
  HTMLElement.prototype.hidePopover = function hidePopover() {
    this.removeAttribute("data-testid-popover-open");
  };
});

afterAll(() => {
  HTMLElement.prototype.showPopover = originalShowPopover;
  HTMLElement.prototype.hidePopover = originalHidePopover;
});

describe.each(["en-US", "zh-CN"] as const)("ShapeSection controls (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => {
    configureShotloomLocale(locale);
    const graphicsEngine = useEngineStore.getState().getGraphicsEngine();
    graphicsEngine?.clearCache();
    const shapeClip = graphicsEngine?.createShape(
      {
        id: CLIP_ID,
        shapeType: "rectangle",
        width: 240,
        height: 160,
        style: {
          fill: { type: "solid", color: "#14b8a6", opacity: 1 },
          stroke: { color: "#ffffff", width: 0, opacity: 1 },
        },
      },
      "track-shape",
      0,
      5,
    );
    if (!shapeClip) throw new Error("shape engine unavailable");

    useProjectStore.setState({
      hasOpenProject: true,
      project: {
        ...createEmptyProject("Shape shader"),
        shapeClips: [shapeClip],
        modifiedAt: Date.now(),
      },
    });
  });

  afterEach(() => {
    cleanup();
    configureShotloomLocale("en-US");
    useEngineStore.getState().getGraphicsEngine()?.clearCache();
    useProjectStore.setState({ hasOpenProject: false });
  });

  it("switches a shape fill to a shader and updates shader params", async () => {
    render(<ShapeSection clipId={CLIP_ID} />);

    expect(screen.getAllByRole("button", { name: ui("Select Color", "选择颜色") }).length).toBeGreaterThan(0);
    expect(screen.queryByPlaceholderText(/#rrggbb/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: ui("Shader", "着色器") }));

    await waitFor(() => {
      const fill = useEngineStore
        .getState()
        .getGraphicsEngine()
        ?.getShapeClip(CLIP_ID)?.style.fill;
      expect(fill?.type).toBe("shader");
      expect(fill?.shader?.shaderId).toBe("liquid-metal");
      expect(fill?.shader?.params.scale).toBe(6);
    });

    cleanup();
    render(<ShapeSection clipId={CLIP_ID} />);

    const picker = screen.getByRole("combobox", { name: ui("Shader Fill", "着色器填充") });
    fireEvent.click(picker);
    expect(await screen.findByText(ui("Built-in", "内置"))).toBeInTheDocument();
    expect(await screen.findByText("Paper")).toBeInTheDocument();

    const scaleField = screen
      .getAllByText(ui("Scale", "缩放"))
      .map((node) => node.closest(".astryx-field") as HTMLElement | null)
      .find(
        (field): field is HTMLElement =>
          field !== null && within(field).queryByRole("spinbutton") !== null,
      );
    expect(scaleField).toBeDefined();

    fireEvent.change(within(scaleField!).getByRole("spinbutton"), {
      target: { value: "12" },
    });

    await waitFor(() => {
      expect(
        useEngineStore
          .getState()
          .getGraphicsEngine()
          ?.getShapeClip(CLIP_ID)?.style.fill.shader?.params.scale,
      ).toBe(12);
    });
  });
  it("persists translated stroke, corner and shadow controls with zero opacity intact", async () => {
    render(<ShapeSection clipId={CLIP_ID} />);
    expect(screen.getByText(ui("Rectangle", "矩形"))).toBeInTheDocument();
    for (const [label, value] of [[ui("Dashed", "虚线"), [5, 5]], [ui("Dotted", "点线"), [2, 2]], [ui("Solid", "实线"), undefined]] as const) {
      fireEvent.click(screen.getByRole("button", { name: label }));
      expect(useProjectStore.getState().getShapeClip(CLIP_ID)?.style.stroke?.dashArray).toEqual(value);
    }
    const setSlider = (label: string, value: string) => {
      fireEvent.click(screen.getByRole("button", { name: ui(`Edit ${label} value`, `编辑${label}数值`) }));
      const input = screen.getByRole("textbox", { name: ui(`${label} value`, `${label}数值`) });
      fireEvent.change(input, { target: { value } });
      fireEvent.keyDown(input, { key: "Enter" });
    };
    setSlider(ui("Opacity", "不透明度"), "0");
    expect(useProjectStore.getState().getShapeClip(CLIP_ID)?.style.fill?.opacity).toBe(0);
    expect(screen.getByRole("slider", { name: ui("Opacity", "不透明度") })).toHaveAttribute("aria-valuenow", "0");
    setSlider(ui("Radius", "半径"), "18");
    setSlider(ui("Blur", "模糊"), "9");
    expect(useProjectStore.getState().getShapeClip(CLIP_ID)?.style).toMatchObject({ cornerRadius: 18, shadow: { blur: 9 }, fill: { opacity: 0 }, stroke: { width: 0 } });
    fireEvent.click(screen.getByRole("radio", { name: ui("Shader", "着色器") }));
    expect(useProjectStore.getState().getShapeClip(CLIP_ID)?.style.fill?.opacity).toBe(0);
  });
  it("shows a localized missing shape state", () => {
    render(<ShapeSection clipId="missing" />);
    expect(screen.getByText(ui("No shape clip selected", "未选择图形片段"))).toBeInTheDocument();
  });

});
