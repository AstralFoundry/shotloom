import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const tools = readFileSync(new URL('../renderer/src/agent/tools/productionPlanTools.ts', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../renderer/src/agent/runtime/OpenCodeRuntime.ts', import.meta.url), 'utf8');
const canvas = readFileSync(new URL('../renderer/src/agent/tools/canvasTools.ts', import.meta.url), 'utf8');
const store = readFileSync(new URL('../renderer/src/store/projectStore.js', import.meta.url), 'utf8');
const planStore = readFileSync(new URL('../renderer/src/agent/runtime/productionPlanStore.ts', import.meta.url), 'utf8');
const lifecycle = readFileSync(new URL('../renderer/src/agent/tools/lifecycleTools.ts', import.meta.url), 'utf8');
const catalog = readFileSync(new URL('../renderer/src/agent/tools/catalogTools.ts', import.meta.url), 'utf8');
const governance = readFileSync(new URL('../renderer/src/agent/content/contracts/production-governance.md', import.meta.url), 'utf8');

test('Production Plan 提供持久化阶段工具而不是临时文本计划', () => {
  for (const name of ['plan_write', 'plan_get_stage_status', 'plan_get_stage_detail', 'plan_patch_stage', 'plan_update_stage_state']) {
    assert.match(tools, new RegExp(`id: '${name}'`));
  }
  assert.match(store, /productionPlans: \[\]/);
  assert.match(store, /productionPlans: Array\.isArray\(project\?\.productionPlans\)[\s\S]*schemaVersion === 2/);
});

test('复杂制作是否建立计划由 Router 决定，工具只校验客观执行状态', () => {
  assert.doesNotMatch(runtime, /requiresProductionPlan|productionPlanPreparedForRun/);
  assert.doesNotMatch(canvas, /首次修改画布前必须先用 plan_write/);
  assert.doesNotMatch(canvas, /activeProductionPlanId|executionMode !== 'execute'|已通过执行计划审核/);
});

test('复杂制作范围由 Router 判断并按上下文提问', () => {
  assert.doesNotMatch(runtime, /productionScopeAmbiguous|productionIntent/);
  assert.match(catalog, /id: 'inspect_runtime_capabilities'/);
  assert.doesNotMatch(tools, /runtimeCapabilitiesInspected.*throw new Error/s);
  assert.match(governance, /Router.*request_clarification/);
  assert.doesNotMatch(lifecycle, /PRODUCTION_SCOPE_QUESTION_ID|productionScopeOptions|PLAN_CANVAS_OPTION/);
  assert.match(tools, /exists: false, plan: null/);
  assert.doesNotMatch(tools, /当前对话没有进行中的 Production Plan v2/);
  assert.doesNotMatch(tools, /requireResolvedProductionIntent/);
  assert.doesNotMatch(canvas, /requireResolvedProductionIntent/);
  assert.doesNotMatch(catalog, /isAvailable: \(\{ state \}\).*runtimeCapabilitiesInspected/);
});

test('Production Plan v2 用逐项 runtime ref 核验真实节点和任务', () => {
  assert.match(planStore, /schemaVersion: 2/);
  assert.match(planStore, /executionMode: ProductionExecutionMode/);
  assert.match(planStore, /runtimeRefs: ProductionPlanRuntimeRef\[\]/);
  assert.match(planStore, /authored: boolean/);
  assert.match(planStore, /warnings: string\[\]/);
  assert.match(planStore, /无效依赖 .* 已忽略/);
  assert.doesNotMatch(planStore, /源内容包含 .* 个时间段/);
  assert.doesNotMatch(planStore, /至少需要 .* 个视频工作项/);
  assert.doesNotMatch(planStore, /执行模式必须完整编写首个阶段/);
  assert.doesNotMatch(planStore, /阶段工作项尚未编排/);
  assert.doesNotMatch(planStore, /必须先编排下一阶段工作项/);
  assert.doesNotMatch(planStore, /plan_review|result_review|approve_plan|approve_result|前置制作阶段尚未完成/);
  assert.match(planStore, /工作项 .* 尚未绑定真实画布节点/);
  assert.match(planStore, /没有属于该节点的已完成任务/);
  assert.doesNotMatch(planStore, /sourceUnitCount|videoCount/);
  assert.doesNotMatch(planStore, /nodeIds: string\[\]/);
  assert.doesNotMatch(planStore, /taskIds: string\[\]/);
  assert.doesNotMatch(tools, /maxItems/);
  assert.doesNotMatch(canvas, /maxItems/);
  assert.doesNotMatch(lifecycle, /maxItems/);
});

test('OpenCode 文字流只接收 assistant 消息', () => {
  assert.match(runtime, /info\.role === 'assistant'/);
  assert.match(runtime, /assistantMessageIds\.has\(part\.messageID\)/);
});
