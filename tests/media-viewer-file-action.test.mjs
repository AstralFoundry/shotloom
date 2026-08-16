import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const viewer = readFileSync(new URL('../renderer/src/app/components/MediaViewer.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../renderer/styles/media-overlays.css', import.meta.url), 'utf8');
const api = readFileSync(new URL('../renderer/src/services/tauriApi.js', import.meta.url), 'utf8');
const overlay = readFileSync(new URL('../renderer/src/app/store/overlayStore.ts', import.meta.url), 'utf8');
test('放大预览的文件夹按钮在系统文件夹中定位原图', () => {
  assert.match(viewer, /在 Finder 中打开/); assert.match(viewer, /desktopApi\.file\.showItemInFolder/);
  assert.match(api, /file_show_item_in_folder/); assert.match(api, /showItemInFolder: \(path\) => command\('file:show-item-in-folder', path\)/);
});

test('媒体详情使用顶部缩放、独立关闭和底部原文件操作', () => {
  assert.match(viewer, /media-viewer-controls[\s\S]*?Math\.round\(zoom \* 100\)/);
  assert.match(viewer, /media-viewer-actions[\s\S]*?title="关闭"/);
  assert.match(viewer, /media\.kind === "video"[\s\S]*?media-viewer-video-controls[\s\S]*?formatMediaTime\(videoTime\)[\s\S]*?formatMediaTime\(videoDuration\)/);
  assert.match(viewer, /media-viewer-primary-actions[\s\S]*?saveMedia[\s\S]*?showFile/);
  assert.match(viewer, /readArrayBuffer\(media\.filePath\)[\s\S]*?saveArrayBuffer\(media\.title \|\| "media", buffer\)/);
  assert.match(styles, /\.media-viewer-backdrop:not\(\.is-text\)[\s\S]*?backdrop-filter: blur\(22px\)/);
  assert.match(styles, /\.media-viewer-primary-actions button/);
});

test('视频详情沿用节点已验证的媒体地址并主动播放', () => {
  assert.doesNotMatch(viewer, /convertFileSrc\(media\.filePath\)/);
  assert.match(viewer, /<video[\s\S]*?src=\{fullSrc \|\| media\.src\}[\s\S]*?controls[\s\S]*?autoPlay[\s\S]*?playsInline[\s\S]*?preload="auto"/);
  assert.match(viewer, /onCanPlay=\{\(event\) => \{[\s\S]*?event\.currentTarget\.play\(\)/);
  assert.match(viewer, /muted=\{videoMuted\}[\s\S]*?onLoadedMetadata[\s\S]*?onTimeUpdate/);
  assert.match(viewer, /title=\{videoMuted \? "开启声音" : "关闭声音"\}[\s\S]*?volume-x[\s\S]*?volume/);
});

test('文本详情使用可持久化格式工具栏和居中文档编辑器', () => {
  assert.match(viewer, /aria-label="文本格式"[\s\S]*?一级标题[\s\S]*?粗体[\s\S]*?无序列表[\s\S]*?插入表格/);
  assert.match(viewer, /contentEditable[\s\S]*?onInput=\{syncRichText\}/);
  assert.match(viewer, /markdownToRichHtml\(media\.src\)/);
  assert.match(viewer, /richHtmlToMarkdown\(textEditor\.current\.innerHTML/);
  assert.match(viewer, /editCommand\("bold"\)/);
  assert.match(viewer, /textSearchOpen[\s\S]*?function findText/);
  assert.match(viewer, /const markdown = currentMarkdown\(\)[\s\S]*?markdown !== media\.src[\s\S]*?media\.onSave\(markdown\)/);
  assert.match(styles, /\.media-viewer-backdrop\.is-text \{[\s\S]*?background: rgba\(16, 18, 20, \.62\)/);
  assert.match(styles, /\.text-editor-formatting/);
  assert.match(overlay, /kind !== "text" && !src\.trim\(\)/);
});
