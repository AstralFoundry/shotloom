import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const runtime = readFileSync(new URL('../renderer/src/agent/runtime/OpenCodeRuntime.ts', import.meta.url), 'utf8');
const lifecycle = readFileSync(new URL('../renderer/src/agent/tools/lifecycleTools.ts', import.meta.url), 'utf8');
const governance = readFileSync(new URL('../renderer/src/agent/content/contracts/production-governance.md', import.meta.url), 'utf8');

test('制作范围由 Router 理解完整语义，不由运行时代码预分类', () => {
  assert.doesNotMatch(runtime, /decideProductionRequest|productionScopeAmbiguous|requiresProductionPlan/);
  assert.doesNotMatch(runtime, /productionIntent|productionSourceUnitCount/);
  assert.match(runtime, /Router decides production scope from the full user message/);
  assert.match(governance, /不得依赖关键词、正则或代码预分类/);
});

test('澄清工具不写死制作范围的问题与选项', () => {
  assert.doesNotMatch(lifecycle, /PRODUCTION_SCOPE_QUESTION_ID|productionScopeOptions/);
  assert.doesNotMatch(lifecycle, /规划完整画布，不执行节点|规划完整画布并分阶段执行/);
  assert.match(lifecycle, /questions,/);
});
