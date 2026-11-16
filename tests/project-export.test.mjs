import assert from 'node:assert/strict';

import test from 'node:test';
import { readSource } from './helpers/sourceContract.mjs';

const tauriApi = readSource('renderer/src/services/tauriApi.ts');
const projectStore = readSource('renderer/src/store/projectStore.ts');
const projectCommands = readSource('electron/ipc/commands/project.ts');
const projectMain = readSource('electron/main.ts');
const zipCore = readSource('electron/core/zip.ts');

test('项目导出连接保存对话框与原生 ZIP 命令', () => {
  assert.match(tauriApi, /case 'project:export-package': return invoke\('project_export_package'/);
  assert.match(tauriApi, /return `\$\{base\}\.shotloom-project\.zip`/);
  assert.match(tauriApi, /exportPackage: exportProjectPackage/);
  assert.match(tauriApi, /importPackage: importProjectPackage/);
  assert.doesNotMatch(tauriApi, /exportPackage: unsupported\('项目 ZIP 导出'\)/);
  assert.doesNotMatch(tauriApi, /importPackage: unsupported\('项目 ZIP 导入'\)/);
  assert.match(projectStore, /exportPackage\?\.\(project\.projectDir, project\.name\)/);
});

test('原生项目包包含清单和 project 目录下的实体文件', () => {
  assert.match(projectMain, /import '.\/ipc\/commands\/project';/);
  assert.match(projectCommands, /shotloom-project-package/);
  assert.match(projectCommands, /`project\/\$\{PROJECT_FILE\}`|project\/\$\{relative\}/);
  assert.match(projectCommands, /项目包不能保存到项目目录内部/);
  assert.match(projectCommands, /await rename\(temporary, target\)/);
  assert.match(projectCommands, /项目包包含不安全路径/);
  assert.match(projectCommands, /项目包解压体积超过 20GB 上限/);
  // 项目包是流式 STORED ZIP：整包不进内存，导入按条目落盘。
  assert.match(zipCore, /StoredZipWriter/);
  assert.match(zipCore, /createReadStream/);
});
