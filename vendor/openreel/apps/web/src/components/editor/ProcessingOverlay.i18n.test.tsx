import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ProcessingOverlay } from "./ProcessingOverlay";
import { useProcessingStore } from "../../services/processing-manager";
import { configureShotloomLocale } from "../../shotloom-mode";

afterEach(() => {
  cleanup();
  useProcessingStore.setState({ tasks: new Map(), isProcessing: false, currentTaskId: null });
  configureShotloomLocale("en-US");
});

describe("effect processing UI language", () => {
  it.each([1, 2])("uses complete English task summaries for %i tasks", (count) => {
    configureShotloomLocale("en-US");
    for (let index = 0; index < count; index++) useProcessingStore.getState().addTask(`clip-${index}`, "effects");
    render(<ProcessingOverlay />);
    expect(screen.getByText(`${count} ${count === 1 ? "task" : "tasks"} in progress`)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Processing Effects" })).toBeInTheDocument();
  });

  it("localizes task labels and progress without changing task IDs or upstream details", () => {
    configureShotloomLocale("zh-CN");
    const id = useProcessingStore.getState().addTask("clip-中文", "effects");
    const message = "上游处理详情 {name} $&";
    useProcessingStore.getState().updateTaskProgress(id, 25, message);
    render(<ProcessingOverlay />);
    expect(screen.getByRole("heading", { name: "正在处理效果" })).toBeInTheDocument();
    expect(screen.getByText("1 个任务正在进行")).toBeInTheDocument();
    expect(screen.getByText("视频效果")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "视频效果进度" })).toHaveAttribute("aria-valuenow", "25");
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(useProcessingStore.getState().tasks.get(id)).toMatchObject({ clipId: "clip-中文", type: "effects", status: "processing", message });
  });
});
