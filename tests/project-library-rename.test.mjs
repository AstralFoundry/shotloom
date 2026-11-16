import assert from 'node:assert/strict';

import test from 'node:test';
import { readSource } from './helpers/sourceContract.mjs';

const projectsView = readSource('renderer/src/app/views/ProjectsView.tsx');
const projectAdapter = readSource('renderer/src/app/adapters/projectLibraryAdapter.ts');
const projectCommand = readSource('electron/ipc/commands/project.ts');

test('项目重命名只在进入编辑态时全选，不会在每次输入后重复全选', () => {
  assert.match(projectsView, /const renameEntryKey = rename \? entryKey\(rename\.entry\) : ""/);
  assert.match(projectsView, /renameInput\.current\?\.select\(\);[\s\S]*?\}, \[renameEntryKey\]\)/);
  assert.doesNotMatch(projectsView, /renameInput\.current\?\.select\(\);[\s\S]*?\}, \[rename\]\)/);
});

test('项目重命名同步项目文件名称与最近项目路径', () => {
  assert.match(projectCommand, /const projectPath = join\(target, PROJECT_FILE\);/);
  assert.match(projectCommand, /project\.name = actualName/);
  assert.match(projectCommand, /await rename\(target, source\)/);
  assert.match(projectAdapter, /migrateRenamedRecentProjects/);
  assert.match(projectAdapter, /desktopApi\.recent\.remove\(project\.filePath\)/);
  assert.match(projectAdapter, /filePath:\s*replacePathPrefix\(project\.filePath, result\.oldDir, result\.newDir\)/);
});

test('按 Enter 通过 blur 只提交一次项目重命名', () => {
  assert.match(projectsView, /event\.key === "Enter"[\s\S]*?event\.preventDefault\(\);[\s\S]*?event\.currentTarget\.blur\(\)/);
  assert.doesNotMatch(projectsView, /event\.key === "Enter"\) void commitRename\(\)/);
});
