import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const runtime = readFileSync(new URL('../renderer/src/agent/runtime/OpenCodeRuntime.ts', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../renderer/src/app/views/SettingsPanel.tsx', import.meta.url), 'utf8');
const settingsStore = readFileSync(new URL('../renderer/src/store/settingsStore.js', import.meta.url), 'utf8');
const canvasTools = readFileSync(new URL('../renderer/src/agent/tools/canvasTools.ts', import.meta.url), 'utf8');
const policy = readFileSync(new URL('../renderer/src/agent/core/policyEngine.ts', import.meta.url), 'utf8');
const panel = readFileSync(new URL('../renderer/src/app/copilot/CopilotPanel.tsx', import.meta.url), 'utf8');
test('Agent 节点运行能力只由用户设置和权限策略控制', () => {
  assert.match(settingsStore, /agentCanRunNodes:\s*false/);
  assert.match(runtime, /nodeExecution:\s*settingsStore\.agentCanRunNodes === true/);
  assert.match(canvasTools, /context\.capabilities\.nodeExecution/);
  assert.match(canvasTools, /id: 'canvas_start_generation'[\s\S]*?effect: 'media_generation'/);
  assert.match(canvasTools, /isAvailable: \(context\) => context\.capabilities\.nodeExecution && settingsStore\.agentCanRunNodes === true/);
  assert.match(policy, /effect === 'media_generation'[\s\S]*return 'allow'/);
  assert.doesNotMatch(canvasTools, /productionPlan\.executionMode|已通过执行计划审核|activeProductionPlanId/);
});
test('输入器不再暴露内部执行模式', () => {
  assert.doesNotMatch(panel, /copilot-mode-switch/);
  assert.doesNotMatch(panel, />协作<\/button>|>自主<\/button>/);
  assert.match(settings, /允许 Agent 运行节点/);
  assert.doesNotMatch(settings, /助手步骤确认|自动执行生成/);
});
