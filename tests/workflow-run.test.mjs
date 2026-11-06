/**
 * 工作流执行：拓扑顺序、失败停步、跳过已完成、重试与取消。
 */
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

let env;
let runs;
let store;
let normalization;

before(async () => {
  env = await createRendererEnv({ storage: new Map(), withWindow: true });
  runs = await env.load('services/workflowRunService');
  ({ store } = await env.load('store/projectStore'));
  normalization = await env.load('store/projectNormalization');
});

beforeEach(() => {
  store.project = {
    ...normalization.createProject(),
    id: 'project-run',
    name: '执行测试',
    nodes: [
      { id: 'n1', type: 'imageGeneration', title: '第一步', status: 'idle' },
      { id: 'n2', type: 'videoGeneration', title: '第二步', status: 'idle' },
    ],
    edges: [],
    tasks: [],
    workflowInstances: [{
      id: 'i1',
      templateId: 'wf-1',
      templateRevision: 1,
      nodeIds: { s1: 'n1', s2: 'n2' },
      executionOrder: ['s1', 's2'],
      steps: { s1: { status: 'pending' }, s2: { status: 'pending' } },
      status: 'planned',
      createdAt: '2026-11-06T10:00:00.000Z',
    }],
  };
});

after(async () => {
  await env?.dispose();
});

function executor(overrides = {}) {
  const calls = [];
  const statuses = new Map();
  return {
    calls,
    statuses,
    findNode: (id) => store.project.nodes.find((node) => node.id === id) || null,
    runNode: (node) => {
      calls.push(node.id);
      statuses.set(node.id, 'running');
      return { id: `task-${node.id}` };
    },
    cancelNode: () => true,
    waitForTask: async () => ({ status: 'completed' }),
    ...overrides,
  };
}

test('按 executionOrder 依次提交，全部成功则实例完成', async () => {
  const exec = executor();
  const result = await runs.runWorkflowInstance('i1', { executor: exec });

  assert.equal(result.ok, true);
  assert.deepEqual(exec.calls, ['n1', 'n2']);
  const instance = runs.findWorkflowInstance('i1');
  assert.equal(instance.status, 'completed');
  assert.equal(instance.steps.s1.status, 'completed');
  assert.equal(instance.steps.s2.status, 'completed');
  assert.equal(instance.steps.s1.taskId, 'task-n1');
});

test('某步失败即停，后续步骤保持 pending', async () => {
  const exec = executor({
    waitForTask: async (taskId) => taskId === 'task-n1'
      ? { status: 'failed', error: 'upstream 500' }
      : { status: 'completed' },
  });
  const result = await runs.runWorkflowInstance('i1', { executor: exec });

  assert.equal(result.ok, false);
  const instance = runs.findWorkflowInstance('i1');
  assert.equal(instance.status, 'failed');
  assert.equal(instance.steps.s1.status, 'failed');
  assert.match(String(instance.steps.s1.error), /upstream 500/);
  assert.equal(instance.steps.s2.status, 'pending');
  assert.deepEqual(exec.calls, ['n1']);
});

test('已完成的节点不再提交', async () => {
  store.project.nodes[0].status = 'completed';
  const exec = executor();
  await runs.runWorkflowInstance('i1', { executor: exec });
  assert.deepEqual(exec.calls, ['n2']);
  assert.equal(runs.findWorkflowInstance('i1').steps.s1.status, 'completed');
});

test('重试只重跑失败步骤，已完成步骤保留', async () => {
  const failing = executor({
    waitForTask: async (taskId) => taskId === 'task-n1'
      ? { status: 'failed', error: 'boom' }
      : { status: 'completed' },
  });
  await runs.runWorkflowInstance('i1', { executor: failing });
  assert.equal(runs.findWorkflowInstance('i1').status, 'failed');

  const retry = executor();
  const result = await runs.retryWorkflowInstance('i1', { executor: retry });

  assert.equal(result.ok, true);
  assert.deepEqual(retry.calls, ['n1', 'n2']);
  const instance = runs.findWorkflowInstance('i1');
  assert.equal(instance.status, 'completed');
  assert.equal(instance.steps.s1.status, 'completed');
});

test('等待被取消时实例标记为 cancelled', async () => {
  const exec = executor({ waitForTask: async () => ({ status: 'cancelled', error: 'aborted' }) });
  const result = await runs.runWorkflowInstance('i1', { executor: exec });

  assert.equal(result.ok, false);
  const instance = runs.findWorkflowInstance('i1');
  assert.equal(instance.status, 'cancelled');
  assert.equal(instance.steps.s1.status, 'cancelled');
  assert.deepEqual(exec.calls, ['n1']);
});

test('同一实例不能并发执行', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const exec = executor({ waitForTask: async () => { await gate; return { status: 'completed' }; } });

  const first = runs.runWorkflowInstance('i1', { executor: exec });
  const second = await runs.runWorkflowInstance('i1', { executor: exec });
  assert.equal(second.ok, false);
  assert.equal(second.error, 'already-running');

  release();
  assert.equal((await first).ok, true);
});

test('进度按已完成步骤统计', async () => {
  await runs.runWorkflowInstance('i1', { executor: executor() });
  const progress = runs.workflowInstanceProgress(runs.findWorkflowInstance('i1'));
  assert.deepEqual(progress, { completed: 2, total: 2, steps: ['completed', 'completed'] });
});

test('cancelWorkflowInstance 中止等待并标记取消', async () => {
  const exec = executor({
    waitForTask: (_taskId, signal) => new Promise((resolve) => {
      signal.addEventListener('abort', () => resolve({ status: 'cancelled', error: 'aborted' }));
    }),
  });
  const running = runs.runWorkflowInstance('i1', { executor: exec });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(runs.cancelWorkflowInstance('i1'), true);
  const result = await running;
  assert.equal(result.ok, false);
  assert.equal(runs.findWorkflowInstance('i1').status, 'cancelled');
  assert.equal(runs.findWorkflowInstance('i1').steps.s1.status, 'cancelled');
});

test('执行与回填不写入撤销历史', async () => {
  const { readSource } = await import('./helpers/sourceContract.mjs');
  const source = readSource('renderer/src/services/workflowRunService.ts');
  assert.doesNotMatch(source, /recordCanvasHistory|canvasHistoryStore/);
});
