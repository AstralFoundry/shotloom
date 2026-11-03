import "../../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureShotloomLocale, getEditorLocale } from "../../../shotloom-mode";
import { useProjectStore } from "../../../stores/project-store";
import { MarkersPanel } from "./MarkersPanel";
import { HistoryPanel } from "./HistoryPanel";
const playback = vi.hoisted(() => ({ getCurrentTime: vi.fn(() => 3.5), scrubTo: vi.fn() }));
vi.mock("../../../bridges/playback-bridge", () => ({ getPlaybackBridge: () => playback }));

describe.each(["en-US", "zh-CN"] as const)("markers and history (%s)", (locale) => {
  const ui = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  beforeEach(() => {
    configureShotloomLocale(locale); vi.clearAllMocks();
    useProjectStore.getState().createNewProject("Original project");
    useProjectStore.getState().actionHistory.clear();
    useProjectStore.setState({ clipUndoStack: [], clipRedoStack: [] });
  });
  afterEach(() => { cleanup(); configureShotloomLocale("en-US"); });

  it("creates, edits, seeks and removes a real marker without rewriting its label", async () => {
    render(<MarkersPanel />);
    expect(screen.getByText(ui("No markers yet", "暂无标记"))).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: ui("Add", "添加") })); });
    const marker = useProjectStore.getState().project.timeline.markers[0];
    expect(marker).toMatchObject({ time: 3.5, label: ui("Marker 1", "标记 1"), color: "#3b82f6" });
    fireEvent.click(screen.getByRole("button", { name: ui("Edit Marker 1", "编辑标记 1") }));
    const name = "用户名称 {name} $&";
    fireEvent.change(screen.getByRole("textbox", { name: ui("Marker label", "标记名称") }), { target: { value: name } });
    fireEvent.click(screen.getByRole("button", { name: ui("Use marker color #ef4444", "使用标记颜色 #ef4444") }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: ui("Save", "保存") })); });
    expect(useProjectStore.getState().getMarker(marker.id)).toMatchObject({ id: marker.id, label: name, color: "#ef4444", time: 3.5 });
    fireEvent.click(screen.getByRole("button", { name: ui(`Jump to ${name}`, `跳转到${name}`) }));
    expect(playback.scrubTo).toHaveBeenCalledWith(3.5);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: ui(`Remove ${name}`, `移除${name}`) })); });
    expect(useProjectStore.getState().project.timeline.markers).toEqual([]);
  });

  it("translates known action descriptions without modifying stored history", async () => {
    await useProjectStore.getState().addMarker(2, "Original marker", "#ff0000");
    const history = useProjectStore.getState().actionHistory;
    const original = history.getHistoryEntries()[0].description;
    expect(original).toBe("Add marker");
    render(<HistoryPanel />);
    expect(screen.getByText(ui("Add marker", "添加标记"))).toBeInTheDocument();
    expect(history.getHistoryEntries()[0].description).toBe(original);
  });

  it("saves and deletes named snapshots and formats time using the selected locale", () => {
    render(<HistoryPanel />);
    expect(screen.getByText(ui("No actions yet", "暂无操作记录"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ui("Undo (0)", "撤销（0）") })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: ui("Show snapshots", "显示快照") }));
    expect(screen.getByText(ui("No snapshots saved", "暂无已保存的快照"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ui("Create Snapshot", "创建快照") }));
    const name = "原始快照 {name} $&";
    fireEvent.change(screen.getByRole("textbox", { name: ui("Snapshot name", "快照名称") }), { target: { value: name } });
    fireEvent.click(screen.getByRole("button", { name: ui("Save", "保存") }));
    const snapshots = useProjectStore.getState().actionHistory.getSnapshots();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].name).toBe(name);
    expect(screen.getByText(new Date(snapshots[0].timestamp).toLocaleTimeString(getEditorLocale(), { hour: "2-digit", minute: "2-digit" }))).toBeInTheDocument();
    expect(screen.getByText(name)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ui(`Delete snapshot ${name}`, `删除快照${name}`) }));
    expect(useProjectStore.getState().actionHistory.getSnapshots()).toEqual([]);
  });
});
