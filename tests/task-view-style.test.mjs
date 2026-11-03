import assert from 'node:assert/strict';

import test from 'node:test';
import { readSource } from './helpers/sourceContract.mjs';
const view = readSource('renderer/src/app/views/TasksView.tsx');
const migrationStyles = readSource('renderer/styles/project-materials.css');
test('项目任务使用平面信息行且不混入助手运行中心', () => {
  assert.doesNotMatch(view, /task-list-head/);
  assert.match(view, /task-record-meta/);
  assert.match(view, /const active = isActiveTaskStatus\(task\.status\)/);
  assert.match(view, /active &&[\s\S]*?task-progress-track/);
  assert.match(view, /<StatusPill status=\{status\} \/>/);
  assert.match(view, /className="task-search"/);
  assert.match(view, /className="task-list-summary"/);
  assert.match(migrationStyles, /\.task-record \{[\s\S]*?border-bottom:\s*1px solid var\(--line\)/);
  assert.match(migrationStyles, /\.task-record-title \.pill \{[^}]*border:\s*1px solid var\(--line\)/);
  assert.doesNotMatch(view, /助手运行中心/);
});
test('一行只留两排：类型退回图标，时间与编号跟在次要文案后面', () => {
  // 类型曾经同时出现在图标、pill 和描述文案里，五行任务读起来全是「图片生成」。
  assert.match(view, /className="task-record-icon" title=\{typeLabel\}/);
  assert.doesNotMatch(view, /<span>\{typeLabel\}<\/span>/);
  assert.match(
    view,
    /task-record-meta[\s\S]*?<time>\{formatTime\(task\.createdAt\)\}<\/time>[\s\S]*?task-record-ref/,
  );
  // 画布窗口很宽时，靠到行右端的时间和编号会在中间空出一段读不通的距离。
  assert.doesNotMatch(migrationStyles, /\.task-record-ref \{ margin-left: auto/);
  assert.doesNotMatch(migrationStyles, /\.task-record-title time/);
});
test('上游原文默认收起，点开才占第三行', () => {
  assert.match(view, /detailOpen && failure\?\.detail/);
  assert.match(view, /className="task-record-source"/);
  assert.match(migrationStyles, /\.task-record-error-detail \{/);
});
test('任务操作以低饱和常驻，悬停或键盘聚焦时回到全饱和', () => {
  assert.match(migrationStyles, /\.task-record-actions[\s\S]*?opacity:\s*\.45/);
  assert.match(migrationStyles, /\.task-record:hover \.task-record-actions[\s\S]*?\.task-record:focus-within \.task-record-actions/);
});
