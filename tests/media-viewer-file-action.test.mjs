import assert from 'node:assert/strict';

import test from 'node:test';
import { readLocalizedSource as readSource } from './helpers/sourceContract.mjs';
const viewer = readSource('renderer/src/app/components/MediaViewer.tsx');
const styles = readSource('renderer/styles/media-overlays.css');
const api = readSource('renderer/src/services/tauriApi.ts');
const overlay = readSource('renderer/src/app/store/overlayStore.ts');
test('放大预览的文件夹按钮在系统文件夹中定位原图', () => {
  assert.match(viewer, /在 Finder 中打开/); assert.match(viewer, /desktopApi\.file\.showItemInFolder/);
  assert.match(api, /file_show_item_in_folder/); assert.match(api, /showItemInFolder: \(path: string\) => command\('file:show-item-in-folder', path\)/);
});

test('媒体详情使用顶部缩放、独立关闭和底部原文件操作', () => {
  assert.match(viewer, /media-viewer-controls[\s\S]*?Math\.round\(zoom \* 100\)/);
  assert.match(viewer, /media-viewer-actions[\s\S]*?title="关闭"/);
  assert.match(viewer, /media\.kind === "video"[\s\S]*?media-viewer-video-controls[\s\S]*?formatMediaTime\(videoTime\)[\s\S]*?formatMediaTime\(videoDuration\)/);
  assert.match(viewer, /media-viewer-primary-actions[\s\S]*?saveMedia[\s\S]*?showFile/);
  assert.match(viewer, /readArrayBuffer\(media\.filePath\)[\s\S]*?saveArrayBuffer\(media\.title \|\| "media", buffer\)/);
  assert.match(styles, /\.media-viewer-backdrop:not\(\.is-text\)[\s\S]*?backdrop-filter: blur\(var\(--overlay-blur\)\)/);
  assert.match(styles, /\.media-viewer-primary-actions button/);
});

test('视频详情沿用节点已验证的媒体地址并主动播放', () => {
  assert.doesNotMatch(viewer, /convertFileSrc\(media\.filePath\)/);
  assert.match(viewer, /<video[\s\S]*?src=\{fullSrc \|\| media\.src\}[\s\S]*?controls[\s\S]*?autoPlay[\s\S]*?playsInline[\s\S]*?preload="auto"/);
  assert.match(viewer, /onCanPlay=\{\(event\) => \{[\s\S]*?event\.currentTarget\.play\(\)/);
  assert.match(viewer, /muted=\{videoMuted\}[\s\S]*?onLoadedMetadata[\s\S]*?onTimeUpdate/);
  assert.match(viewer, /title=\{videoMuted \? "开启声音" : "关闭声音"\}[\s\S]*?volume-x[\s\S]*?volume/);
});

test('媒体层只使用 overlay 墨色三档，不再自带一套调色板', () => {
  assert.doesNotMatch(styles, /color:\s*#[0-9a-fA-F]{3,8}/);
  assert.match(styles, /color: var\(--overlay-ink\)/);
  assert.match(styles, /color: var\(--overlay-ink-muted\)/);
  assert.match(styles, /background: var\(--overlay-surface\)/);
});

test('文本详情使用可持久化格式工具栏和居中文档编辑器', () => {
  assert.match(viewer, /aria-label="文本格式"[\s\S]*?一级标题[\s\S]*?粗体[\s\S]*?无序列表[\s\S]*?插入表格/);
  assert.match(viewer, /contentEditable[\s\S]*?onInput=\{syncRichText\}/);
  assert.match(viewer, /markdownToRichHtml\(media\.src\)/);
  assert.match(viewer, /richHtmlToMarkdown\(textEditor\.current\.innerHTML/);
  assert.match(viewer, /editCommand\("bold"\)/);
  assert.match(viewer, /textSearchOpen[\s\S]*?function findText/);
  assert.match(viewer, /const markdown = currentMarkdown\(\)[\s\S]*?markdown !== savedText\.current[\s\S]*?media\.onSave\(markdown\)/);
  const textSurface = styles.match(/\.media-viewer-backdrop\.is-text \{[^}]*\}/)?.[0] || '';
  assert.match(textSurface, /grid-template-rows: 46px minmax\(0, 1fr\);/);
  assert.match(textSurface, /background: var\(--surface\);/);
  assert.doesNotMatch(textSurface, /backdrop-filter|padding: 32px|rgba\(16, 18, 20/);
  assert.match(styles, /\.text-editor-formatting/);
  // 格式工具栏与全局图标语言同源：不用字号硬撑的伪字形，只画 IconSymbol。
  assert.match(viewer, /<IconSymbol name="bold" \/>[\s\S]*?<IconSymbol name="italic" \/>[\s\S]*?<IconSymbol name="list-bullet" \/>[\s\S]*?<IconSymbol name="list-ordered" \/>[\s\S]*?<IconSymbol name="table" \/>/);
  assert.doesNotMatch(viewer, /className="text-format-/);
  assert.doesNotMatch(styles, /\.text-format-(list|table)|font: (700|italic)? ?\d+px Georgia/);
  assert.match(overlay, /kind !== "text" && !src\.trim\(\)/);
});
