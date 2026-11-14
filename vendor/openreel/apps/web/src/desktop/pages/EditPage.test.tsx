import "../../test/install-local-storage-mock";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("../../components/editor/AssetsPanel", () => ({
  AssetsPanel: () => <div>Media panel</div>,
}));
vi.mock("../../components/editor/InspectorPanel", () => ({
  InspectorPanel: () => <div>Inspector panel</div>,
}));
vi.mock("../../components/editor/Preview", () => ({
  Preview: () => <div>Preview panel</div>,
}));
vi.mock("../../components/editor/Timeline", () => ({
  Timeline: () => <div>Timeline panel</div>,
}));
import { EditPage } from "./EditPage";

describe("EditPage dock", () => {
  afterEach(() => { cleanup(); window.localStorage.clear(); });
  it("keeps media, viewer, inspector and timeline without the upstream chat dock", async () => {
    render(<EditPage />);
    expect(await screen.findByText("Timeline panel")).toBeTruthy();
    expect(await screen.findByText("Preview panel")).toBeTruthy();
    expect(screen.getByText("Media panel")).toBeTruthy();
    expect(screen.getByText("Inspector panel")).toBeTruthy();
    expect(screen.getByTestId("desktop-edit-page").style.gridTemplateAreas).not.toContain("chat");
  });
});
