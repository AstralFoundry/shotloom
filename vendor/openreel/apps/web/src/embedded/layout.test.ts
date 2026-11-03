import { describe, expect, it } from "vitest";
import { getEditorLocalRect } from "./layout";

describe("embedded overlay coordinates", () => {
  it("removes the host offset and canvas scale from floating menu anchors", () => {
    const root = document.createElement("div");
    root.className = "clip-studio-root";
    Object.defineProperties(root, { clientWidth: { value: 1000 }, clientHeight: { value: 600 } });
    root.getBoundingClientRect = () => new DOMRect(100, 80, 500, 300);
    const anchor = document.createElement("button"); root.append(anchor);
    anchor.getBoundingClientRect = () => new DOMRect(300, 180, 40, 20);
    const rect = getEditorLocalRect(anchor);
    expect([rect.left, rect.top, rect.width, rect.height]).toEqual([400, 200, 80, 40]);
  });
  it("keeps standalone editor browser coordinates", () => {
    const anchor = document.createElement("button");
    anchor.getBoundingClientRect = () => new DOMRect(30, 40, 50, 60);
    const rect = getEditorLocalRect(anchor);
    expect([rect.left, rect.top, rect.width, rect.height]).toEqual([30, 40, 50, 60]);
  });
});
