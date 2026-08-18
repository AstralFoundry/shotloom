import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const view = readFileSync(new URL('../renderer/src/app/views/TasksView.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../renderer/styles.css', import.meta.url), 'utf8');
const migrationStyles = readFileSync(new URL('../renderer/styles/project-materials.css', import.meta.url), 'utf8');
test('项目任务使用平面信息行且不混入助手运行中心', () => {
  assert.doesNotMatch(view, /task-list-head/);
  assert.match(view, /task-record-meta/);
  assert.match(view, /const active = \["running", "queued"\]/);
  assert.match(view, /active &&[\s\S]*?task-progress-track/);
  assert.match(view, /<StatusPill status=\{status\} \/>/);
  assert.match(view, /className="task-search"/);
  assert.match(view, /className="task-list-summary"/);
  assert.match(migrationStyles, /\.task-record \{[\s\S]*?border-bottom:\s*1px solid #f0f0f0/);
  assert.match(migrationStyles, /\.task-record-title > span:not\(\.pill\)[\s\S]*?border:\s*1px solid #e2e2e2/);
  assert.doesNotMatch(view, /助手运行中心/);
});
test('任务操作默认收起并在悬停或键盘聚焦时出现', () => {
  assert.match(styles, /\.task-record-actions[\s\S]*?opacity:\s*0/);
  assert.match(styles, /\.task-record:hover \.task-record-actions[\s\S]*?\.task-record:focus-within \.task-record-actions/);
});
