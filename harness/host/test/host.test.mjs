import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { LlmAdapter, ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm';
import { openDatabase } from '../dist/db/connection.js';
import { HostCrud } from '../dist/crud/hostCrud.js';
import { createHost } from '../dist/createHost.js';
import { registerProductTools } from '../dist/productTools.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const options = dataRoot => ({ dataRoot, contentRoot: join(root, 'renderer/src/agent/content'), rulesPath: join(root, 'AGENTS.md') });
const binding = { projectKey: 'test-project', conversationId: 'test-conversation', agentId: 'canvas-primary' };
const route = { provider: 'test', model: 'scripted' };
function text(value) {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: value },
    { type: 'block-end', index: 0, block: { type: 'text', text: value } },
    { type: 'finish', reason: { kind: 'stop' } },
  ];
}
function call(name, args, id = name) {
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: ToolCallId(id), name, argumentsDelta: JSON.stringify(args) },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId(id), name, arguments: JSON.stringify(args) } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ];
}
class ScriptedAdapter extends LlmAdapter {
  requests = [];
  constructor(script) { super(); this.script = script; }
  async listModels(provider) { return [{ provider, id: 'scripted', name: 'Scripted verification model' }]; }
  async resolveModel(provider, model) { return { provider, id: model, name: model }; }
  async *stream(request) {
    this.requests.push(request);
    const entry = this.script.shift();
    assert.ok(entry, 'Unexpected extra model request');
    yield* typeof entry === 'function' ? entry(request) : entry;
  }
}
class SizedAdapter extends ScriptedAdapter {
  async resolveModel(provider, model) { return { provider, id: model, name: model, context: { contextWindow: 65536 }, defaultMaxTokens: 2048 }; }
}
async function send(agent, value) {
  agent.followup(createUserMessage({ content: [{ type: 'text', text: value }], source: { kind: 'user' } }));
  await agent.whenIdle();
}
async function fixture(t, extra = {}) {
  const dataRoot = await mkdtemp(join(tmpdir(), 'shotloom-host-'));
  const host = await createHost({ ...options(dataRoot), ...extra });
  t.after(async () => { await host.dispose(); await rm(dataRoot, { recursive: true, force: true }); });
  return { host, dataRoot };
}

test('official Host starts, scopes prompts and rejects unbound editor sessions', { timeout: 10000 }, async t => {
  const { host } = await fixture(t);
  for (const service of ['agentLoop', 'sessionPersistence', 'goals', 'planMode', 'approval', 'userQuestions', 'skills']) {
    assert.ok(host.ctx.get(service), service);
  }
  await assert.rejects(host.create({ ...binding, agentId: 'text-primary' }), /bound node/);
  const adapter = new ScriptedAdapter([text('ready')]);
  host.ctx.llm.registerAdapter(['test'], adapter);
  const { agent } = await host.create(binding, route);
  await send(agent, 'Read the project');
  const prompt = agent.session.snapshotEvents().find(e => e.type === 'system/message');
  assert.match(JSON.stringify(prompt), /Shotloom/);
  assert.match(JSON.stringify(prompt), /test-project/);
  assert.ok(adapter.requests[0].tools.some(tool => tool.name === 'ask_user_question'));
  assert.ok(adapter.requests[0].tools.some(tool => tool.name === 'exit_plan_mode'));
  const skills = await host.ctx.skills.list();
  assert.ok(skills.some(skill => skill.name === 'video-editing'));
});

test('director session binds without a node and can dispatch the editor agent', { timeout: 10000 }, async t => {
  const { host } = await fixture(t);
  const adapter = new ScriptedAdapter([text('ready')]);
  host.ctx.llm.registerAdapter(['test'], adapter);
  const { agent } = await host.create({ ...binding, agentId: 'director-primary', conversationId: 'director-conversation' }, route);
  await send(agent, 'Inspect the open 3D scene');
  assert.ok(adapter.requests[0].tools.some(tool => tool.name === 'delegate_editor'));
  assert.match(JSON.stringify(agent.session.snapshotEvents().find(e => e.type === 'system/message')), /3D 导演台 Agent/);
});

test('official statistics and token usage projections are available to the embedded header', { timeout: 10000 }, async t => {
  const { host } = await fixture(t);
  host.ctx.llm.registerAdapter(['test'], new ScriptedAdapter([[
    { type: 'usage', usage: { inputTokens: 123, outputTokens: 7, totalTokens: 130 } },
    ...text('verified'),
  ]]));
  const { agent } = await host.create(binding, route);
  await send(agent, 'verify usage');
  const snapshot = host.ctx.sessionProjections.snapshot(agent.session);
  assert.equal(snapshot.values.sessionStats.turns, 1);
  assert.equal(snapshot.values.sessionStats.steps, 1);
  assert.equal(snapshot.values.tokenUsage.uncachedInputTokens, 123);
  assert.equal(snapshot.values.tokenUsage.outputTokens, 7);
});

test('editor model receives supported OpenReel tools and guidance without absent backends', { timeout: 15000 }, async t => {
  const upstream = JSON.parse(await readFile(join(root, 'renderer/src/config/openreel-agent-tools.json'), 'utf8'));
  const policy = JSON.parse(await readFile(join(root, 'renderer/src/config/openreel-agent-policy.json'), 'utf8'));
  const native = upstream.filter(tool => !Object.hasOwn(policy.excludedTools, tool.name));
  const catalog = native.map(tool => ({ name: `openreel_${tool.name}`, description: tool.description,
    parameters: tool.inputSchema, roles: ['editor-primary'], effect: tool.readOnly ? 'read' : 'write',
    approvalRequired: tool.destructive || tool.expensive }));
  const { host } = await fixture(t, { registerTools(scope, bound) {
    registerProductTools(scope, bound, catalog, { url: 'http://127.0.0.1:1', token: 'isolated-no-dispatch' });
  } });
  const adapter = new ScriptedAdapter([call('skill', { name: 'openreel-native-editing' }), text('原生剪辑协议已加载')]);
  host.ctx.llm.registerAdapter(['test'], adapter);
  const { agent } = await host.create({ ...binding, agentId: 'editor-primary', nodeId: 'timeline' }, route);
  await send(agent, '使用原生剪辑技能');
  assert.equal(adapter.requests[0].tools.filter(tool => tool.name.startsWith('openreel_')).length, native.length);
  const messages = JSON.stringify(adapter.requests.at(-1));
  assert.match(messages, /OpenReel native editing reference/);
  assert.match(messages, /openreel_create_motion_composition/);
  assert.match(messages, /本 Skill 将 OpenReel 原生系统提示词/);
  assert.match(messages, /当前绑定节点/);
  for (const name of Object.keys(policy.excludedTools)) assert.ok(!messages.includes(name), name);
});

test('official manual compaction persists a summary and continues after a real Host restart', { timeout: 15000 }, async t => {
  const { host, dataRoot } = await fixture(t);
  const adapter = new SizedAdapter([text('第一轮完成'), text('第二轮完成'), text('项目代号霜叶，交付15秒广告，禁止付费生成。')]);
  host.ctx.llm.registerAdapter(['test'], adapter);
  const { agent, binding: bound } = await host.create(binding, route);
  await send(agent, '项目代号霜叶。' + '历史参考。'.repeat(1200));
  await send(agent, '交付15秒广告，禁止付费生成。');
  const result = await host.ctx.compaction.compactNow(agent, new AbortController().signal);
  assert.ok(result?.shadowedSeqs.length > 0);
  assert.equal(agent.session.snapshotEvents().filter(e => e.type === 'compaction/end').at(-1).data.error, undefined);
  await host.dispose();
  const restored = await createHost(options(dataRoot));
  t.after(() => restored.dispose());
  const next = new SizedAdapter([text('霜叶，15秒广告，不付费。')]);
  restored.ctx.llm.registerAdapter(['test'], next);
  const resumed = await restored.resume(bound.sessionId, route);
  await send(resumed.agent, '继续，告诉我项目代号。');
  assert.ok(resumed.agent.session.snapshotEvents().some(e => e.type === 'compaction/summary'));
  const request = JSON.stringify(next.requests[0].messages);
  assert.ok(request.includes('项目代号霜叶'));
  assert.ok(!request.includes('历史参考。'.repeat(100)));
});

test('official context overflow recovery compacts history and retries the model', { timeout: 15000 }, async t => {
  const { host } = await fixture(t);
  const adapter = new SizedAdapter([
    text('第一轮完成'), text('第二轮完成'),
    [{ type: 'finish', reason: { kind: 'error', failure: { message: 'isolated provider overflow', code: 'CONTEXT_WINDOW_EXCEEDED' } } }],
    text('霜叶项目，禁止生成，历史已归纳。'), text('压缩后继续成功'),
  ]);
  host.ctx.llm.registerAdapter(['test'], adapter);
  const { agent } = await host.create(binding, route);
  await send(agent, '项目代号霜叶。' + '历史资料。'.repeat(1200));
  await send(agent, '禁止付费生成。');
  await send(agent, '继续汇报');
  const events = agent.session.snapshotEvents();
  assert.ok(events.some(e => e.type === 'compaction/summary'));
  assert.equal(events.filter(e => e.type === 'turn/end').at(-1).data.reason.kind, 'completed');
  assert.equal(adapter.requests.length, 5);
});

test('official pressure listener summarizes automatically before the next model request', { timeout: 15000 }, async t => {
  const { host } = await fixture(t);
  class PressureAdapter extends SizedAdapter {
    async *stream(request) {
      this.requests.push(request);
      yield* text(request.purpose === 'compaction' ? '霜叶项目历史归纳，禁止付费生成。' : '事实已记录。');
    }
  }
  const adapter = new PressureAdapter([]);
  host.ctx.llm.registerAdapter(['test'], adapter);
  const { agent } = await host.create(binding, route);
  for (let i = 0; i < 4; i++) await send(agent, `资料 ${i}，项目代号霜叶，禁止付费生成。` + 'historical reference '.repeat(4500));
  assert.ok(adapter.requests.some(request => request.purpose === 'compaction'));
  assert.ok(agent.session.snapshotEvents().some(e => e.type === 'compaction/summary'));
  assert.equal(agent.session.snapshotEvents().filter(e => e.type === 'turn/end').at(-1).data.reason.kind, 'completed');
});

test('official tool pruner recovers a single oversized tool result before sending it to the model', { timeout: 15000 }, async t => {
  const original = 'head verified node real-node ' + 'large-receipt '.repeat(50000) + ' tail verified';
  const { host } = await fixture(t, { registerTools(scope) {
    scope.tools.register({ name: 'bulk_read', description: 'Read isolated large receipt', parameters: { type: 'object', properties: {} },
      output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      isConcurrencySafe: () => true, execute: () => ({ content: original }) });
  } });
  const adapter = new SizedAdapter([call('bulk_read', {}, 'bulk'), text('已读取并继续')]);
  host.ctx.llm.registerAdapter(['test'], adapter);
  const { agent } = await host.create(binding, route);
  await send(agent, '读取隔离长回执');
  const events = agent.session.snapshotEvents();
  assert.ok(events.some(e => e.type === 'compaction/prune'));
  assert.equal(events.filter(e => e.type === 'turn/end').at(-1).data.reason.kind, 'completed');
  assert.equal(adapter.requests.length, 2);
  assert.ok(JSON.stringify(adapter.requests[1].messages).includes('head verified node real-node'));
  assert.ok(!JSON.stringify(adapter.requests[1].messages).includes(original));
  assert.ok(events.some(e => e.type === 'tool/result' && JSON.stringify(e).includes(original)));
});

test('product scope filters tools and official approval refuses a mutation before dispatch', { timeout: 10000 }, async t => {
  let dispatches = 0;
  const server = createServer((_request, response) => {
    dispatches += 1;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ success: true }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const catalog = [{ name: 'project_delete_test', description: 'Delete test artifact', roles: ['canvas-primary'], effect: 'delete', approvalRequired: true, parameters: { type: 'object', properties: {}, additionalProperties: false } }];
  const { host } = await fixture(t, {
    registerTools: (scope, bound) => registerProductTools(scope, bound, catalog, { url: `http://127.0.0.1:${server.address().port}`, token: 'test-credential' }),
  });
  host.ctx.on('approval/request', async () => 'rejected');
  const adapter = new ScriptedAdapter([call('project_delete_test', {}), text('denied'), text('scoped')]);
  host.ctx.llm.registerAdapter(['test'], adapter);
  const canvas = await host.create(binding, route);
  await send(canvas.agent, 'Delete the test artifact');
  assert.equal(dispatches, 0);
  const approval = canvas.agent.session.snapshotEvents().filter(e => e.type.startsWith('approval/'));
  assert.ok(approval.some(e => e.type === 'approval/asked'));
  assert.ok(approval.some(e => e.type === 'approval/decided'));
  const textSession = await host.create({ ...binding, conversationId: 'text-conversation', agentId: 'text-primary', nodeId: 'text-node' }, route);
  await send(textSession.agent, 'Read the text');
  assert.ok(!adapter.requests.at(-1).tools.some(tool => tool.name === 'project_delete_test'));
  assert.equal(host.binding(textSession.binding.sessionId).nodeId, 'text-node');
});

test('named product tool calls the authenticated bridge and official SQLite persistence restores the next turn', { timeout: 15000 }, async t => {
  const token = randomBytes(32).toString('hex');
  const received = [];
  let outputPath;
  const server = createServer(async (request, response) => {
    assert.equal(request.headers.authorization, `Bearer ${token}`);
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks));
    received.push(payload);
    await writeFile(outputPath, JSON.stringify(payload.input));
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ success: true, requestId: payload.requestId, filePath: outputPath }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const catalog = [{ name: 'project_test_write', description: 'Write the test project artifact', roles: ['canvas-primary'], effect: 'write', parameters: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'], additionalProperties: false } }];
  const { host, dataRoot } = await fixture(t, {
    registerTools: (scope, bound) => registerProductTools(scope, bound, catalog, { url: `http://127.0.0.1:${server.address().port}`, token }),
  });
  outputPath = join(dataRoot, 'artifact.json');
  const adapter = new ScriptedAdapter([call('project_test_write', { content: 'real artifact' }), text('written')]);
  host.ctx.llm.registerAdapter(['test'], adapter);
  const created = await host.create(binding, route);
  await send(created.agent, 'Write a project artifact');
  assert.deepEqual(JSON.parse(await readFile(outputPath, 'utf8')), { content: 'real artifact' });
  assert.equal(received.length, 1);
  assert.deepEqual(received[0].binding, created.binding);
  assert.ok(created.agent.session.snapshotEvents().some(e => e.type === 'tool/result' && !e.data.message.isError));
  const originalEvents = created.agent.session.snapshotEvents().length;
  await host.dispose();
  const restored = await createHost(options(dataRoot));
  t.after(() => restored.dispose());
  const next = new ScriptedAdapter([text('restored')]);
  restored.ctx.llm.registerAdapter(['test'], next);
  const resumed = await restored.resume(created.binding.sessionId, route);
  assert.ok(resumed.agent.session.snapshotEvents().length >= originalEvents);
  await send(resumed.agent, 'Continue after restart');
  assert.ok(resumed.agent.session.snapshotEvents().filter(e => e.type === 'turn/end').length >= 2);
  assert.equal(restored.binding(created.binding.sessionId).projectKey, binding.projectKey);
  await assert.rejects(restored.resume('unbound-session', route), /trusted Shotloom binding/);
});

test('official Goal driver continues in the same session and update_goal completes it', { timeout: 15000 }, async t => {
  const { host } = await fixture(t);
  let agent;
  const adapter = new ScriptedAdapter([
    call('create_goal', { objective: 'Verify continued work', max_goal_rounds: 3 }),
    text('First turn finished; work remains.'),
    () => {
      const goal = host.ctx.goals.get(agent);
      return call('update_goal', { goal_id: goal.id, revision: goal.revision, action: 'complete' });
    },
    text('Goal achieved.'),
  ]);
  host.ctx.llm.registerAdapter(['test'], adapter);
  ({ agent } = await host.create(binding, route));
  await send(agent, 'Keep working until the goal is achieved.');
  const deadline = Date.now() + 5000;
  while (host.ctx.goals.get(agent)?.phase !== 'complete' && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  await agent.whenIdle();
  assert.equal(host.ctx.goals.get(agent)?.phase, 'complete');
  assert.equal(host.ctx.goals.get(agent)?.roundsStarted, 1);
  assert.equal(agent.session.snapshotEvents().filter(e => e.type === 'turn/end').length, 2);
  assert.equal(adapter.requests.length, 4);
});

test('releasing a live owner allows official resume and preserves Plan state', { timeout: 10000 }, async t => {
  const { host } = await fixture(t);
  const adapter = new ScriptedAdapter([text('plan inspected'), text('plan restored')]);
  host.ctx.llm.registerAdapter(['test'], adapter);
  const first = await host.create(binding, route);
  host.ctx.planMode.set(first.agent, true);
  await send(first.agent, 'Inspect the plan');
  assert.equal(host.ctx.planMode.get(first.agent).active, true);
  await assert.rejects(host.resume(first.binding.sessionId, route), /live owner/);
  await first.dispose();
  const resumed = await host.resume(first.binding.sessionId, route);
  assert.equal(host.ctx.planMode.get(resumed.agent).active, true);
  await send(resumed.agent, 'Continue planning');
  assert.equal(adapter.requests.length, 2);
});

test('official authenticated HTTP transport exposes bound Sessions and real history', async t => {
  const { host, dataRoot } = await fixture(t);
  const { startWebHost } = await import('../dist/webHost.js');
  const { url } = await startWebHost(host, { dataRoot, distIndex: join(root, 'harness/host/client-dist/index.html'), defaultModel: route });
  const agent = await host.create(binding, route);
  host.ctx.llm.registerAdapter(['test'], new ScriptedAdapter([text('HTTP history evidence')]));
  const login = await fetch(url, { redirect: 'manual' });
  assert.equal(login.status, 303);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const base = new URL(url).origin;
  assert.equal((await fetch(base)).status, 401);
  const page = await fetch(base, { headers: { cookie } });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /__DSH_BOOT__/);
  async function rpc(method, args) {
    const response = await fetch(`${base}/api/${method}`, {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: `test-${randomBytes(8).toString('hex')}`, method, payload: { args } }),
    });
    assert.equal(response.status, 200);
    const result = (await response.json()).result;
    assert.equal(result.ok, true, JSON.stringify(result));
    return result.value;
  }
  const catalog = await rpc('session/list', { _request: {} });
  assert.ok(catalog.items.some(item => item.sessionId === agent.binding.sessionId));
  await rpc('session/prompt', { request: {
    requestId: 'http-test-prompt', sessionId: agent.binding.sessionId, mode: 'queue',
    content: [{ type: 'text', text: 'HTTP user message' }],
  } });
  await agent.agent.whenIdle();
  const history = await rpc('session/page', { request: { address: { kind: 'session', sessionId: agent.binding.sessionId }, throughSeq: agent.agent.session.seq - 1 } });
  assert.match(JSON.stringify(history), /HTTP history evidence/);
});

test('native composition validates bindings, caches configuration, scopes Skills and restores official sessions', { timeout: 15000 }, async t => {
  const { startDesktopHost } = await import('../dist/desktopHost.js');
  const dataRoot = await mkdtemp(join(tmpdir(), 'shotloom-desktop-'));
  const config = { ...options(dataRoot), distIndex: join(root, 'harness/host/client-dist/index.html'), bridge: { url: 'http://127.0.0.1:1', token: 'native-composition-secret' } };
  let desktop = await startDesktopHost(config);
  t.after(async () => { await desktop.host.dispose(); await rm(dataRoot, { recursive: true, force: true }); });
  async function bind(payload) {
    try { return Response.json(await desktop.bind(payload)); } catch (error) { return Response.json({ error: String(error) }, { status: 400 }); }
  }
  const payload = { binding, tools: [], skills: [{ id: 'video-editing', builtIn: true, instructions: 'Only the authorized editing skill.' }], defaultModel: route };
  const adapter = new ScriptedAdapter([request => {
    const source = JSON.stringify(request);
    assert.match(source, /video-editing/);
    assert.doesNotMatch(source, /miyazaki-inspired-animation/);
    return text('native scoped response');
  }]);
  desktop.host.ctx.llm.registerAdapter(['test'], adapter);
  let response = await bind({ ...payload, defaultModel: undefined });
  assert.equal(response.status, 200, await response.clone().text());
  const created = await response.json();
  assert.equal(desktop.host.ctx.sessionProjections.stateOf(desktop.host.ctx.agents.get(created.sessionId).session, 'modelSelection').pending, null);
  // Adding the first configured model must update this same empty Session,
  // rather than leaving it on the controller's deployment fallback.
  response = await bind({ ...payload, sessionId: created.sessionId });
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await response.json()).sessionId, created.sessionId);
  assert.equal(desktop.host.ctx.get('webServer'), undefined, 'desktop has no browser HTTP or Cookie authentication endpoint');
  const skillRoot = join(dataRoot, 'product-skills');
  const { stat, readdir } = await import('node:fs/promises');
  const directory = (await readdir(skillRoot))[0];
  const skillFile = join(skillRoot, directory, 'video-editing/SKILL.md');
  const before = (await stat(skillFile)).mtimeMs;
  await bind(payload);
  assert.equal((await stat(skillFile)).mtimeMs, before, 'identical composition must not rewrite Skill files');
  const agent = desktop.host.ctx.agents.get(created.sessionId);
  assert.ok(agent);
  const selection = desktop.host.ctx.sessionProjections.stateOf(agent.session, 'modelSelection');
  assert.equal(selection.pending.model, route.model);
  // Exercise the same controller the browser uses, which previously reset the
  // route to the unconfigured deployment default on the first prompt.
  await desktop.host.ctx.sessionController.prompt({ requestId: crypto.randomUUID(), sessionId: agent.session.id, mode: 'queue', content: [{ type: 'text', text: 'native desktop request' }] }, new AbortController().signal);
  await agent.whenIdle();
  assert.equal(adapter.requests[0].provider, route.provider);
  assert.equal(adapter.requests[0].model, route.model);
  // Rebinding updates official tool registrations in the same live Session.
  const retired = { name: 'retired_native_tool', description: 'Previously exposed optional backend', parameters: { type: 'object', properties: {} }, roles: [binding.agentId], effect: 'read' };
  response = await bind({ ...payload, sessionId: created.sessionId, tools: [retired, { ...retired, name: 'openreel_rig_humanoid_model' }] });
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(desktop.host.ctx.tools.schemas(agent).some(tool => tool.name === retired.name), true);
  assert.equal(desktop.host.ctx.tools.schemas(agent).some(tool => tool.name === 'openreel_rig_humanoid_model'), false);
  response = await bind({ ...payload, sessionId: created.sessionId });
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await response.json()).sessionId, created.sessionId);
  assert.equal(desktop.host.ctx.agents.get(created.sessionId), agent);
  assert.equal(desktop.host.ctx.tools.schemas(agent).some(tool => tool.name === retired.name), false);
  assert.equal(desktop.host.ctx.tools.schemas(agent).some(tool => tool.name === 'read_uploaded_file'), true);
  // Product authoring refreshes the same official scope synchronously.
  const customSkill = { id: 'authored-prop-method', description: 'Reusable product prop method', instructions: 'Read actual assets and create a prop node.' };
  const updatedPayload = { ...payload, skills: [...payload.skills, customSkill], sessionId: created.sessionId };
  assert.equal((await desktop.host.ctx.skills.list({ scope: agent })).some(item => item.name === customSkill.id), false);
  response = await bind(updatedPayload);
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await response.json()).sessionId, created.sessionId);
  assert.equal((await desktop.host.ctx.skills.list({ scope: agent })).some(item => item.name === customSkill.id), true);
  assert.match((await desktop.host.ctx.skills.get(customSkill.id, { scope: agent })).content, /Read actual assets/);
  adapter.script.push(call('skill', { name: customSkill.id }), request => {
    assert.match(JSON.stringify(request.messages), /Read actual assets and create a prop node/);
    assert.equal(request.tools.some(tool => tool.name === retired.name), false);
    return text('authored skill loaded');
  });
  await send(agent, 'load the newly saved skill');
  response = await bind({ ...payload, sessionId: created.sessionId, binding: { ...binding, projectKey: 'another-project' } });
  assert.equal(response.status, 400);
  await desktop.host.dispose();
  const database = openDatabase(join(dataRoot, 'agent.sqlite'));
  const crud = new HostCrud(database);
  const legacyCatalogs = crud.catalogs();
  legacyCatalogs[0].tools.push({ ...retired, name: 'openreel_rig_humanoid_model' });
  // Update the actual stored row while preserving its production key.
  const { catalogs } = await import('../dist/db/schema.js');
  const storedKey = database.orm.select().from(catalogs).get().key;
  crud.saveCatalog(storedKey, legacyCatalogs[0]);
  database.close();
  desktop = await startDesktopHost(config);
  // A legacy archive is filtered even before the product rebinds its catalog.
  const legacyOwner = await desktop.host.resume(created.sessionId, route);
  assert.equal(desktop.host.ctx.tools.schemas(legacyOwner.agent).some(tool => tool.name === 'openreel_rig_humanoid_model'), false);
  await legacyOwner.dispose();
  const resumedAdapter = new ScriptedAdapter([text('restored native session')]);
  desktop.host.ctx.llm.registerAdapter(['test'], resumedAdapter);
  response = await bind(updatedPayload);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).sessionId, created.sessionId);
  const restored = desktop.host.ctx.agents.get(created.sessionId);
  assert.equal((await desktop.host.ctx.skills.list({ scope: restored })).some(item => item.name === customSkill.id), true);
  await send(restored, 'second turn after native restart');
  assert.match(JSON.stringify(resumedAdapter.requests[0].messages), /native scoped response/);
});

test('native IPC routes official RPC and streams, rejects external routes and preserves project binding', { timeout: 15000 }, async t => {
  const { startDesktopHost } = await import('../dist/desktopHost.js');
  const { nativeTransport } = await import('../dist/nativeTransport.js');
  const dataRoot = await mkdtemp(join(tmpdir(), 'shotloom-native-wire-'));
  const desktop = await startDesktopHost({ ...options(dataRoot), distIndex: join(root, 'harness/host/client-dist/index.html'), bridge: { url: 'http://127.0.0.1:1', token: 'test-private-channel' } });
  t.after(async () => { await desktop.host.dispose(); await rm(dataRoot, { recursive: true, force: true }); });
  const events = [];
  let firstItem;
  const item = new Promise(resolve => { firstItem = resolve; });
  const receive = nativeTransport(desktop, event => { events.push(event); if (event.kind === 'item') firstItem(event); });
  await receive({ requestId: 'bind', kind: 'bind', payload: { binding, tools: [], skills: [] } });
  const { sessionId } = events.at(-1).value;
  assert.ok(sessionId);
  await receive({ requestId: 'rpc', kind: 'fetch', payload: { path: '/api/session/list', method: 'POST', headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify({ type: 'client-request', rpcId: 'test-rpc', method: 'session/list', payload: { args: { _request: {} } } })).toString('base64') } });
  const response = events.at(-1).value;
  assert.equal(response.status, 200);
  const catalog = JSON.parse(Buffer.from(response.body, 'base64').toString()).result;
  assert.equal(catalog.ok, true);
  assert.ok(catalog.value.items.some(row => row.sessionId === sessionId));
  const uploadBytes = Buffer.from('<html>真实上传正文</html>\n');
  const uploadPath = `/api/session/uploadFileBinary?sessionId=${encodeURIComponent(sessionId)}&name=${encodeURIComponent('凡猫国产3A大作_V1.html')}`;
  await receive({ requestId: 'upload', kind: 'fetch', payload: { path: uploadPath, method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: uploadBytes.toString('base64') } });
  const uploadResponse = events.at(-1).value;
  assert.equal(uploadResponse.status, 200);
  const upload = JSON.parse(Buffer.from(uploadResponse.body, 'base64').toString());
  assert.equal(upload.ok, true, JSON.stringify(upload));
  assert.equal(upload.value.file.name, '凡猫国产3A大作_V1.html');
  const storedBytes = [];
  for await (const chunk of desktop.host.ctx.attachments.readFileStream(upload.value.file)) storedBytes.push(chunk);
  assert.deepEqual(Buffer.concat(storedBytes), uploadBytes);
  for (const path of ['https://example.com/api/session/list', '/outside']) {
    await receive({ requestId: 'denied', kind: 'fetch', payload: { path } });
    assert.equal(events.at(-1).kind, 'error');
    assert.match(events.at(-1).error, /Invalid native API route/);
  }
  await receive({ requestId: 'mismatch', kind: 'bind', payload: { binding: { ...binding, projectKey: 'other' }, sessionId, tools: [] } });
  assert.equal(events.at(-1).kind, 'error');
  assert.match(events.at(-1).error, /binding mismatch/);
  const stream = receive({ requestId: 'stream', kind: 'stream', payload: { endpoint: 'workspace/follow', payload: { args: {} } } });
  const timer = setTimeout(() => firstItem({ kind: 'timeout' }), 5000);
  assert.equal((await item).kind, 'item');
  clearTimeout(timer);
  await receive({ requestId: 'stream', kind: 'cancel' });
  await stream;
  assert.ok(events.some(event => event.requestId === 'stream' && ['end', 'error'].includes(event.kind)));
});

test('official pi-ai adapter receives a configured product route and real wire tool schemas', { timeout: 15000 }, async t => {
  const { startDesktopHost } = await import('../dist/desktopHost.js');
  const requests = [];
  const modelServer = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer test-product-key');
    let raw = ''; for await (const chunk of req) raw += chunk;
    requests.push(JSON.parse(raw));
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const chunk = { id: 'mock-wire', object: 'chat.completion.chunk', created: 1, model: 'wire-model', choices: [{ index: 0, delta: { role: 'assistant', content: 'official adapter wire response' }, finish_reason: null }] };
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    chunk.choices[0] = { index: 0, delta: {}, finish_reason: 'stop' };
    res.end(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`);
  });
  await new Promise(resolve => modelServer.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => modelServer.close(resolve)));
  const dataRoot = await mkdtemp(join(tmpdir(), 'shotloom-wire-'));
  const desktop = await startDesktopHost({ ...options(dataRoot), distIndex: join(root, 'harness/host/client-dist/index.html'), bridge: { url: 'http://127.0.0.1:1', token: 'wire-secret' } });
  t.after(async () => { await desktop.host.dispose(); await rm(dataRoot, { recursive: true, force: true }); });
  const created = await desktop.bind({ binding, tools: [{ name: 'canvas_test_read', description: 'Read a real scoped node', parameters: { type: 'object', properties: { nodeId: { type: 'string' } }, required: ['nodeId'], additionalProperties: false }, roles: ['canvas-primary'], effect: 'read' }], skills: [], providers: { 'shotloom-wire': { key: 'test-product-key', profile: { api: 'openai-completions', baseURL: `http://127.0.0.1:${modelServer.address().port}/v1`, models: [{ id: 'wire-model', name: 'Wire model', input: ['text'], reasoningEfforts: { off: 'none', medium: 'medium', max: 'ultra' }, compat: { supportsReasoningEffort: true } }] } } }, defaultModel: { provider: 'shotloom-wire', model: 'wire-model', reasoningEffort: 'medium' } });
  const { sessionId } = created;
  await send(desktop.host.ctx.agents.get(sessionId), 'verify native provider configuration');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].reasoning_effort, 'medium');
  const advertised = await desktop.host.ctx.llm.resolveModelInfo('shotloom-wire', 'wire-model');
  assert.deepEqual(advertised.reasoning.efforts.map(row => row.id), ['off', 'medium', 'max']);
  await desktop.host.ctx.sessionController.selectModel({ sessionId, provider: 'shotloom-wire', model: 'wire-model', reasoningEffort: 'max' });
  await send(desktop.host.ctx.agents.get(sessionId), 'use the selected maximum effort');
  assert.equal(requests[1].reasoning_effort, 'ultra');
  await desktop.host.ctx.sessionController.selectModel({ sessionId, provider: 'shotloom-wire', model: 'wire-model', reasoningEffort: 'off' });
  await send(desktop.host.ctx.agents.get(sessionId), 'disable reasoning');
  assert.equal(requests[2].reasoning_effort, 'none');
  const tool = requests[0].tools.find(row => row.function.name === 'canvas_test_read');
  assert.deepEqual(tool.function.parameters.required, ['nodeId']);
  assert.equal(tool.function.parameters.properties.nodeId.type, 'string');
  const log = desktop.host.ctx.agents.get(sessionId).session.snapshotEvents();
  assert.match(JSON.stringify(log), /official adapter wire response/);
});

test('durable mutation receipts survive Host restart and uncertain dispatches never replay', { timeout: 15000 }, async t => {
  const dataRoot = await mkdtemp(join(tmpdir(), 'shotloom-receipts-'));
  let writes = 0;
  const server = createServer((_req, res) => {
    writes++;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ success: true, taskId: `task-${writes}` }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(dataRoot, { recursive: true, force: true }); });
  const receiptRoot = join(dataRoot, 'receipts');
  const registerTools = (scope, bound) => registerProductTools(scope, bound, [{
    name: 'test_paid_write', description: 'Test a durable paid-operation receipt', roles: ['canvas-primary'], effect: 'generation',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  }], { url: `http://127.0.0.1:${server.address().port}`, token: 'test', receiptRoot });
  let host = await createHost({ ...options(dataRoot), registerTools });
  t.after(() => host.dispose());
  host.ctx.llm.registerAdapter(['test'], new ScriptedAdapter([]));
  let owner = await host.create(binding, route);
  const sessionId = owner.binding.sessionId;
  const invoke = id => owner.agent.ctx.tools.get('test_paid_write', owner.agent).execute({}, {
    agent: owner.agent, callId: ToolCallId(id), signal: new AbortController().signal,
  });
  const first = await invoke('paid-once');
  assert.equal(first.taskId, 'task-1');
  await host.dispose();
  host = await createHost({ ...options(dataRoot), registerTools });
  host.ctx.llm.registerAdapter(['test'], new ScriptedAdapter([]));
  owner = await host.resume(sessionId, route);
  assert.deepEqual(await invoke('paid-once'), first);
  assert.equal(writes, 1);
  const receiptDatabase = openDatabase(join(receiptRoot, 'agent.sqlite'));
  new HostCrud(receiptDatabase).claimReceipt(`${sessionId}:uncertain`);
  receiptDatabase.close();
  const unknown = await invoke('uncertain');
  assert.equal(unknown.code, 'TOOL_OUTCOME_UNKNOWN');
  assert.equal(unknown.applied, undefined);
  assert.equal(writes, 1);
});

test('product references and uploaded text stay inside the bound official Session', async t => {
  const { host } = await fixture(t);
  host.ctx.llm.registerAdapter(['test'], new ScriptedAdapter([text('file admitted')]));
  const owner = await host.create(binding, route);
  const exec = { agent: owner.agent, callId: ToolCallId('read-reference'), signal: new AbortController().signal };
  const readReference = owner.agent.ctx.tools.get('read_skill_reference', owner.agent);
  const reference = await readReference.execute({ name: 'video-editing', file: 'references/verification.md' }, exec);
  assert.equal(reference.success, true, JSON.stringify(reference));
  assert.ok(reference.content.length > 0);
  assert.equal((await readReference.execute({ name: 'video-editing', file: '../../../../AGENTS.md' }, exec)).success, false);
  const file = await host.ctx.attachments.saveFile({ data: Buffer.from('first line\n真实上传正文\nlast line'), name: 'fixture.txt' });
  const read = owner.agent.ctx.tools.get('read_uploaded_file', owner.agent);
  assert.equal((await read.execute({ attachmentId: file.attachmentId }, exec)).code, 'ATTACHMENT_NOT_IN_SESSION');
  owner.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Use the attached file' }, { type: 'file', attachment: file }], source: { kind: 'user' } }));
  await owner.agent.whenIdle();
  assert.match((await read.execute({ attachmentId: file.attachmentId }, exec)).content, /真实上传正文/);
  const other = await host.create({ ...binding, conversationId: 'another-conversation' }, route);
  const foreign = await other.agent.ctx.tools.get('read_uploaded_file', other.agent).execute({ attachmentId: file.attachmentId }, { ...exec, agent: other.agent });
  assert.equal(foreign.code, 'ATTACHMENT_NOT_IN_SESSION');
});

test('product media receipts become durable official image blocks instead of base64 JSON', async t => {
  const data = (await readFile(join(root, 'src-tauri/icons/app.png'))).toString('base64');
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ success: true, result: { result: { success: true, __toolAttachments: [{ mime: 'image/png', filename: 'real-preview.png', url: `data:image/png;base64,${data}` }] } } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const { host } = await fixture(t, { registerTools: (scope, bound) => registerProductTools(scope, bound, [{
    name: 'test_media', description: 'Read a real preview', roles: ['canvas-primary'], effect: 'read', parameters: { type: 'object', properties: {} },
  }], { url: `http://127.0.0.1:${server.address().port}`, token: 'test' }) });
  const adapter = new ScriptedAdapter([call('test_media', {}), text('image received')]);
  host.ctx.llm.registerAdapter(['test'], adapter);
  const { agent } = await host.create(binding, route);
  await send(agent, 'Inspect the real preview');
  const result = agent.session.snapshotEvents().find(event => event.type === 'tool/result');
  const image = result.data.message.content.find(block => block.type === 'image');
  assert.ok(image?.attachment.attachmentId, JSON.stringify(result));
  assert.ok((await host.ctx.attachments.readImage(image.attachment)).data.length > 0);
  assert.ok(!JSON.stringify(result).includes('__toolAttachments'));
  assert.ok(!JSON.stringify(result).includes('data:image/'));
  assert.ok(JSON.stringify(adapter.requests.at(-1)).includes(image.attachment.attachmentId));
});

test('official Bash executes approved commands in the Session workspace and scrubs bridge credentials', { timeout: 20000 }, async t => {
  const { host, dataRoot } = await fixture(t);
  const previous = process.env.SHOTLOOM_BRIDGE_TOKEN;
  process.env.SHOTLOOM_BRIDGE_TOKEN = 'bash-test-credential';
  t.after(() => { if (previous === undefined) delete process.env.SHOTLOOM_BRIDGE_TOKEN; else process.env.SHOTLOOM_BRIDGE_TOKEN = previous; });
  host.ctx.on('approval/request', async () => 'allowed-once');
  const adapter = new ScriptedAdapter([
    call('bash', { description: '验证会话工作目录和凭据隔离', command: 'printf "bash-ok" > proof.txt; printf "%s" "${SHOTLOOM_BRIDGE_TOKEN-unset}"' }),
    text('verified'),
  ]);
  host.ctx.llm.registerAdapter(['test'], adapter);
  const owner = await host.create(binding, route);
  await send(owner.agent, 'Run an approved isolated command');
  const events = owner.agent.session.snapshotEvents();
  assert.match(JSON.stringify(events.filter(e => e.type === 'tool/result')), /unset/);
  assert.equal(await readFile(join(dataRoot, 'workspaces', owner.binding.sessionId, 'proof.txt'), 'utf8'), 'bash-ok');
  const result = JSON.stringify(events.filter(e => e.type === 'tool/result'));
  assert.match(result, /unset/);
  assert.doesNotMatch(result, /bash-test-credential/);
  assert.ok(events.some(e => e.type === 'approval/asked'));
  assert.ok(events.some(e => e.type === 'approval/decided'));
});

test('official Bash rejection never spawns and sandbox blocks writes outside the Session workspace', { timeout: 20000 }, async t => {
  const { host, dataRoot } = await fixture(t);
  // Official workspace-write also permits OS temp directories, so use a
  // unique home-directory target to exercise an actual sandbox boundary.
  const outsideName = `.shotloom-bash-boundary-${randomBytes(12).toString('hex')}`;
  const outside = join(homedir(), outsideName);
  t.after(() => rm(outside, { force: true }));
  let answer = 'rejected';
  host.ctx.on('approval/request', async () => answer);
  host.ctx.llm.registerAdapter(['test'], new ScriptedAdapter([
    call('bash', { description: '拒绝命令不得执行', command: 'printf rejected > rejected.txt' }, 'denied-bash'), text('denied'),
    call('bash', { description: '验证工作目录写入边界', command: `printf escaped > "$HOME/${outsideName}"` }, 'sandbox-bash'), text('bounded'),
    call('bash', { description: '验证扩大权限需要审批', command: `printf escalated > "$HOME/${outsideName}"`, sandbox_permissions: 'danger-full-access', justification: '测试用户拒绝扩大文件访问权限后的执行边界' }, 'escalated-bash'), text('rejected escalation'),
  ]));
  const owner = await host.create(binding, route);
  await send(owner.agent, 'Reject this command');
  await assert.rejects(readFile(join(dataRoot, 'workspaces', owner.binding.sessionId, 'rejected.txt')), { code: 'ENOENT' });
  answer = 'allowed-once';
  await send(owner.agent, 'Try a write outside the Session workspace');
  await assert.rejects(readFile(outside), { code: 'ENOENT' });
  assert.match(JSON.stringify(owner.agent.session.snapshotEvents().filter(e => e.type === 'tool/result')), /denied|not permitted/i);
  answer = 'rejected';
  await send(owner.agent, 'Reject the escalation');
  await assert.rejects(readFile(outside), { code: 'ENOENT' });
});

test('official permission presets persist per Session and Full access changes Bash execution policy', { timeout: 20000 }, async t => {
  const { host, dataRoot } = await fixture(t);
  const adapter = new ScriptedAdapter([
    call('bash', { description: '验证只读模式拒绝工作目录写入', command: 'printf readonly > readonly.txt' }, 'readonly-check'), text('read only'),
    call('bash', { description: '验证明确选择完全权限后执行', command: 'printf full-access > full-access.txt' }, 'full-check'), text('full access'),
  ]);
  host.ctx.llm.registerAdapter(['test'], adapter);
  host.ctx.on('approval/request', async () => 'allowed-once');
  const owner = await host.create(binding, route);
  const other = await host.create({ ...binding, conversationId: 'other-permission-session' }, route);
  assert.equal(host.ctx.permissionPresets.current(owner.agent.session), 'workspace-write');
  host.ctx.permissionPresets.set(owner.agent.session, 'read-only');
  await send(owner.agent, 'Try writing under read-only');
  await assert.rejects(readFile(join(dataRoot, 'workspaces', owner.binding.sessionId, 'readonly.txt')), { code: 'ENOENT' });
  host.ctx.permissionPresets.set(owner.agent.session, 'danger-full-access');
  const before = owner.agent.session.snapshotEvents().filter(e => e.type === 'approval/asked').length;
  await send(owner.agent, 'Execute after explicitly selecting Full access');
  assert.equal(await readFile(join(dataRoot, 'workspaces', owner.binding.sessionId, 'full-access.txt'), 'utf8'), 'full-access');
  assert.equal(owner.agent.session.snapshotEvents().filter(e => e.type === 'approval/asked').length, before);
  assert.equal(host.ctx.permissionPresets.current(other.agent.session), 'workspace-write');
  await owner.dispose();
  const resumed = await host.resume(owner.binding.sessionId, route);
  assert.equal(host.ctx.permissionPresets.current(resumed.agent.session), 'danger-full-access');
});

test('an existing Session sees newly available Bash despite its earlier unavailable reply', { timeout: 15000 }, async t => {
  let exposeBash;
  const { host } = await fixture(t, { registerTools(scope) {
    exposeBash = scope.get('tools').restrict({ deny: ['bash'] });
  } });
  const adapter = new ScriptedAdapter([
    text('当前工具清单没有 bash'),
    call('bash', { description: '核验当前会话新增的 Bash 工具', command: 'printf bash-recovered' }, 'recovered-bash'), text('Bash executed'),
  ]);
  host.ctx.llm.registerAdapter(['test'], adapter);
  host.ctx.on('approval/request', async () => 'allowed-once');
  const owner = await host.create(binding, route);
  await send(owner.agent, 'Can you use Bash?');
  assert.ok(!adapter.requests[0].tools.some(tool => tool.name === 'bash'));
  exposeBash();
  await send(owner.agent, 'Use the current Bash tool');
  const request = adapter.requests[1];
  assert.ok(request.tools.some(tool => tool.name === 'bash'));
  const runtime = request.messages.flatMap(message => message.content ?? [])
    .filter(block => block.type === 'text' && block.text.includes('当前会话本轮可用工具')).at(-1);
  assert.ok(runtime, 'official runtime context must refresh the current capability facts');
  const currentNames = runtime.text.split('当前会话本轮可用工具')[1].split('\n')[0];
  assert.match(currentNames, /\bbash\b/);
  const headers = owner.agent.session.snapshotEvents().filter(e => e.type === 'request/header');
  assert.ok(headers.at(-1).data.header.tools.some(tool => tool.name === 'bash'));
  assert.match(JSON.stringify(owner.agent.session.snapshotEvents().filter(e => e.type === 'tool/result')), /bash-recovered/);
});

test('official spawn creates isolated analysis child, returns result and persists lineage', { timeout: 15000 }, async t => {
  const { host, dataRoot } = await fixture(t);
  const adapter = new ScriptedAdapter([request => {
    assert.ok(request.tools.some(tool => tool.name === 'send_message'));
    assert.ok(!request.tools.some(tool => ['bash', 'project_snapshot', 'subagent'].includes(tool.name)));
    return text('分析结果：采用暖色调，先特写咖啡。');
  }]);
  host.ctx.llm.registerAdapter(['test'], adapter);
  const { agent } = await host.create(binding, route);
  const schemas = host.ctx.tools.schemas(agent);
  for (const name of ['subagent', 'send_message', 'interrupt_agent']) assert.ok(schemas.some(tool => tool.name === name), name);
  const activation = await host.ctx.subagents.startActivation({
    provider: 'spawn', label: '广告镜头复核', delivery: 'caller', signal: new AbortController().signal,
    request: { parent: agent, prompt: [{ type: 'text', text: '真实材料：15秒咖啡广告，暖色调。请给出镜头建议。' }], maxDepth: 1, persona: '你是分析子 Agent', toolFilter: { allow: ['send_message'] } },
  });
  const result = await activation.result;
  assert.match(JSON.stringify(result), /暖色调/);
  assert.notEqual(String(activation.childId), String(agent.session.id));
  await host.ctx.sessionPersistence.flush();
  const children = await host.ctx.subagents.listChildren(agent.session.id);
  assert.ok(children.some(child => String(child.id) === String(activation.childId)));
  await host.dispose();
  const restored = await createHost(options(dataRoot));
  t.after(() => restored.dispose());
  const continued = new ScriptedAdapter([
    request => {
      assert.deepEqual(request.tools.map(tool => tool.name), ['send_message']);
      assert.match(JSON.stringify(request.messages), /暖色调/);
      return text('恢复后的子 Agent 建议：咖啡杯特写。');
    },
    text('父 Agent 收到恢复后的复核。'),
  ]);
  restored.ctx.llm.registerAdapter(['test'], continued);
  const resumed = await restored.resume(agent.session.id, route);
  assert.ok((await restored.ctx.subagents.listChildren(agent.session.id)).some(child => String(child.id) === String(activation.childId)));
  await restored.ctx.subagents.sendMessage(resumed.agent, activation.childId, [{ type: 'text', text: '继续复核' }], { signal: new AbortController().signal });
  await restored.ctx.subagents.waitForChildren(resumed.agent);
  await resumed.agent.whenIdle();
  assert.ok(continued.requests.length >= 1);
});

test('model-facing subagent tool starts a child and official runtime notifies its parent', { timeout: 15000 }, async t => {
  const { host } = await fixture(t);
  class DelegationAdapter extends LlmAdapter {
    requests = []; parentCalls = 0;
    async listModels(provider) { return [{ provider, id: 'scripted', name: 'delegation-test' }]; }
    async resolveModel(provider, id) { return { provider, id, name: 'delegation-test' }; }
    async *stream(request) {
      this.requests.push(request);
      const parent = request.tools.some(tool => tool.name === 'subagent');
      if (parent && this.parentCalls++ === 0) yield* call('subagent', { description: '独立镜头复核', prompt: '材料：15秒咖啡广告。请提供一条镜头建议。' });
      else if (parent) yield* text('父 Agent 已处理结果');
      else { assert.deepEqual(request.tools.map(tool => tool.name), ['send_message']); yield* text('子 Agent 建议：咖啡杯特写。'); }
    }
  }
  const adapter = new DelegationAdapter();
  host.ctx.llm.registerAdapter(['test'], adapter);
  const { agent } = await host.create(binding, route);
  await send(agent, '请用子 Agent 复核镜头');
  await host.ctx.subagents.waitForChildren(agent);
  await agent.whenIdle();
  const events = agent.session.snapshotEvents();
  assert.ok(events.some(event => event.type === 'tool/result' && JSON.stringify(event).includes('started subagent')));
  assert.ok(events.some(event => event.type === 'subagent/catalog'));
  assert.ok(adapter.requests.some(request => request.messages.some(message => JSON.stringify(message).includes('咖啡杯特写'))));
});

test('canvas delegates a real editor child with live canvas tools, parent approvals and durable cold resume', { timeout: 20000 }, async t => {
  const { startDesktopHost } = await import('../dist/desktopHost.js');
  const dataRoot = await mkdtemp(join(tmpdir(), 'shotloom-editor-delegation-'));
  let editorBinding, approved = true;
  const writes = [], reads = [];
  const server = createServer(async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk;
    const request = JSON.parse(text);
    res.setHeader('content-type', 'application/json');
    if (request.phase === 'authorize') {
      res.end(JSON.stringify({ success: true, result: { success: true, approvalRequired: request.toolName === 'video_project_import_media' } }));
      return;
    }
    let result;
    if (request.toolName === 'canvas_prepare_editor') result = { success: true, binding: editorBinding };
    else {
      assert.deepEqual(request.binding, editorBinding, 'child uses the exact native-authorized editor binding');
      if (request.toolName === 'video_project_import_media') {
        assert.equal(request.approvedByHarness, true);
        writes.push(request);
        result = { success: true, mediaId: 'actual-media', assetId: request.input.assetId };
      } else {
        reads.push(request);
        result = { success: true, nodes: [{ id: 'subtitle-source', textContent: '真实字幕：你好世界' }] };
      }
    }
    res.end(JSON.stringify({ success: true, result: { result } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const config = { ...options(dataRoot), distIndex: join(root, 'harness/host/client-dist/index.html'),
    bridge: { url: `http://127.0.0.1:${server.address().port}`, token: 'delegation-secret', authorize: true } };
  let desktop = await startDesktopHost(config);
  t.after(async () => { await desktop.host.dispose(); await new Promise(resolve => server.close(resolve)); await rm(dataRoot, { recursive: true, force: true }); });
  const tool = (name, roles, effect = 'read') => ({ name, description: name, roles, effect, parameters: { type: 'object', additionalProperties: true } });
  async function bind(bound, tools) {
    return desktop.bind({ binding: bound, tools, defaultModel: route, skills: [] });
  }
  class EditorDelegationAdapter extends LlmAdapter {
    parentCalls = 0; childCalls = 0;
    async listModels(provider) { return [{ provider, id: 'scripted', name: 'editing delegation' }]; }
    async resolveModel(provider, id) { return { provider, id, name: id }; }
    async *stream(request) {
      const names = request.tools.map(tool => tool.name);
      if (names.includes('delegate_editor')) {
        if (this.parentCalls++ === 0) yield* call('delegate_editor', { prompt: '读取画布字幕并导入视频', description: '剪辑字幕', nodeId: 'timeline-a' });
        else yield* text('画布父 Agent 收到实际剪辑回报');
        return;
      }
      assert.ok(names.includes('canvas_get_node'));
      assert.ok(names.includes('video_project_import_media'));
      for (const forbidden of ['bash', 'subagent', 'delegate_editor', 'canvas_prepare_editor']) assert.ok(!names.includes(forbidden), forbidden);
      assert.match(JSON.stringify(request.messages), /Canvas Sources and Delegation/);
      if (this.childCalls++ === 0) yield* call('canvas_get_node', { nodeId: 'subtitle-source' });
      else if (this.childCalls === 2) {
        assert.match(JSON.stringify(request.messages), /真实字幕/);
        yield* call('video_project_import_media', { assetId: 'canvas:video-a:output' });
      } else yield* text('已读取真实字幕并导入 actual-media');
    }
  }
  const adapter = new EditorDelegationAdapter();
  desktop.host.ctx.llm.registerAdapter(['test'], adapter);
  const editor = await bind({ ...binding, conversationId: 'editor-conversation', agentId: 'editor-primary', nodeId: 'timeline-a' }, [
    tool('canvas_get_node', ['editor-primary']), tool('video_project_import_media', ['editor-primary'], 'write'),
  ]);
  editorBinding = desktop.host.binding(editor.sessionId);
  const parent = await bind(binding, [tool('canvas_prepare_editor', ['canvas-primary'], 'write')]);
  let childAgent;
  desktop.host.ctx.on('agent/created', ({ agent }) => { if (desktop.host.binding(String(agent.session.id))?.toolSessionId) childAgent = agent; });
  const parentAgent = desktop.host.ctx.agents.get(parent.sessionId);
  parentAgent.ctx.on('approval/request', async () => approved ? 'allowed-once' : 'rejected', { prepend: true });
  await send(parentAgent, '请派发剪辑子 Agent');
  await desktop.host.ctx.subagents.waitForChildren(parentAgent);
  await parentAgent.whenIdle();
  assert.equal(reads.length, 1, JSON.stringify(parentAgent.session.snapshotEvents()));
  assert.equal(writes.length, 1, JSON.stringify(childAgent?.session.snapshotEvents().filter(e => ['tool/result', 'turn/end', 'agent/error', 'error'].includes(e.type))));
  const children = await desktop.host.ctx.subagents.listChildren(parentAgent.session.id);
  assert.equal(children.length, 1);
  const childId = String(children[0].id);
  assert.ok(writes[0].requestId.startsWith(`${childId}:`));
  assert.equal(desktop.host.binding(childId).toolSessionId, editor.sessionId);
  assert.ok(parentAgent.session.snapshotEvents().some(event => event.type === 'approval/asked'));
  assert.match(JSON.stringify(parentAgent.session.snapshotEvents()), /actual-media/);

  // Cold resume must restore only this child's authorized timeline tools.
  await desktop.host.dispose();
  desktop = await startDesktopHost(config);
  approved = false;
  desktop.host.ctx.on('approval/request', async () => 'rejected');
  const restoredAdapter = new ScriptedAdapter([
    request => {
      assert.ok(request.tools.some(tool => tool.name === 'canvas_get_node'));
      assert.ok(request.tools.some(tool => tool.name === 'video_project_import_media'));
      assert.ok(!request.tools.some(tool => tool.name === 'delegate_editor'));
      return call('video_project_import_media', { assetId: 'another-video' }, 'denied-import');
    }, text('剪辑导入需要父会话审批'), text('父 Agent 已收到审批要求'),
  ]);
  desktop.host.ctx.llm.registerAdapter(['test'], restoredAdapter);
  const resumed = await desktop.host.resume(parent.sessionId, route);
  await desktop.host.ctx.subagents.sendMessage(resumed.agent, childId, [{ type: 'text', text: '继续导入' }], { signal: new AbortController().signal });
  await desktop.host.ctx.subagents.waitForChildren(resumed.agent);
  await resumed.agent.whenIdle();
  assert.equal(writes.length, 1, 'denied child mutation never reaches the product');
  assert.ok(restoredAdapter.requests.some(request => JSON.stringify(request.messages).includes('PARENT_APPROVAL_REQUIRED')));

  resumed.agent.ctx.on('approval/request', async () => 'rejected', { prepend: true });
  restoredAdapter.script.push(
    call('delegate_editor', { nodeId: 'timeline-a', prompt: '继续导入', description: '继续剪辑' }, 'delegate-again'),
    request => {
      assert.ok(request.tools.some(tool => tool.name === 'video_project_import_media'));
      return call('video_project_import_media', { assetId: 'another-video' }, 'rejected-by-parent');
    },
    text('导入未获批准'), text('已保留原时间线'),
  );
  await send(resumed.agent, '继续派发剪辑');
  await desktop.host.ctx.subagents.waitForChildren(resumed.agent);
  await resumed.agent.whenIdle();
  assert.equal(writes.length, 1, 'explicit parent rejection never reaches the product');
  assert.ok(resumed.agent.session.snapshotEvents().some(event => event.type === 'approval/decided' && event.data.outcome === 'rejected'));

  const childStarted = Promise.withResolvers();
  let childSignal;
  restoredAdapter.script.push(
    call('delegate_editor', { nodeId: 'timeline-a', prompt: '继续剪辑并等待', description: '取消剪辑' }, 'delegate-cancel'),
    async function* (request) {
      childSignal = request.signal;
      childStarted.resolve();
      await new Promise(resolve => {
        if (request.signal.aborted) resolve();
        else request.signal.addEventListener('abort', resolve, { once: true });
      });
      request.signal.throwIfAborted();
    },
  );
  resumed.agent.followup(createUserMessage({ content: [{ type: 'text', text: '开始剪辑' }], source: { kind: 'user' } }));
  await childStarted.promise;
  resumed.agent.cancel({ kind: 'user' });
  await resumed.agent.whenIdle();
  await desktop.host.ctx.subagents.waitForChildren(resumed.agent);
  assert.equal(childSignal.aborted, true, 'cancelling the parent also stops its editing child');
  assert.equal(writes.length, 1);
  const cancelledChild = (await desktop.host.ctx.subagents.listChildren(resumed.agent.session.id)).at(-1);
  assert.equal(desktop.host.binding(String(cancelledChild.id)).toolSessionId, editor.sessionId, 'published child keeps its durable binding after cancellation');
});
