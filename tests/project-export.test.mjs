import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const tauriApi = readFileSync(new URL('../renderer/src/services/tauriApi.js', import.meta.url), 'utf8');
const projectStore = readFileSync(new URL('../renderer/src/store/projectStore.js', import.meta.url), 'utf8');
const rustProject = readFileSync(new URL('../src-tauri/src/commands/project.rs', import.meta.url), 'utf8');
const rustLib = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');

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
  assert.match(rustLib, /commands::project_export_package/);
  assert.match(rustLib, /commands::project_import_package/);
  assert.match(rustProject, /"schema": "shotloom-project-package"/);
  assert.match(rustProject, /format!\("project\/\{archive_name\}"\)/);
  assert.match(rustProject, /项目包不能保存到项目目录内部/);
  assert.match(rustProject, /fs::rename\(&temp, &target\)/);
  assert.match(rustProject, /项目包包含不安全路径/);
  assert.match(rustProject, /项目包解压体积超过 20GB 上限/);
});
