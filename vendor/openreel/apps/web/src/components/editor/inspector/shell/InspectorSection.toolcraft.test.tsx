import { configureShotloomLocale } from "../../../../shotloom-mode";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InspectorSection } from "./InspectorSection";

describe.each(["en-US", "zh-CN"] as const)("InspectorSection (%s)", locale => {
  beforeEach(() => configureShotloomLocale(locale));
  afterEach(() => { cleanup(); configureShotloomLocale("en-US"); });
  it("uses the shared Toolcraft panel section behavior", () => {
    render(
      <InspectorSection title="Transform" defaultOpen sectionId="transform">
        <div>Position controls</div>
      </InspectorSection>,
    );

    const header = screen.getByRole("button", {
      name: locale === "zh-CN" ? "收起Transform区域" : "Collapse Transform section",
    });
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Position controls")).toBeInTheDocument();

    fireEvent.click(header);

    expect(
      screen.getByRole("button", { name: locale === "zh-CN" ? "展开Transform区域" : "Expand Transform section" }),
    ).toHaveAttribute("aria-expanded", "false");
  });
});
