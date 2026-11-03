import { afterEach, describe, expect, it, vi } from "vitest";

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
  document.body.replaceChildren();
  window.history.replaceState({}, "", "/");
  vi.resetModules();
});

describe("Shotloom editor UI translation", () => {
  it("translates inspector and clip labels without translating captured user names", async () => {
    const { translateUiText } = await import("./shotloom-i18n");
    expect(translateUiText("Find and replace captions")).toBe("查找和替换字幕");
    expect(translateUiText("No captions match this search.")).toBe("没有与当前搜索匹配的字幕。");
    expect(translateUiText("Noise Reduction")).toBe("降噪");
    expect(translateUiText("No keyframes for this property. Add one to start animating.")).toBe("此属性还没有关键帧。添加一个关键帧即可开始制作动画。");
    expect(translateUiText("This panel hit an error. Switch tabs and back to retry.")).toBe("此面板发生错误，切换到其他标签后再返回即可重试。");
    expect(translateUiText("Canvas pixels")).toBe("画布像素");
    expect(translateUiText("Offset pixels")).toBe("偏移（像素）");
    expect(translateUiText("Expand Text Properties section")).toBe("展开文字属性");
    expect(translateUiText("Collapse Text Properties section")).toBe("收起文字属性");
    expect(translateUiText("Expand Text Behind Subject section")).toBe("展开主体后方文字");
    expect(translateUiText("Collapse Text Behind Subject section")).toBe("收起主体后方文字");
    expect(translateUiText("Anchor Point X")).toBe("锚点 X");
    expect(translateUiText("Anchor Point Y")).toBe("锚点 Y");
    expect(translateUiText("Expand Text Animation section")).toBe("展开文字动画");
    expect(translateUiText("Collapse Text Animation section")).toBe("收起文字动画");
    expect(translateUiText("Hide track")).toBe("隐藏轨道");
    expect(translateUiText("Show track")).toBe("显示轨道");
    expect(translateUiText("Collapse Alignment section")).toBe("收起对齐");
    expect(translateUiText("Expand Audio Effects section")).toBe("展开音频效果");
    expect(translateUiText("Collapse Batch Transform section")).toBe("收起批量变换");
    expect(translateUiText("Search effects for video clip...")).toBe("搜索 视频 片段的效果…");
    for (const name of ["Text", "Media", "Title", "用户内容 {name} $&", "Clip with spaces.mov"]) {
      expect(translateUiText(`Select text clip ${name}`)).toBe(`选择文字片段 ${name}`);
      expect(translateUiText(`Select clip ${name}`)).toBe(`选择片段 ${name}`);
      expect(translateUiText(`Options for ${name}`)).toBe(`${name} 的选项`);
      expect(translateUiText(`Delete ${name}`)).toBe(`删除 ${name}`);
      expect(translateUiText(`Move ${name}`)).toBe(`移动 ${name}`);
    }
  });

  it("translates real attributes while leaving editable and named user content unchanged", async () => {
    window.history.replaceState({}, "", "/?shotloom=1");
    vi.resetModules();
    const { installShotloomI18n, stopShotloomI18n } = await import("./shotloom-i18n");
    stop = stopShotloomI18n;
    const input = document.createElement("input");
    input.setAttribute("aria-label", "Anchor Point X");
    input.value = "25%";
    const clip = document.createElement("button");
    clip.setAttribute("aria-label", "Select text clip Media");
    const name = document.createElement("span");
    name.setAttribute("data-shotloom-user-content", "");
    name.textContent = "Media";
    clip.append(name);
    const draft = document.createElement("textarea");
    draft.value = "Text 用户草稿 {name}";
    const track = document.createElement("span");
    track.setAttribute("data-shotloom-user-content", "");
    track.textContent = "Title";
    const section = document.createElement("button");
    section.setAttribute("aria-label", "Expand Alignment section");
    section.textContent = "Alignment";
    document.body.append(input, clip, draft, track, section);
    installShotloomI18n();
    document.dispatchEvent(new Event("DOMContentLoaded"));
    expect(input.getAttribute("aria-label")).toBe("锚点 X");
    expect(input.value).toBe("25%");
    expect(clip.getAttribute("aria-label")).toBe("选择文字片段 Media");
    expect(name.textContent).toBe("Media");
    expect(track.textContent).toBe("Title");
    expect(draft.value).toBe("Text 用户草稿 {name}");
    expect(section.getAttribute("aria-label")).toBe("展开对齐");
    expect(section.textContent).toBe("对齐");
    section.setAttribute("aria-label", "Collapse Alignment section");
    name.textContent = "Title";
    await vi.waitFor(() => {
      expect(section.getAttribute("aria-label")).toBe("收起对齐");
      expect(name.textContent).toBe("Title");
    });
  });
});
