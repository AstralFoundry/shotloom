/**
 * 行为测试：向真实的 runStore 追加事件，验证 Agent 身份确实被投影进持久化的运行记录。
 *
 * 事件日志是诊断"这一轮谁在跑、这条回执是谁产生的"的唯一依据，
 * 因此断言的是投影结果，不检查源码文本。
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const storage = new Map();
let server;
let projectStore;
let normalization;
let runStore;
let projectIdentity;

before(async () => {
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
    clear: () => storage.clear(),
  };
  globalThis.window = {
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
  };
  const rendererRoot = fileURLToPath(new URL('../renderer', import.meta.url));
  server = await createServer({
    configFile: false,
    root: rendererRoot,
    resolve: { alias: { '@': path.join(rendererRoot, 'src') } },
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  });
  projectStore = await server.ssrLoadModule('/src/store/projectStore.js');
  normalization = await server.ssrLoadModule('/src/store/projectNormalization.js');
  projectIdentity = await server.ssrLoadModule('/src/services/agentProjectIdentity.ts');
  runStore = await server.ssrLoadModule('/src/agent/runtime/runStore.ts');
  projectStore.store.project = normalization.createProject('身份投影测试项目');
});

after(async () => {
  await server?.close();
  delete globalThis.localStorage;
  delete globalThis.window;
});

const now = new Date().toISOString();

function append(runId, event) {
  runStore.appendAgentRuntimeEvent(runId, 'conversation-1', { createdAt: now, ...event }, projectIdentity.getAgentProjectKey());
}

test('run_started 把驱动这一轮的 Agent 身份投影进 agentRuns', () => {
  const runId = 'run-agent-identity-1';
  append(runId, {
    type: 'run_started', runtime: 'loop', agentId: 'canvas-primary', agentSessionId: runId,
    requestId: runId, conversationId: 'conversation-1', model: 'gpt-agent', title: '画布任务',
  });
  assert.equal(runStore.getAgentRun(runId).agentId, 'canvas-primary');
  assert.equal(runStore.getAgentRun(runId).runtime, 'loop');

  append(runId, { type: 'turn_start', agentId: 'canvas-primary', agentSessionId: runId, turn: 1 });
  const events = runStore.listAgentRuntimeEvents(runId);
  assert.ok(events.every((event) => event.agentId && event.agentSessionId), '事件日志里不得有无身份的事件');
  assert.deepEqual(events.map((event) => event.type), ['run_started', 'turn_start']);
});

test('子任务按 childAgentId 记录归属，失败时留下错误但不冒充父级', () => {
  const runId = 'run-agent-identity-2';
  const childSessionId = `${runId}:sub:production-planner:abc`;
  append(runId, {
    type: 'run_started', runtime: 'loop', agentId: 'canvas-primary', agentSessionId: runId,
    requestId: runId, conversationId: 'conversation-1', model: 'gpt-agent',
  });
  append(runId, {
    type: 'subagent_started', agentId: 'canvas-primary', agentSessionId: runId,
    childAgentId: 'production-planner', childSessionId, title: '制作规划：规划三个镜头',
  });
  append(runId, {
    type: 'tool_end', agentId: 'production-planner', agentSessionId: childSessionId,
    toolCallId: 'call-child', toolName: 'plan_write', isError: false,
    receipt: { callId: 'call-child', toolName: 'plan_write', effect: 'project_write', success: true, applied: true, partial: false, skippedCount: 0, nodeIds: [], edgeIds: [], taskIds: [], error: '' },
  });

  const run = runStore.getAgentRun(runId);
  assert.equal(run.children.length, 1);
  assert.equal(run.children[0].id, childSessionId);
  assert.equal(run.children[0].agentId, 'production-planner');
  assert.equal(run.children[0].status, 'running');
  assert.equal(run.agentId, 'canvas-primary', '父级身份不因派发子任务而改变');

  append(runId, {
    type: 'subagent_failed', agentId: 'canvas-primary', agentSessionId: runId,
    childAgentId: 'production-planner', childSessionId, error: '模型不可用',
  });
  const failed = runStore.getAgentRun(runId).children[0];
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error, '模型不可用');
  assert.equal(failed.agentId, 'production-planner', '状态更新不得抹掉已记录的归属');
});
