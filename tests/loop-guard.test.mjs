import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LOOP_TRIP,
  LOOP_WINDOW,
  createLoopGuardState,
  forgetToolCall,
  inspectToolCall,
  loopGuardMessage,
  recordToolCall,
  toolCallFingerprint,
} from '../renderer/src/agent/runtime/loopGuard.ts';
import {
  describeArgumentChanges,
  userOverrideNote,
} from '../renderer/src/utils/toolArgumentDiff.mjs';

const contract = readFileSync(
  new URL('../renderer/src/agent/content/contracts/anti-loop.md', import.meta.url),
  'utf8',
);
const contractLoader = readFileSync(
  new URL('../renderer/src/agent/content/contractLoader.ts', import.meta.url),
  'utf8',
);
const bridge = readFileSync(
  new URL('../renderer/src/agent/runtime/OpenCodeToolBridge.ts', import.meta.url),
  'utf8',
);
const coordinator = readFileSync(
  new URL('../renderer/src/app/copilot/agentInteractionCoordinator.ts', import.meta.url),
  'utf8',
);
/** 模拟一次工具调用：命中则返回 trip，否则记录。 */
function call(state, toolName, input) {
  const fingerprint = toolCallFingerprint(toolName, input);
  const { trip, count } = inspectToolCall(state, fingerprint);
  if (!trip) recordToolCall(state, fingerprint);
  return { trip, count };
}

test('标点、空格与大小写差异不构成不同的调用', () => {
  const base = toolCallFingerprint('canvas_create_node', { title: '熊猫干饭时刻', prompt: 'a b' });
  assert.equal(
    toolCallFingerprint('canvas_create_node', { title: '熊猫干饭时刻。', prompt: 'A  B' }),
    base,
  );
  assert.equal(
    toolCallFingerprint('canvas_create_node', { title: '，熊猫、干饭 时刻！', prompt: 'ab' }),
    base,
  );
});

test('数值的微小抖动算同一次调用，实质差异算不同调用', () => {
  assert.equal(
    toolCallFingerprint('set_speed', { speed: 1.25 }),
    toolCallFingerprint('set_speed', { speed: 1.251 }),
  );
  assert.notEqual(
    toolCallFingerprint('set_speed', { speed: 1.25 }),
    toolCallFingerprint('set_speed', { speed: 2 }),
  );
});

test('指纹与键序无关，但与工具名和嵌套结构有关', () => {
  assert.equal(
    toolCallFingerprint('canvas_update_node', { a: 1, b: { c: 2, d: [3, 4] } }),
    toolCallFingerprint('canvas_update_node', { b: { d: [3, 4], c: 2 }, a: 1 }),
  );
  assert.notEqual(
    toolCallFingerprint('canvas_update_node', { a: 1 }),
    toolCallFingerprint('canvas_get_node', { a: 1 }),
  );
  assert.notEqual(
    toolCallFingerprint('canvas_update_node', { a: [1, 2] }),
    toolCallFingerprint('canvas_update_node', { a: [2, 1] }),
  );
});

test('同指纹在最近 5 次里第 3 次出现时触发拦截', () => {
  const state = createLoopGuardState();
  assert.equal(call(state, 'canvas_list_nodes', {}).trip, false);
  assert.equal(call(state, 'canvas_list_nodes', {}).trip, false);
  const third = call(state, 'canvas_list_nodes', {});
  assert.equal(third.trip, true);
  assert.equal(third.count, LOOP_TRIP);
  assert.equal(LOOP_TRIP, 3);
  assert.equal(LOOP_WINDOW, 5);
});

test('插入其它调用会把旧指纹挤出窗口', () => {
  const state = createLoopGuardState();
  call(state, 'canvas_list_nodes', {});
  call(state, 'canvas_list_nodes', {});
  // 中间插入 4 次不同调用，两次旧调用已经落在 5 次窗口之外。
  for (const name of ['a', 'b', 'c', 'd']) call(state, name, {});
  assert.equal(call(state, 'canvas_list_nodes', {}).count, 1);
});

test('实质不同的输入不会累积到同一个指纹', () => {
  const state = createLoopGuardState();
  assert.equal(call(state, 'canvas_create_node', { title: '镜头一' }).trip, false);
  assert.equal(call(state, 'canvas_create_node', { title: '镜头二' }).trip, false);
  assert.equal(call(state, 'canvas_create_node', { title: '镜头三' }).trip, false);
});

test('用户放行后清空该指纹历史，不再立刻追问', () => {
  const state = createLoopGuardState();
  const fingerprint = toolCallFingerprint('canvas_list_nodes', {});
  for (let index = 0; index < LOOP_TRIP - 1; index += 1) recordToolCall(state, fingerprint);
  assert.equal(inspectToolCall(state, fingerprint).trip, true);

  forgetToolCall(state, fingerprint);

  assert.equal(inspectToolCall(state, fingerprint).trip, false);
  assert.equal(inspectToolCall(state, fingerprint).count, 1);
});

test('拦截文案说明重复次数与窗口大小', () => {
  const message = loopGuardMessage('canvas_create_node', 3);
  assert.match(message, /canvas_create_node/);
  assert.match(message, /3 次/);
});

test('anti-loop 契约对所有角色生效并已注册进契约加载器', () => {
  assert.match(contract, /appliesTo: \['\*'\]/);
  assert.match(contractLoader, /import antiLoopRaw from '\.\/contracts\/anti-loop\.md\?raw'/);
  assert.match(contractLoader, /registerContractFromRaw\(antiLoopRaw\)/);
});

test('契约告诉模型的触发规则与 LoopGuard 常量一致', () => {
  // 契约是模型对"为什么被拦下"的唯一解释来源，常量改了文案必须一起改。
  assert.match(contract, new RegExp(`最近 ${LOOP_WINDOW} 次`));
  assert.match(contract, new RegExp(`出现 ${LOOP_TRIP} 次`));
  assert.match(loopGuardMessage('x', LOOP_TRIP), new RegExp(`最近 ${LOOP_WINDOW} 次`));
});

test('循环拦截发生在工具执行之前，并把拒绝交给既有回执流程', () => {
  const guardCall = bridge.indexOf('await reviewRepeatedToolCall(');
  const executeCall = bridge.indexOf('await prepared.definition.execute(guarded.input, context)');
  assert.ok(guardCall > 0 && executeCall > 0, '工具桥必须同时包含拦截与执行');
  assert.ok(guardCall < executeCall, '拦截必须先于工具执行');
  assert.match(bridge, /repeatedToolCall: true/);
  // 拒绝走普通失败结果，才能复用 toolReceipts / lastActionError / tool_end 的记账。
  assert.doesNotMatch(bridge, /guarded\.reject[\s\S]{0,200}throw /);
});

test('每种工具确认都声明自己的处理模式', () => {
  // decision 模式没有暂存步骤，走画布执行器会得到"确认步骤不存在"，必须显式区分。
  assert.match(bridge, /mode: 'decision'/, '循环拦截必须声明 decision 模式');
  assert.match(bridge, /mode: 'step'/, '画布暂存步骤确认必须声明 step 模式');
  assert.match(coordinator, /String\(interaction\.payload\.mode \|\| 'step'\) === 'decision'/);
  const decisionIndex = coordinator.indexOf("=== 'decision'");
  const approveIndex = coordinator.indexOf('await executeAgentApproveStep(');
  assert.ok(decisionIndex > 0 && approveIndex > 0, '确认协调器必须同时包含模式判定与画布执行');
  assert.ok(decisionIndex < approveIndex, 'decision 模式必须先于画布执行器判定');
});

test('用户改过的参数必须重新校验后执行，并回写说明', () => {
  assert.match(bridge, /prepareAgentToolCall\(toolName, JSON\.stringify\(modified\), context\)/);
  assert.match(bridge, /userOverrideNote/);
  assert.match(bridge, /pendingArgs: toolInput/);
  assert.match(coordinator, /modifiedArgs/);
  // 用户改了参数却不重新校验，就等于把注册表的 schema 校验绕过去了。
  const reprepareIndex = bridge.indexOf('prepareAgentToolCall(toolName, JSON.stringify(modified), context)');
  const executeIndex = bridge.indexOf('await prepared.definition.execute(guarded.input, context)');
  assert.ok(reprepareIndex > 0 && reprepareIndex !== executeIndex);
});

test('参数改动说明只描述变化的顶层字段', () => {
  const changes = describeArgumentChanges(
    { title: '旧标题', prompt: '未改动', speed: 1 },
    { title: '新标题', prompt: '未改动', extra: true },
  );
  assert.match(changes, /title：.*旧标题.*→.*新标题/);
  assert.match(changes, /extra：新增/);
  assert.match(changes, /speed：已移除/);
  assert.doesNotMatch(changes, /prompt/);
});

test('没有改动就不产生说明，长值只留短预览', () => {
  assert.equal(describeArgumentChanges({ a: 1 }, { a: 1 }), '');
  assert.equal(userOverrideNote(''), '');

  const changes = describeArgumentChanges(
    { prompt: 'x'.repeat(300) },
    { prompt: 'y'.repeat(300) },
  );
  assert.ok(changes.includes('…'), '长值必须截断');
  assert.ok(changes.length < 200, `说明过长：${changes.length}`);
});

test('改参数说明明确要求不要用原参数重试', () => {
  const note = userOverrideNote('title：旧 → 新');
  assert.match(note, /title：旧 → 新/);
  assert.match(note, /不要再用原参数重试/);
});
