import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const projectsView = readFileSync(
  new URL('../renderer/src/app/views/ProjectsView.tsx', import.meta.url),
  'utf8',
);

test('项目重命名只在进入编辑态时全选，不会在每次输入后重复全选', () => {
  assert.match(projectsView, /const renameEntryKey = rename \? entryKey\(rename\.entry\) : ""/);
  assert.match(projectsView, /renameInput\.current\?\.select\(\);[\s\S]*?\}, \[renameEntryKey\]\)/);
  assert.doesNotMatch(projectsView, /renameInput\.current\?\.select\(\);[\s\S]*?\}, \[rename\]\)/);
});
