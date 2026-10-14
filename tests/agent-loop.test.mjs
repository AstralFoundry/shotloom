/**
 * 行为测试：用脚本化的模型响应真实驱动自研 Agent loop。
 *
 * 断言的是"模型每步实际看见哪些工具、工具是否真的执行、事件与历史是否一致"，
 * 不检查源码文本。权限、可见性和历史完整性属于必须失败的边界。
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const storage = new Map();
let server;
let runAgentLoop;
let transcript;
let registry;
let interactions;
let skillsStore;
let settingsStore;
let projectIdentity;
let agentIndex;
let catalog;
let originalShellApproval;

before(async () => {
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
    clear: () => storage.clear(),
  };
  globalThis.window = {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (id) => clearInterval(id),
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  const rendererRoot = fileURLToPath(new URL('../renderer', import.meta.url));
  server = await createServer({
    configFile: false,
    root: rendererRoot,
    resolve: { alias: { '@': path.join(rendererRoot, 'src') } },
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  });
  ({ runAgentLoop } = await server.ssrLoadModule('/src/agent/loop/agentLoop.ts'));
  transcript = await server.ssrLoadModule('/src/agent/loop/transcript.ts');
  registry = await server.ssrLoadModule('/src/agent/core/toolRegistry.ts');
  interactions = await server.ssrLoadModule('/src/agent/runtime/runtimeInteractions.ts');
  skillsStore = await server.ssrLoadModule('/src/store/skillsStore.js');
  settingsStore = await server.ssrLoadModule('/src/store/settingsStore.js');
  projectIdentity = await server.ssrLoadModule('/src/services/agentProjectIdentity.ts');
  agentIndex = await server.ssrLoadModule('/src/agent/index.ts');
  catalog = await server.ssrLoadModule('/src/domain/catalog/ModelCatalog.ts');
  originalShellApproval = settingsStore.settingsStore.agentShellApproval;
});

after(async () => {
  await server?.close();
  delete globalThis.localStorage;
  delete globalThis.window;
});

const PLAN = {
  model: 'gpt-agent', upstreamModel: 'upstream-gpt-agent', providerId: 'shotloom',
  endpointPath: '/v1/chat/completions', endpointScope: 'v1', endpointMethod: 'POST',
  headers: { 'x-marker': 'loop' }, auth: { type: 'bearer' },
  requestOptions: { temperature: 0.3 },
  contextLimit: 4_000, outputLimit: 400, timeoutMs: 300_000,
};

function makeContext(agentId = 'canvas-primary', overrides = {}) {
  const identity = projectIdentity.getAgentProjectIdentity();
  const requestId = `run-${Math.random().toString(36).slice(2, 8)}`;
  return {
    requestId,
    turnId: `${requestId}:root`,
    agentSessionId: requestId,
    projectKey: identity.projectKey,
    projectInstanceId: identity.instanceId,
    projectGeneration: identity.generation,
    conversationId: 'conversation-1',
    agentId,
    signal: new AbortController().signal,
    loadedSkillIds: new Set(),
    attachments: [],
    capabilities: { nodeExecution: true },
    state: new Map(),
    emit: () => {},
    ...overrides,
  };
}

function defineTool(id, extra = {}) {
  registry.registerAgentTool({
    id, title: id, description: '测试工具', effect: 'read',
    inputSchema: {
      type: 'object',
      properties: { scope: { type: 'string' }, name: { type: 'string' } },
      additionalProperties: false,
    },
    execute: () => ({ success: true }),
    ...extra,
  });
}

/** 按脚本逐步返回模型响应，并记录每次真实发出的请求体。 */
function scriptedModel(steps) {
  const requests = [];
  let index = 0;
  const callModel = async (body, onTextDelta) => {
    requests.push(structuredClone(body));
    const step = steps[index];
    index += 1;
    if (!step) throw new Error(`脚本只有 ${steps.length} 步，模型却发起了第 ${index} 次请求`);
    if (step.error) throw step.error;
    for (const delta of step.deltas || []) onTextDelta(delta);
    const toolCalls = (step.toolCalls || []).map((call, position) => ({
      id: call.id || `call-${index}-${position}`,
      type: 'function',
      function: { name: call.name, arguments: JSON.stringify(call.args || {}) },
    }));
    return {
      text: step.text || '',
      toolCalls,
      finishReason: step.finishReason || (toolCalls.length ? 'tool_calls' : 'stop'),
      usage: step.usage,
    };
  };
  return { callModel, requests };
}

function toolNames(body) {
  return (body.tools || []).map((tool) => tool.function.name);
}

function toolContent(messages, toolCallId) {
  const message = messages.find((item) => item.role === 'tool' && item.tool_call_id === toolCallId);
  return message ? JSON.parse(message.content) : undefined;
}

function run(input) {
  // 真实运行时里 input.emit 与 context.emit 是同一个出口（见 runLoopAgent），
  // 测试也必须把两者接到同一个收集器上，否则工具管道的事件就丢了。
  const emit = input.emit || (() => {});
  return runAgentLoop({ plan: PLAN, systemPrompt: 'SYSTEM', messages: [], ...input, context: { ...input.context, emit } });
}

test('模型只看见本 Agent 白名单内的工具，无工具调用才结束本轮', async () => {
  registry.clearAgentToolsForTests();
  const executed = [];
  defineTool('canvas_list_nodes', { execute: (input) => { executed.push(input); return { success: true, nodeIds: ['n1'] }; } });
  defineTool('canvas_create_node', { effect: 'canvas_write', execute: () => ({ success: true, nodeId: 'n2' }) });
  defineTool('tool_no_agent_grants_it', { execute: () => ({ success: true }) });

  const context = makeContext();
  const script = scriptedModel([
    { deltas: ['正在查看'], toolCalls: [{ id: 'call-1', name: 'canvas_list_nodes', args: { scope: 'all' } }] },
    { text: '画布上有 1 个节点' },
  ]);
  const events = [];
  const result = await run({
    context,
    callModel: script.callModel,
    emit: (event) => events.push(event),
    messages: [{ role: 'user', content: '看看画布' }],
  });

  assert.equal(result.reply, '画布上有 1 个节点');
  assert.equal(result.modelRounds, 2);
  assert.deepEqual(executed, [{ scope: 'all' }], '工具必须用模型给的参数真实执行一次');

  const firstNames = toolNames(script.requests[0]);
  assert.ok(firstNames.includes('canvas_list_nodes'));
  assert.ok(firstNames.includes('canvas_create_node'), '白名单内的写工具仍会进入请求，权限在执行时把关');
  assert.ok(!firstNames.includes('tool_no_agent_grants_it'), '未授予的工具不得出现在模型请求里');
  assert.equal(script.requests[0].model, PLAN.upstreamModel);
  assert.equal(script.requests[0].__endpointPath, PLAN.endpointPath);
  assert.equal(script.requests[0].temperature, 0.3, '目录声明的 requestOptions 必须原样送出');

  assert.deepEqual(result.messages.map((message) => message.role), ['user', 'assistant', 'tool', 'assistant']);
  assert.equal(toolContent(result.messages, 'call-1').nodeIds[0], 'n1');
  assert.equal(toolContent(result.messages, 'call-1').toolCallId, 'call-1', '模型必须拿到可复述的 toolCallId');
  assert.notEqual(context.state.get('hasAppliedActions'), true, '只读工具不构成项目改动');

  const types = events.map((event) => event.type);
  assert.deepEqual(types.filter((type) => type === 'turn_start').length, 2);
  assert.ok(types.includes('tool_start') && types.includes('tool_end'));
  assert.ok(types.indexOf('turn_start') < types.indexOf('tool_start'), '工具事件在模型给出调用之后');
  assert.ok(types.indexOf('tool_start') < types.indexOf('tool_end'));
  assert.ok(types.indexOf('tool_end') < types.lastIndexOf('turn_start'), '工具结果回写后才有下一轮');
});

test('工具失败作为结果回到模型，不终止本轮运行', async () => {
  registry.clearAgentToolsForTests();
  defineTool('canvas_list_nodes', { execute: () => ({ success: false, error: '目标节点不存在' }) });
  const context = makeContext();
  const script = scriptedModel([
    { toolCalls: [{ id: 'call-1', name: 'canvas_list_nodes' }] },
    { text: '我改用列表重新定位' },
  ]);
  const events = [];
  const result = await run({ context, callModel: script.callModel, emit: (event) => events.push(event), messages: [{ role: 'user', content: '查看节点' }] });

  assert.equal(toolContent(result.messages, 'call-1').success, false);
  assert.equal(result.reply, '我改用列表重新定位');
  const end = events.find((event) => event.type === 'tool_end');
  assert.equal(end.isError, true);
  assert.equal(context.state.get('lastActionError'), '目标节点不存在');
});

test('Skill 命名空间工具只有在真正加载后才进入下一次请求', async () => {
  registry.clearAgentToolsForTests();
  defineTool('canvas_list_nodes');
  defineTool('skill_short_drama__inspect_structure');
  skillsStore.skillsStore.skills = [
    { id: 'short-drama', name: '短剧制作', description: '分镜方法', instructions: '先建立人物动机。', enabled: true },
    { id: 'other-skill', name: '未使用', description: '另一个方法', instructions: '不该被加载。', enabled: true },
  ];
  try {
    const context = makeContext();
    const script = scriptedModel([
      { toolCalls: [{ id: 'call-skill', name: 'skill', args: { name: 'short-drama' } }] },
      { toolCalls: [{ id: 'call-namespaced', name: 'skill_short_drama__inspect_structure' }] },
      { text: '按短剧方法完成' },
    ]);
    const events = [];
    const result = await run({ context, callModel: script.callModel, emit: (event) => events.push(event), messages: [{ role: 'user', content: '做短剧' }] });

    assert.ok(!toolNames(script.requests[0]).includes('skill_short_drama__inspect_structure'), '未加载 Skill 时命名空间工具不可见');
    assert.ok(toolNames(script.requests[0]).includes('skill'), '有授予 Skill 才会有 skill 工具');
    assert.ok(toolNames(script.requests[1]).includes('skill_short_drama__inspect_structure'), '加载后下一步就该可见');
    assert.match(JSON.parse(result.messages.find((message) => message.role === 'tool' && message.tool_call_id === 'call-skill').content).content, /先建立人物动机/);
    assert.equal(toolContent(result.messages, 'call-namespaced').success, true);
    const skillEvent = events.find((event) => event.type === 'skill_used');
    assert.equal(skillEvent.skillId, 'short-drama');
    assert.equal(skillEvent.source, 'user');
    assert.equal(context.state.get('activeSkillId'), 'short-drama');
  } finally {
    skillsStore.skillsStore.skills = [];
    registry.clearAgentToolsForTests();
  }
});

test('未授予的 Skill 对模型不可见，加载请求直接失败回执', async () => {
  registry.clearAgentToolsForTests();
  skillsStore.skillsStore.skills = [{ id: 'granted', name: '已授予', description: '用途', instructions: '内容', enabled: true }];
  try {
    const context = makeContext();
    const script = scriptedModel([
      { toolCalls: [{ id: 'call-skill', name: 'skill', args: { name: 'not-granted' } }] },
      { text: '换用可用方法' },
    ]);
    const result = await run({ context, callModel: script.callModel, emit: () => {}, messages: [{ role: 'user', content: '加载别的技能' }] });
    const receipt = JSON.parse(result.messages.find((message) => message.tool_call_id === 'call-skill').content);
    assert.equal(receipt.success, false);
    assert.match(receipt.error, /不在本 Agent 可用列表/);
    assert.equal([...context.loadedSkillIds].length, 0, '失败的加载不得污染可见集');
  } finally {
    skillsStore.skillsStore.skills = [];
  }
});

test('“询问”模式下写工具先请求确认，批准后才真正执行', async () => {
  registry.clearAgentToolsForTests();
  settingsStore.settingsStore.agentShellApproval = 'ask';
  let executed = 0;
  defineTool('canvas_create_node', { effect: 'canvas_write', execute: () => { executed += 1; return { success: true, nodeIds: ['n1'] }; } });
  const context = makeContext();
  const script = scriptedModel([
    { toolCalls: [{ id: 'call-write', name: 'canvas_create_node' }] },
    { text: '节点已按你的确认创建' },
  ]);
  const events = [];
  const approvalHandler = (event) => {
    if (event.type !== 'interaction_requested') return;
    // 等待方在 emit 之后才注册，所以这里排到下一个宏任务再批准。
    setTimeout(() => interactions.submitAgentApproval(event.requestId || context.requestId, event.stepId, { approved: true }), 0);
  };
  try {
    const result = await run({
      context,
      callModel: script.callModel,
      emit: (event) => { events.push(event); approvalHandler(event); },
      messages: [{ role: 'user', content: '建一个节点' }],
    });
    assert.equal(executed, 1, '批准后必须真实执行一次');
    assert.equal(result.reply, '节点已按你的确认创建');
    const requested = events.find((event) => event.type === 'interaction_requested');
    assert.equal(requested.kind, 'tool_confirmation');
    assert.equal(requested.toolName, 'canvas_create_node');
    assert.equal(events.find((event) => event.type === 'interaction_resolved').approved, true);
    assert.equal(toolContent(result.messages, 'call-write').nodeIds[0], 'n1');
    assert.equal(context.state.get('hasAppliedActions'), true, '只有真实 nodeIds 回执才算画布改动');
  } finally {
    settingsStore.settingsStore.agentShellApproval = originalShellApproval;
    registry.clearAgentToolsForTests();
  }
});

test('用户拒绝确认后不执行，拒绝原因作为工具结果返回', async () => {
  registry.clearAgentToolsForTests();
  settingsStore.settingsStore.agentShellApproval = 'ask';
  let executed = 0;
  defineTool('canvas_delete_node', { effect: 'canvas_write', execute: () => { executed += 1; return { success: true }; } });
  const context = makeContext();
  const script = scriptedModel([
    { toolCalls: [{ id: 'call-delete', name: 'canvas_delete_node' }] },
    { text: '已停止删除，改用其他方式' },
  ]);
  const events = [];
  try {
    const result = await run({
      context,
      callModel: script.callModel,
      emit: (event) => {
        events.push(event);
        if (event.type === 'interaction_requested') {
          setTimeout(() => interactions.submitAgentApproval(context.requestId, event.stepId, { approved: false, error: '用户拒绝了删除' }), 0);
        }
      },
      messages: [{ role: 'user', content: '删掉这个节点' }],
    });
    assert.equal(executed, 0, '拒绝后不得执行');
    assert.match(toolContent(result.messages, 'call-delete').error, /用户拒绝了删除/);
    assert.equal(result.reply, '已停止删除，改用其他方式');
  } finally {
    settingsStore.settingsStore.agentShellApproval = originalShellApproval;
    registry.clearAgentToolsForTests();
  }
});

test('子 Agent 只使用自己定义里的工具，不继承父 Agent 的画布写权限', async () => {
  registry.clearAgentToolsForTests();
  defineTool('canvas_list_nodes');
  defineTool('canvas_create_node', { effect: 'canvas_write', execute: () => ({ success: true, nodeId: 'n1' }) });
  defineTool('plan_write', { effect: 'project_write', execute: () => ({ success: true, planId: 'p1' }) });
  skillsStore.skillsStore.skills = [{ id: 'short-drama', name: '短剧制作', description: '分镜方法', instructions: '方法', enabled: true }];
  try {
    const context = makeContext();
    const script = scriptedModel([
      { toolCalls: [{ id: 'call-dispatch', name: 'dispatch_subagent', args: { agentId: 'production-planner', task: '规划三个镜头' } }] },
      { text: '规划完成：三个镜头' },
      { text: '已把规划结果同步给你' },
    ]);
    const events = [];
    const result = await run({ context, callModel: script.callModel, emit: (event) => events.push(event), messages: [{ role: 'user', content: '先规划' }] });

    const parentNames = toolNames(script.requests[0]);
    assert.ok(parentNames.includes('canvas_create_node'));
    assert.ok(parentNames.includes('dispatch_subagent'));
    assert.ok(parentNames.includes('skill'));

    const childNames = toolNames(script.requests[1]);
    assert.ok(childNames.includes('plan_write'), '子 Agent 用自己的白名单');
    assert.ok(!childNames.includes('canvas_create_node'), '规划子 Agent 没有画布写权限');
    assert.ok(!childNames.includes('dispatch_subagent'), '子 Agent 不得再派子 Agent');
    assert.ok(!childNames.includes('skill'), '未授予 Skill 的子 Agent 没有 skill 工具');
    assert.match(script.requests[1].messages[0].content, /Author a Production Plan/, '子 Agent 收到自己的职责说明');
    assert.equal(script.requests[1].messages[1].content, '规划三个镜头');

    assert.equal(toolContent(result.messages, 'call-dispatch').summary, '规划完成：三个镜头');
    assert.ok(events.some((event) => event.type === 'subagent_started'));
    const completed = events.find((event) => event.type === 'subagent_completed');
    assert.ok(completed.childSessionId.startsWith(`${context.requestId}:sub:production-planner:`));
    assert.equal(result.reply, '已把规划结果同步给你');
  } finally {
    skillsStore.skillsStore.skills = [];
    registry.clearAgentToolsForTests();
  }
});

test('子 Agent 失败把错误返回给父级，而不是终止整轮', async () => {
  registry.clearAgentToolsForTests();
  defineTool('canvas_list_nodes');
  const context = makeContext();
  const script = scriptedModel([
    { toolCalls: [{ id: 'call-dispatch', name: 'dispatch_subagent', args: { agentId: 'result-reviewer', task: '核验结果' } }] },
    { error: new Error('模型不可用') },
    { text: '我自己用只读工具核验' },
  ]);
  const events = [];
  const result = await run({ context, callModel: script.callModel, emit: (event) => events.push(event), messages: [{ role: 'user', content: '核验' }] });
  const receipt = toolContent(result.messages, 'call-dispatch');
  assert.equal(receipt.success, false);
  assert.match(receipt.error, /模型不可用/);
  assert.equal(events.find((event) => event.type === 'subagent_failed').error.includes('模型不可用'), true);
  assert.equal(result.reply, '我自己用只读工具核验');
});

test('每条事件都标明执行者：子 Agent 的回执不会算到父级身份上', async () => {
  registry.clearAgentToolsForTests();
  defineTool('canvas_list_nodes');
  const context = makeContext();
  const script = scriptedModel([
    { toolCalls: [{ id: 'call-dispatch', name: 'dispatch_subagent', args: { agentId: 'production-planner', task: '列出节点' } }] },
    { toolCalls: [{ id: 'call-child', name: 'canvas_list_nodes' }] },
    { text: '子结论：1 个节点' },
    { text: '已合并子结论' },
  ]);
  const events = [];
  const result = await run({ context, callModel: script.callModel, emit: (event) => events.push(event), messages: [{ role: 'user', content: '先派给规划 Agent' }] });

  const started = events.find((event) => event.type === 'subagent_started');
  assert.equal(started.childAgentId, 'production-planner', '被派发的 Agent 用 childAgentId 表示');
  assert.equal(started.agentId, 'canvas-primary', '发出这条事件的那一轮仍是父级');
  assert.equal(started.agentSessionId, context.requestId);
  // 界面要分开显示"谁在执行"和"在做什么"，所以任务原文与结论各自成字段，
  // 不能让展示层从拼接后的标题里反推。
  assert.equal(started.task, '列出节点');

  const childCompleted = events.find((event) => event.type === 'subagent_completed');
  assert.equal(childCompleted.summary, '子结论：1 个节点', '子 Agent 的结论要能被界面直接显示');

  const childToolEnd = events.filter((event) => event.type === 'tool_end' && event.toolCallId === 'call-child')[0];
  assert.equal(childToolEnd.agentId, 'production-planner', '子 Agent 执行的回执归属子 Agent');
  assert.equal(childToolEnd.agentSessionId, started.childSessionId, '事件里的会话标识要与派发时生成的子会话一致');

  const parentTurns = events.filter((event) => event.type === 'turn_start' && event.agentId === 'canvas-primary');
  const childTurns = events.filter((event) => event.type === 'turn_start' && event.agentId === 'production-planner');
  assert.equal(parentTurns.length, 2, '父级在派发前后各发起一次请求');
  assert.equal(childTurns.length, 2, '子 Agent 自己的循环也逐步上报');
  assert.ok(parentTurns.every((event) => event.agentSessionId === context.requestId));
  assert.ok(childTurns.every((event) => event.agentSessionId === started.childSessionId));
  assert.ok(events.every((event) => event.agentId && event.agentSessionId), '不得有无身份的事件落入事件日志');

  assert.equal(toolContent(result.messages, 'call-dispatch').summary, '子结论：1 个节点');
  assert.equal(result.reply, '已合并子结论');
});

test('超出步数上限时明确失败，不返回空回复', async () => {
  registry.clearAgentToolsForTests();
  defineTool('canvas_list_nodes');
  const context = makeContext();
  const script = scriptedModel([
    { toolCalls: [{ id: 'a', name: 'canvas_list_nodes' }] },
    { toolCalls: [{ id: 'b', name: 'canvas_list_nodes' }] },
  ]);
  await assert.rejects(
    run({ context, callModel: script.callModel, emit: () => {}, maxSteps: 2, messages: [{ role: 'user', content: '继续' }] }),
    /达到 2 步上限/,
  );
});

test('模型返回空响应或本轮被截断时都作为失败上报', async () => {
  registry.clearAgentToolsForTests();
  const context = makeContext();
  await assert.rejects(
    run({ context, callModel: scriptedModel([{ text: '   ' }]).callModel, emit: () => {}, messages: [{ role: 'user', content: '说点什么' }] }),
    /0 token 空响应/,
  );
  defineTool('canvas_list_nodes');
  await assert.rejects(
    run({
      context,
      callModel: scriptedModel([{ text: '我还没写完', toolCalls: [], finishReason: 'length' }]).callModel,
      emit: () => {},
      messages: [{ role: 'user', content: '继续' }],
    }),
    /输出上限/,
  );
});

test('上下文超预算时整组丢弃旧对话，并且只上报一次压缩事件', async () => {
  registry.clearAgentToolsForTests();
  const filler = 'x'.repeat(6_000);
  const history = [
    { role: 'user', content: `很早以前的问题 ${filler}` },
    { role: 'assistant', content: `很早以前的回答 ${filler}` },
    { role: 'user', content: '刚才的话题' },
    { role: 'assistant', content: '刚才的回复' },
    { role: 'user', content: '最新问题' },
  ];
  const script = scriptedModel([{ text: '只看到近期历史' }]);
  const events = [];
  let persisted = null;
  const result = await run({
    context: makeContext(),
    plan: { ...PLAN, contextLimit: 1_500, outputLimit: 100 },
    callModel: script.callModel,
    emit: (event) => events.push(event),
    onMessagesChanged: (messages) => { persisted = [...messages]; },
    messages: history,
  });
  const sent = script.requests[0].messages.slice(1);
  assert.ok(!JSON.stringify(sent).includes(filler), '超预算的旧分组不得再送给模型');
  assert.ok(persisted && !JSON.stringify(persisted).includes(filler), '落盘的历史必须收敛到模型真正看到的窗口');
  assert.equal(sent[0].role, 'user');
  assert.equal(sent[sent.length - 1].content, '最新问题');
  assert.equal(events.filter((event) => event.type === 'context_compaction').length, 1);
  assert.equal(events.find((event) => event.type === 'context_compaction').droppedGroups, 2);
  assert.ok(events.find((event) => event.type === 'context_usage').inputBudget > 0);
  assert.equal(result.reply, '只看到近期历史');
});

test('历史裁剪保持分组完整，中断历史会被补齐应答', () => {
  const withTools = [
    { role: 'user', content: '第一问' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'canvas_list_nodes', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'c1', content: '第一答的工具结果' },
    { role: 'user', content: '第二问' },
  ];
  const window = transcript.fitTranscript(withTools, 1);
  assert.equal(window.droppedGroups, 2, '从最旧分组开始丢，但永远保留最后一组');
  assert.equal(window.messages[0].role, 'user');
  assert.ok(!window.messages.some((message) => message.role === 'tool'));

  const dangling = [
    withTools[0],
    { role: 'assistant', content: null, tool_calls: [
      { id: 'c1', type: 'function', function: { name: 'canvas_list_nodes', arguments: '{}' } },
      { id: 'c2', type: 'function', function: { name: 'canvas_get_node', arguments: '{}' } },
    ] },
    { role: 'tool', tool_call_id: 'c1', content: '{"success":true}' },
  ];
  const closed = transcript.closeDanglingToolCalls(dangling, '未执行');
  assert.deepEqual(closed.map((message) => message.role), ['user', 'assistant', 'tool', 'tool'], '占位结果紧跟在未应答的 assistant 分组后');
  assert.deepEqual([...new Set(closed.filter((message) => message.role === 'tool').map((message) => message.tool_call_id))].sort(), ['c1', 'c2'], '每个调用都必须有应答');
  assert.equal(closed.find((message) => message.tool_call_id === 'c2').content, '未执行');
  assert.deepEqual(transcript.closeDanglingToolCalls(closed, '未执行'), closed, '补齐是幂等的');

  const truncated = transcript.truncateToolResult('y'.repeat(20_500));
  assert.match(truncated, /已截断/, '截断必须告知模型');
});

test('引擎按模型目录声明的协议选择，协议不符时显式退回', () => {
  const loopIds = [];
  const sidecarIds = [];
  for (const model of catalog.getBuiltInCatalogModels()) {
    if (!catalog.resolveModelRuntimeContract('textGeneration', model.id, [])) continue;
    (agentIndex.selectAgentEngine(model.id) === 'loop' ? loopIds : sidecarIds).push(model.id);
  }
  assert.ok(loopIds.length, '目录里必须有可由自研 loop 驱动的 Chat Completions 模型');
  assert.ok(sidecarIds.length, '目录里声明了非 Chat Completions 协议的模型必须退回原引擎');

  storage.set('SHOTLOOM_AGENT_ENGINE', 'opencode');
  assert.equal(agentIndex.selectAgentEngine(loopIds[0]), 'opencode', '双轨回归期间可以强制指定引擎');
  storage.set('SHOTLOOM_AGENT_ENGINE', 'loop');
  assert.equal(agentIndex.selectAgentEngine(sidecarIds[0]), 'loop');
  storage.delete('SHOTLOOM_AGENT_ENGINE');
});
