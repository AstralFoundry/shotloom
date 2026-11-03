import { configureShotloomLocale } from "../../shotloom-mode";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getMotionShaderFillDefs } from "@openreel/core";
import { ShaderPreviewBrowser } from "./ShaderPreviewBrowser";

describe("ShaderPreviewBrowser", () => {
  afterEach(cleanup);

  it("shows visual choices, filters them, and applies the previewed shader", () => {
    const defs = getMotionShaderFillDefs().filter((def) =>
      ["liquid-metal", "paper-mesh-gradient", "paper-dot-grid"].includes(
        def.id,
      ),
    );
    const onSelect = vi.fn();

    render(
      <ShaderPreviewBrowser
        defs={defs}
        selectedId="liquid-metal"
        onSelect={onSelect}
        sample="text"
        label="Text material previews"
      />,
    );

    expect(
      screen.getByRole("button", { name: "Preview and select Liquid Metal" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "Preview and select Mesh Gradient" }),
    ).toBeInTheDocument();

    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search text material previews" }),
      { target: { value: "dot" } },
    );

    expect(
      screen.queryByRole("button", { name: "Preview and select Mesh Gradient" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Preview and select Dot Grid" }),
    );
    expect(onSelect).toHaveBeenCalledWith("paper-dot-grid");
  });

  it("labels effect search as effects instead of materials", () => {
    render(
      <ShaderPreviewBrowser
        defs={getMotionShaderFillDefs().slice(0, 1)}
        onSelect={vi.fn()}
        sample="effect"
        label="Effect previews"
      />,
    );

    expect(
      screen.getByRole("searchbox", { name: "Search effect previews" }),
    ).toHaveAttribute("placeholder", "Search effects");
    expect(
      screen.getByRole("button", { name: /Preview and apply/ }),
    ).not.toHaveAttribute("aria-pressed");
  });

  it("disambiguates previews when shader names repeat across collections", () => {
    const builtIn = getMotionShaderFillDefs().find(
      (def) => def.name === "Liquid Metal",
    );
    expect(builtIn).toBeDefined();
    const defs = [
      builtIn!,
      {
        ...builtIn!,
        id: "paper-liquid-metal-test",
        collection: "Paper",
        category: "effect" as const,
      },
    ];
    render(
      <ShaderPreviewBrowser
        defs={defs}
        onSelect={vi.fn()}
        sample="text"
        label="Text material previews"
      />,
    );

    expect(
      screen.getByRole("button", {
        name: "Preview and select Liquid Metal, Built-in fill",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Preview and select Liquid Metal, Paper effect",
      }),
    ).toBeInTheDocument();
  });

  it("filters previews by shader collection while retaining visual selection", () => {
    const defs = getMotionShaderFillDefs().filter((def) =>
      ["liquid-metal", "paper-mesh-gradient", "paper-dot-grid"].includes(def.id),
    );
    render(
      <ShaderPreviewBrowser
        defs={defs}
        onSelect={vi.fn()}
        sample="text"
        label="Text material previews"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Paper · 2/i }));
    expect(screen.getByRole("button", { name: /Paper · 2/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.queryByRole("button", { name: "Preview and select Liquid Metal" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Preview and select Mesh Gradient" }),
    ).toBeInTheDocument();
  });
});


describe.each(["en-US", "zh-CN"] as const)("ShaderPreviewBrowser locale %s", locale => {
  afterEach(() => { cleanup(); configureShotloomLocale("en-US"); });
  it("searches translated builtin names and submits the original shader ID", () => {
    configureShotloomLocale(locale);
    const defs = getMotionShaderFillDefs().filter(def => ["liquid-metal", "paper-mesh-gradient", "paper-dot-grid"].includes(def.id));
    const onSelect = vi.fn();
    render(<ShaderPreviewBrowser defs={defs} onSelect={onSelect} />);
    const input = screen.getByRole("searchbox", { name: locale === "zh-CN" ? "搜索材质预览" : "Search material previews" });
    fireEvent.change(input, { target: { value: locale === "zh-CN" ? "网格渐变" : "Mesh Gradient" } });
    const button = screen.getByRole("button", { name: locale === "zh-CN" ? "预览并选择网格渐变" : "Preview and select Mesh Gradient" });
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledWith("paper-mesh-gradient");
    fireEvent.change(input, { target: { value: "不存在 {query} $&" } });
    expect(screen.getByText(locale === "zh-CN" ? "没有与“不存在 {query} $&”匹配的材质。" : "No materials match “不存在 {query} $&”.")).toBeInTheDocument();
  });
});
