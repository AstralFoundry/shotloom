import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.resetModules(); });

describe("embedded runtime language isolation", () => {
  it("keeps each runtime translator independent and preserves upstream failures", async () => {
    vi.resetModules();
    const english = await import("./shotloom-mode");
    expect(english.editorMessage("editor.captions.editableSingle", { count: 1 })).toBe("1 editable text clip");
    english.configureShotloomLocale("en-US");
    await expect(english.requestShotloomFiles([])).rejects.toThrow("The editing host is not ready.");
    vi.resetModules();
    const chinese = await import("./shotloom-mode");
    chinese.configureShotloomLocale("zh-CN");
    await expect(chinese.requestShotloomFiles([])).rejects.toThrow("剪辑宿主尚未就绪");
    expect(english.shotloomMessage("editor.runtime.importing")).toBe("Importing media");
    expect(chinese.shotloomMessage("editor.runtime.importing")).toBe("导入素材");
    expect(english.editorMessage("editor.captions.editablePlural", { count: 2 })).toBe("2 editable text clips");
    expect(chinese.editorMessage("editor.captions.editablePlural", { count: 2 })).toBe("2 条可编辑文字片段");
    const original = new Error("上游原始错误 {name}");
    english.bindShotloomHost({} as never, async () => { throw original; });
    await expect(english.requestShotloomFiles([])).rejects.toBe(original);
  });
});

 it("formats inspector counts with locale units and English plural forms", async () => {
   const runtime = await import("./shotloom-mode");
   runtime.configureShotloomLocale("en-US");
   expect([0, 1, 2].map(count => runtime.editorItemCount("clips", count))).toEqual(["0 clips", "1 clip", "2 clips"]);
   runtime.configureShotloomLocale("zh-CN");
   expect([0, 1, 2].map(count => runtime.editorItemCount("clips", count))).toEqual(["0 个片段", "1 个片段", "2 个片段"]);
 });
