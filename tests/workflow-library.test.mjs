/**
 * 工作流界面接线：入口、保存/应用的调用顺序、危险操作确认、文案齐全。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readSource } from './helpers/sourceContract.mjs';

const library = readSource('renderer/src/app/components/WorkflowLibrary.tsx');
const bottomBar = readSource('renderer/src/app/canvas/BottomModeBar.tsx');
const creationView = readSource('renderer/src/app/views/CreationView.tsx');
const zh = JSON.parse(readSource('renderer/src/i18n/locales/zh-CN.json'));
const en = JSON.parse(readSource('renderer/src/i18n/locales/en-US.json'));

test('画布底栏提供工作流入口，CreationView 挂载模板库', () => {
  assert.match(bottomBar, /onOpenWorkflows\?: \(\) => void/);
  assert.match(bottomBar, /onClick=\{onOpenWorkflows\}/);
  assert.match(creationView, /<WorkflowLibrary[\s\S]*?open=\{workflowLibraryOpen\}/);
  assert.match(creationView, /onOpenWorkflows=\{\(\) => setWorkflowLibraryOpen\(true\)\}/);
});

test('保存走真实编译与持久化，且没有选区时禁用', () => {
  assert.match(library, /buildWorkflowTemplate\(\{/);
  assert.match(library, /saveWorkflowTemplate\(\{ \.\.\.template, definition: defined \}\)/);
  assert.match(library, /selection/);
  assert.match(library, /disabled=\{!selection\.length\}/);
});

test('应用模板先实例化再运行，删除走确认框', () => {
  const instantiateIndex = library.indexOf('instantiateWorkflowTemplate(');
  const runIndex = library.indexOf('runWorkflowInstance(instance.id)');
  assert.ok(instantiateIndex > 0 && runIndex > instantiateIndex, '必须先创建实例再运行');
  assert.match(library, /modal\.confirm\(\{/);
  assert.match(library, /deleteWorkflowTemplate\(template\.id\)/);
  assert.match(library, /workflowInstanceProgress\(instance\)/);
  assert.match(library, /retryWorkflowInstance\(instance\.id\)/);
  assert.match(library, /cancelWorkflowInstance\(instance\.id\)/);
});

test('抽屉浮层压在确认框之下，避免确认框被挡住', () => {
  assert.match(library, /zIndex=\{520\}/);
});

test('工作流文案中英文齐全且参数一致', () => {
  const keys = Object.keys(zh).filter((key) => key.startsWith('workflow.'));
  assert.ok(keys.length >= 25, `工作流文案过少：${keys.length}`);
  for (const key of keys) {
    assert.ok(key in en, `英文缺少 ${key}`);
    const zhParams = [...zh[key].matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]).sort();
    const enParams = [...en[key].matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]).sort();
    assert.deepEqual(enParams, zhParams, `${key} 参数不一致`);
  }
});
