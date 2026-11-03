import "../../../test/install-local-storage-mock";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureShotloomLocale } from "../../../shotloom-mode";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import { SceneNavigatorPanel } from "./SceneNavigatorPanel";
const playback = vi.hoisted(() => ({ scrubTo: vi.fn(), getCurrentTime: vi.fn(() => 7.25) }));
vi.mock("../../../bridges/playback-bridge", () => ({ getPlaybackBridge: () => playback }));
describe.each(["en-US", "zh-CN"] as const)("scene navigator (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => { configureShotloomLocale(locale); vi.clearAllMocks(); const project = createEmptyProject("User project"); useProjectStore.setState({ hasOpenProject: true, project: { ...project, timeline: { ...project.timeline, duration: 12, markers: [{ id: "user-marker", time: 3, label: "原始 {name} Scene", color: "#abcdef" }] } } }); });
  afterEach(() => { cleanup(); configureShotloomLocale("en-US"); useProjectStore.setState({ hasOpenProject: false, project: createEmptyProject("Reset") }); });
  it.each(["vertical", "horizontal", "compact"] as const)("navigates the original marker time in %s layout", (variant) => {
    render(<SceneNavigatorPanel variant={variant} />);
    if (variant === "compact") expect(screen.getByText(ui("Intro", "片头"))).toBeInTheDocument();
    else expect(screen.getByRole("checkbox", { name: ui("Intro", "片头") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ui("Previous scene", "上一个场景") })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: ui("Next scene", "下一个场景") }));
    expect(playback.scrubTo).toHaveBeenLastCalledWith(3);
    expect(screen.getByRole("button", { name: ui("Next scene", "下一个场景") })).toBeDisabled();
    if (variant === "compact") expect(screen.getByText("原始 {name} Scene")).toBeInTheDocument();
    else expect(screen.getByRole("checkbox", { name: "原始 {name} Scene" })).toHaveAttribute("aria-checked", "true");
  });
  it("creates a localized marker at the playback time without renaming existing markers", async () => {
    render(<SceneNavigatorPanel />);
    fireEvent.click(screen.getByRole("button", { name: ui("Add Scene", "添加场景") }));
    await waitFor(() => expect(useProjectStore.getState().project.timeline.markers).toHaveLength(2));
    expect(useProjectStore.getState().project.timeline.markers[1]).toMatchObject({ time: 7.25, label: ui("Scene 2", "场景 2"), color: "#10b981" });
    expect(useProjectStore.getState().project.timeline.markers[0].label).toBe("原始 {name} Scene");
  });
});
