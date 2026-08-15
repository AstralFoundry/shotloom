import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const adapter = readFileSync(new URL('../renderer/src/app/adapters/canvasAdapter.ts', import.meta.url), 'utf8');
const api = readFileSync(new URL('../renderer/src/services/tauriApi.js', import.meta.url), 'utf8');
const fallback = readFileSync(new URL('../renderer/src/services/desktopApi.js', import.meta.url), 'utf8');
const toolbar = readFileSync(new URL('../renderer/src/app/canvas/BottomModeBar.tsx', import.meta.url), 'utf8');

test('资源导出保留单文件与资源包契约但不在画布底栏提供下载入口', () => {
  assert.match(adapter, /sources\.length === 1[\s\S]*?desktopApi\.file\.exportFile\(sources\[0\]\)[\s\S]*?: await desktopApi\.file\.exportFilesPackage/);
  assert.match(api, /exportFile: async \(source, preferredName = ''\) => \{[\s\S]*?basename\(preferredName \|\| source\)[\s\S]*?command\('file:copy', source, target\)/);
  assert.match(api, /localStorage\.getItem\('shotloom-download-dir'\)[\s\S]*?file:resolve-unique-path/);
  assert.match(fallback, /exportFile: async \(\) => \(\{ ok: false \}\)/);
  assert.doesNotMatch(toolbar, /title="下载选中节点资源"/);
  assert.doesNotMatch(toolbar, /title="打包下载选中节点资源"/);
});
