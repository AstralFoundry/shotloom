import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const view = readFileSync(new URL('../renderer/src/app/views/TasksView.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../renderer/styles.css', import.meta.url), 'utf8');
test('项目任务使用平面信息行且不混入助手运行中心', () => {
  assert.match(view, /task-list-head/); assert.match(view, /task-record-meta/); assert.match(view, /task-progress-track/);
  assert.doesNotMatch(view, /助手运行中心/);
});
test('任务操作默认收起并在悬停或键盘聚焦时出现', () => {
  assert.match(styles, /\.task-record-actions[\s\S]*?opacity:\s*0/);
  assert.match(styles, /\.task-record:hover \.task-record-actions[\s\S]*?\.task-record:focus-within \.task-record-actions/);
});
