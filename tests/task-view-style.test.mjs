import assert from 'node:assert/strict';

import test from 'node:test';
import { readSource } from './helpers/sourceContract.mjs';
const view = readSource('renderer/src/app/views/TasksView.tsx');
const migrationStyles = readSource('renderer/styles/project-materials.css');
test('项目任务卡片保持清晰层级且不混入助手运行中心', () => {
  assert.doesNotMatch(view, /task-list-head/);
  assert.match(view, /task-record-meta/);
  assert.match(view, /const active = isActiveTaskStatus\(task\.status\)/);
  assert.match(view, /active &&[\s\S]*?task-progress-track/);
  assert.match(view, /<StatusPill status=\{status\} \/>/);
  assert.match(view, /className="task-search"/);
  assert.match(view, /className="task-list-summary"/);
  assert.match(migrationStyles, /\.task-record \{[\s\S]*?border:\s*1px solid var\(--line\)/);
  assert.match(migrationStyles, /\.task-record-actions \.pill \{[^}]*border:\s*0/);
  assert.doesNotMatch(view, /助手运行中心/);
});
test('任务以名称和次要信息呈现，完整编号留在行提示中', () => {
  // 类型曾经同时出现在图标、pill 和描述文案里，五行任务读起来全是「图片生成」。
  assert.match(view, /className="task-record-icon" title=\{typeLabel\}/);
  assert.doesNotMatch(view, /<span>\{typeLabel\}<\/span>/);
  assert.match(
    view,
    /task-record-meta[\s\S]*?<time>\{formatTime\(task\.createdAt\)\}<\/time>/,
  );
  assert.match(view, /title=\{`#\$\{task.id\}`\}/);
  assert.doesNotMatch(view, /className="task-record-ref"/);
  // 次要信息不被推到行右端。
  assert.doesNotMatch(migrationStyles, /\.task-record-ref \{ margin-left: auto/);
  assert.doesNotMatch(migrationStyles, /\.task-record-title time/);
});
test('上游原文默认收起，点开才占第三行', () => {
  assert.match(view, /detailOpen && failure\?\.detail/);
  assert.match(view, /className="task-record-source"/);
  assert.match(migrationStyles, /\.task-record-error-detail \{/);
});
test('任务操作常驻可见，悬停和键盘聚焦有清晰反馈', () => {
  assert.match(migrationStyles, /\.task-record-actions \.icon-button \{[^}]*color:\s*var\(--muted\)/);
  assert.match(migrationStyles, /\.task-record-actions \.icon-button:hover \{[^}]*color:\s*var\(--brand-accent\)/);
  assert.match(migrationStyles, /\.task-record-actions \.icon-button:focus-visible \{[^}]*outline:/);
});
