import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const loopRunner = readFileSync(new URL('../renderer/src/agent/loop/runLoopAgent.ts', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../renderer/src/app/views/SettingsPanel.tsx', import.meta.url), 'utf8');
const settingsStore = readFileSync(new URL('../renderer/src/store/settingsStore.js', import.meta.url), 'utf8');
const canvasTools = readFileSync(new URL('../renderer/src/agent/tools/canvasTools.ts', import.meta.url), 'utf8');
const policy = readFileSync(new URL('../renderer/src/agent/core/policyEngine.ts', import.meta.url), 'utf8');
const composer = readFileSync(new URL('../renderer/src/app/agent-chat/Composer.tsx', import.meta.url), 'utf8');
test('Agent 节点运行能力只由用户设置和权限策略控制', () => {
  assert.match(settingsStore, /agentCanRunNodes:\s*false/);
  assert.match(loopRunner, /nodeExecution:\s*settingsStore\.agentCanRunNodes === true/);
  assert.match(canvasTools, /context\.capabilities\.nodeExecution/);
  assert.match(canvasTools, /id: 'canvas_start_generation'[\s\S]*?effect: 'media_generation'/);
  assert.match(canvasTools, /isAvailable: \(context\) => context\.capabilities\.nodeExecution && settingsStore\.agentCanRunNodes === true/);
  assert.match(policy, /projectChangingEffects\.has\(effect\)/);
  assert.match(policy, /effect === 'media_generation'[\s\S]*return 'deny'/);
  assert.doesNotMatch(canvasTools, /productionPlan\.executionMode|已通过执行计划审核|activeProductionPlanId/);
});
test('输入器只暴露用户审批偏好，不暴露内部执行模式', () => {
  // 询问/自动写的是 agentShellApproval，这是用户设置；执行计划模式属于运行时。
  assert.match(composer, /settingsStore\.agentShellApproval === "ask" \? "ask" : "full"/);
  assert.match(composer, /saveAppSettings\(\{ agentShellApproval: "(ask|full)" \}\)/);
  assert.doesNotMatch(composer, />协作<\/button>|>自主<\/button>|executionMode=\{|plan_review/);
  assert.match(settings, /允许 Agent 运行节点/);
  assert.doesNotMatch(settings, /助手步骤确认|自动执行生成/);
});
