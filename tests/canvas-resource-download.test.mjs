import assert from 'node:assert/strict';

import test from 'node:test';
import { readSource } from './helpers/sourceContract.mjs';

const adapter = readSource('renderer/src/app/adapters/canvasAdapter.ts');
const api = readSource('renderer/src/services/tauriApi.ts');
const fallback = readSource('renderer/src/services/desktopApi.ts');
const toolbar = readSource('renderer/src/app/canvas/BottomModeBar.tsx');

test('资源导出保留单文件与资源包契约但不在画布底栏提供下载入口', () => {
  assert.match(adapter, /sources\.length === 1[\s\S]*?desktopApi\.file\.exportFile\(sources\[0\]\)[\s\S]*?: await desktopApi\.file\.exportFilesPackage/);
  assert.match(api, /exportFile: async \(source: string, preferredName = ''\) => \{[\s\S]*?basename\(preferredName \|\| source\)[\s\S]*?command\('file:copy', source, target\)/);
  assert.match(api, /invoke<string>\('download_directory_get'\)[\s\S]*?file:resolve-unique-path/);
  assert.match(fallback, /exportFile: async \(\) => \(\{ ok: false \}\)/);
  assert.doesNotMatch(toolbar, /title="下载选中节点资源"/);
  assert.doesNotMatch(toolbar, /title="打包下载选中节点资源"/);
});
