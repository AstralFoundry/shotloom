import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getExportEngine, type ExportError } from "@openreel/core";
import { configureShotloomLocale } from "../../shotloom-mode";
import { useProjectStore } from "../../stores/project-store";
import { createExportJobRunner } from "./export-job-runner";

const engine = getExportEngine();
const originalProject = useProjectStore.getState().project;
beforeEach(() => useProjectStore.getState().createNewProject());
afterEach(() => {
  vi.restoreAllMocks();
  configureShotloomLocale("en-US");
  useProjectStore.setState({ project: originalProject });
});

function failure() {
  const error = Object.assign(new Error("upstream compatibility text"), {
    code: "INVALID_SETTINGS", phase: "preparing", recoverable: true,
    preflightIssue: { code: "missing-media", names: ["原始文件 {name} $&.mp4"] },
  }) as ExportError;
  return { success: false as const, error };
}

describe("native tool export runner language", () => {
  it.each([
    ["en-US", "Relink the original media before exporting: 原始文件 {name} $&.mp4"],
    ["zh-CN", "请先重新关联原始素材，再导出：原始文件 {name} $&.mp4"],
  ])("translates structured video and audio failures in %s", async (locale, expected) => {
    configureShotloomLocale(locale);
    vi.spyOn(engine, "exportVideo").mockImplementation(async function* () { return failure(); });
    vi.spyOn(engine, "exportAudio").mockImplementation(async function* () { return failure(); });
    const run = createExportJobRunner();
    for (const kind of ["exportVideo", "exportAudio"] as const) {
      const result = await run(kind, {});
      expect(result.ok).toBe(false);
      expect(result.error).toBe(expected);
    }
  });

  it("preserves raw upstream errors and rejects successful exports without actual data", async () => {
    configureShotloomLocale("zh-CN");
    const method = vi.spyOn(engine, "exportVideo");
    const detail = "Device {name} $& failed";
    method.mockImplementationOnce(async function* () { return { success: false, error: Object.assign(new Error(detail), { code: "FRAME_ENCODE_FAILED", phase: "encoding", recoverable: false }) as ExportError }; });
    const run = createExportJobRunner();
    expect(await run("exportVideo", {})).toMatchObject({ ok: false, error: detail });
    method.mockImplementationOnce(async function* () { return { success: true }; });
    expect(await run("exportVideo", {})).toMatchObject({ ok: false, error: "视频导出没有生成数据。" });
    method.mockImplementationOnce(async function* () { return { success: true }; });
    const runNative = createExportJobRunner({ createBackend: () => { throw new Error("must not instantiate"); }, getOutput: () => undefined });
    expect(await runNative("exportVideo", {})).toMatchObject({ ok: false, error: "原生导出没有返回已保存的文件。" });
  });

  it("translates invalid frame ranges and preserves missing composition IDs", async () => {
    configureShotloomLocale("zh-CN");
    const run = createExportJobRunner();
    expect(await run("exportFrame", { time: -1 })).toMatchObject({ ok: false, error: "画面帧时间超出编辑器时间线范围。" });
    expect(await run("exportFrame", { compositionId: "用户 {name} $&" })).toMatchObject({ ok: false, error: "找不到动态图形合成：用户 {name} $&" });
  });
});
