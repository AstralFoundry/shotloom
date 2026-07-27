import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const viewer = readFileSync(new URL('../renderer/src/app/components/MediaViewer.tsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('../renderer/src/services/tauriApi.js', import.meta.url), 'utf8');
test('放大预览的文件夹按钮在系统文件夹中定位原图', () => {
  assert.match(viewer, /title="在文件夹中显示"/); assert.match(viewer, /desktopApi\.file\.showItemInFolder/);
  assert.match(api, /file_show_item_in_folder/); assert.match(api, /showItemInFolder: \(path\) => command\('file:show-item-in-folder', path\)/);
});
