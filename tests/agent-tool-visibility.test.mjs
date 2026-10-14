import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  clearAgentToolsForTests,
  listAgentTools,
  prepareAgentToolCall,
  registerAgentTool,
} from '../renderer/src/agent/core/toolRegistry.ts';
import { AGENT_DEFINITIONS, agentDefinition } from '../renderer/src/agent/agents/definitions.ts';

function contextFor(agentId, overrides = {}) {
  return {
    requestId: 'test', turnId: 'turn', projectKey: 'project', conversationId: 'conversation',
    agentId,
    signal: new AbortController().signal,
    loadedSkillIds: new Set(), attachments: [],
    capabilities: { nodeExecution: true }, state: new Map(), emit: () => {},
    ...overrides,
  };
}

function define(id, extra = {}) {
  registerAgentTool({
    id, title: id, description: '测试工具', effect: 'read',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: () => ({ success: true }),
    ...extra,
  });
}

test('未列入白名单的新工具对所有 Agent 都不可见', () => {
  clearAgentToolsForTests();
  define('brand_new_capability');
  for (const agent of AGENT_DEFINITIONS) {
    assert.deepEqual(
      listAgentTools(contextFor(agent.id)).map((tool) => tool.id), [],
      `${agent.id} 不应看见未授予的工具`,
    );
  }
  assert.throws(
    () => prepareAgentToolCall('brand_new_capability', '{}', contextFor('canvas-primary')),
    /not visible to Agent canvas-primary/,
  );
  clearAgentToolsForTests();
});

test('剪辑 Agent 的工具集合只包含时间线与交互工具', () => {
  clearAgentToolsForTests();
  define('video_project_get');
  define('video_project_edit', { effect: 'project_write' });
  define('canvas_create_node', { effect: 'canvas_write' });
  define('request_clarification', { effect: 'agent_state_write' });
  assert.deepEqual(
    listAgentTools(contextFor('editor-primary')).map((tool) => tool.id).sort(),
    ['request_clarification', 'video_project_edit', 'video_project_get'],
  );
  clearAgentToolsForTests();
});

// 落盘摘要把完整输出交给 read_tool_output；哪个 Agent 缺了它，哪个 Agent 的历史就留下读不回来的省略。
// 循环没有步数预算：Agent 定义里再出现 maxSteps，说明旧的轮次上限被偷偷加回来了。
test('Agent 定义不再声明步数上限', () => {
  for (const agent of AGENT_DEFINITIONS) {
    assert.equal('maxSteps' in agent, false, `${agent.id} 不该再有步数上限`);
  }
});

test('每个 Agent 都能读回落盘的工具输出', () => {
  for (const agent of AGENT_DEFINITIONS) {
    assert.ok(agent.tools.includes('read_tool_output'), `${agent.id} 必须能读回落盘结果`);
    assert.ok(agent.effects.includes('read'), `${agent.id} 必须保留只读副作用`);
  }
  clearAgentToolsForTests();
  define('read_tool_output');
  for (const agent of AGENT_DEFINITIONS) {
    assert.ok(
      listAgentTools(contextFor(agent.id)).some((tool) => tool.id === 'read_tool_output'),
      `${agent.id} 必须在运行时真的看见 read_tool_output`,
    );
  }
  clearAgentToolsForTests();
});

test('副作用上限独立于工具白名单生效', () => {
  clearAgentToolsForTests();
  // result-reviewer 的白名单里有 canvas_list_nodes，但没有 canvas_create_node；
  // 这里直接验证 effects 这一层：即使把写工具塞进白名单，超出上限依旧不可见。
  const reviewer = agentDefinition('result-reviewer');
  assert.ok(!reviewer.effects.includes('canvas_write'));
  define('canvas_create_node', { effect: 'canvas_write' });
  define('canvas_list_nodes');
  const visible = listAgentTools(contextFor('result-reviewer')).map((tool) => tool.id);
  assert.deepEqual(visible, ['canvas_list_nodes']);
  assert.equal(reviewer.tools.includes('canvas_create_node'), false);
  clearAgentToolsForTests();
});

test('用户关闭节点执行后生成工具不进入模型请求', () => {
  clearAgentToolsForTests();
  define('canvas_start_generation', {
    effect: 'media_generation',
    isAvailable: (context) => context.capabilities.nodeExecution === true,
  });
  assert.deepEqual(
    listAgentTools(contextFor('canvas-primary')).map((tool) => tool.id),
    ['canvas_start_generation'],
  );
  assert.deepEqual(
    listAgentTools(contextFor('canvas-primary', { capabilities: { nodeExecution: false } })),
    [],
  );
  clearAgentToolsForTests();
});

test('未声明的 Agent 直接失败，不退回默认工具集', () => {
  clearAgentToolsForTests();
  define('canvas_list_nodes');
  assert.throws(() => listAgentTools(contextFor('ghost-agent')), /未知的 Agent/);
  assert.throws(() => agentDefinition(''), /未知的 Agent/);
  clearAgentToolsForTests();
});

test('只有主 Agent 声明的 dispatch 才会建立子 Agent profile', () => {
  // dispatch 是 Agent 之间的调用边界：未声明的子 Agent 既不出现在工具参数枚举里，也无法被执行。
  const planner = agentDefinition('canvas-primary');
  assert.deepEqual(agentDefinition('editor-primary').dispatch, []);
  assert.deepEqual(planner.dispatch, [
    'production-planner', 'stage-executor', 'result-reviewer',
  ]);
  for (const child of planner.dispatch) {
    assert.equal(agentDefinition(child).role, 'subagent', `${child} 必须声明为子 Agent 才可派发`);
  }
});

// 契约按 agent id 匹配，改名会静默丢掉整段约束，所以必须校验引用有效性。
test('契约的 appliesTo 只能引用已声明的 Agent', () => {
  const knownIds = new Set(AGENT_DEFINITIONS.map((agent) => agent.id));
  for (const file of ['safety-rules', 'anti-loop', 'production-governance']) {
    const source = readFileSync(
      new URL(`../renderer/src/agent/content/contracts/${file}.md`, import.meta.url),
      'utf8',
    );
    const appliesTo = /appliesTo: \[([^\]]*)\]/.exec(source)?.[1];
    assert.ok(appliesTo, `${file} 缺少 appliesTo`);
    for (const raw of appliesTo.split(',')) {
      const id = raw.trim().replace(/^['"]|['"]$/g, '');
      assert.ok(id === '*' || knownIds.has(id), `${file} 引用了未声明的 Agent：${id}`);
    }
  }
});

// fail-closed 的代价是漏写就静默失效：这里保证每个真实注册的工具都至少属于一个 Agent。
test('所有默认工具都至少被一个 Agent 白名单授予', () => {
  const files = ['canvasTools', 'catalogTools', 'lifecycleTools', 'productionPlanTools', 'videoEditorTools'];
  const registered = [];
  for (const file of files) {
    const source = readFileSync(new URL(`../renderer/src/agent/tools/${file}.ts`, import.meta.url), 'utf8');
    registered.push(...[...source.matchAll(/\bid: '([a-z_0-9]+)'/g)].map(([, id]) => id));
  }
  // Skill 命名空间工具由 registerSkillTool 加前缀，实际 id 与源码里的基础名不同。
  const scriptSource = readFileSync(
    new URL('../renderer/src/agent/tools/scriptTools.ts', import.meta.url), 'utf8',
  );
  const skillNamespace = /registerSkillTool<[^>]*>\('([^']+)'/.exec(scriptSource)?.[1] || '';
  registered.push(
    ...[...scriptSource.matchAll(/\bid: '([a-z_0-9]+)'/g)]
      .map(([, id]) => `skill_${skillNamespace.replace(/[^a-z0-9]/g, '_')}__${id}`),
  );

  const granted = new Set(AGENT_DEFINITIONS.flatMap((agent) => agent.tools));
  assert.deepEqual(registered.filter((id) => !granted.has(id)), [], '存在没有 Agent 可用的工具');
  const unknown = [...granted].filter((id) => !registered.includes(id));
  assert.deepEqual(unknown, [], 'Agent 白名单引用了不存在的工具');
  assert.ok(registered.length >= 35, `默认工具数量异常：${registered.length}`);
});
