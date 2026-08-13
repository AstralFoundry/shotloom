import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const viewer = readFileSync(new URL('../renderer/src/app/components/MediaViewer.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../renderer/styles/react-migration.css', import.meta.url), 'utf8');
const api = readFileSync(new URL('../renderer/src/services/tauriApi.js', import.meta.url), 'utf8');
const overlay = readFileSync(new URL('../renderer/src/app/store/overlayStore.ts', import.meta.url), 'utf8');
test('放大预览的文件夹按钮在系统文件夹中定位原图', () => {
  assert.match(viewer, /title="在文件夹中显示"/); assert.match(viewer, /desktopApi\.file\.showItemInFolder/);
  assert.match(api, /file_show_item_in_folder/); assert.match(api, /showItemInFolder: \(path\) => command\('file:show-item-in-folder', path\)/);
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
