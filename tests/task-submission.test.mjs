/**
 * 提交幂等：同一次提交只产生一条任务，重试复用原编号，换内容则拒绝。
 *
 * 前半段是纯函数（编号格式、参数指纹、提交解析），后半段在真实 store 上跑
 * runNode/retryTask，确认接线没有把判断丢掉。
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

let env;
let submission;
let taskStore;
let store;
let settingsStore;

const storage = new Map();

before(async () => {
  env = await createRendererEnv({ storage, withWindow: true });
  submission = await env.load('domain/tasks/Submission');
  taskStore = await env.load('store/taskStore');
  ({ store } = await env.load('store/projectStore'));
  ({ settingsStore } = await env.load('store/settingsStore'));
});

after(async () => {
  await env?.dispose();
});

const MODEL = 'claude-sonnet-5-5';

function seedProject(tasks = []) {
  store.project = {
    ...store.project,
    id: 'project-submission',
    nodes: [{
      id: 'node-1',
      type: 'textGeneration',
      title: '旁白',
      status: 'idle',
      progress: 0,
      model: MODEL,
      prompt: '写一句旁白',
      config: {},
    }],
    edges: [],
    materials: [],
    assets: [],
    tasks,
  };
  settingsStore.providerConfigs = {
    anthropic: { apiKey: 'test-key', baseUrl: 'https://api.anthropic.com' },
  };
}

function textNode() {
  return store.project.nodes[0];
}

// ── 纯函数 ────────────────────────────────────────────────────────────────

test('提交编号保持 8–128 位合法字符，非法种子会被清洗', () => {
  assert.match(submission.createSubmissionId('a1b2c3d4-e5f6-7890-abcd-ef1234567890'), submission.SUBMISSION_ID_PATTERN);
  const long = submission.createSubmissionId('x'.repeat(300));
  assert.equal(long.length, 128);
  assert.ok(submission.SUBMISSION_ID_PATTERN.test(long));
  const short = submission.createSubmissionId('ab');
  assert.ok(submission.SUBMISSION_ID_PATTERN.test(short), short);
  const dirty = submission.createSubmissionId('任务 1/2#3');
  assert.ok(submission.SUBMISSION_ID_PATTERN.test(dirty), dirty);
});

test('参数指纹对键顺序不敏感，对值变化敏感', () => {
  const a = submission.submissionFingerprint({ prompt: '猫', size: '1024', nested: { x: 1, y: 2 } });
  const b = submission.submissionFingerprint({ nested: { y: 2, x: 1 }, size: '1024', prompt: '猫' });
  const c = submission.submissionFingerprint({ prompt: '狗', size: '1024', nested: { x: 1, y: 2 } });
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^fnv1a64:[0-9a-f]{16}$/);
});

test('提交解析：新建 / 复用进行中 / 复用已完成 / 重试 / 冲突', () => {
  const id = 'sub-12345678';
  const fp = submission.submissionFingerprint({ prompt: '猫' });

  assert.deepEqual(submission.resolveSubmission([], { submissionId: id }), { action: 'new' });
  assert.deepEqual(
    submission.resolveSubmission([{ id: 't1', status: 'running', submissionId: id }], { submissionId: id }),
    { action: 'reuse', task: { id: 't1', status: 'running', submissionId: id } },
  );
  assert.deepEqual(
    submission.resolveSubmission([{ id: 't1', status: 'completed', submissionId: id, requestFingerprint: fp, attempt: 1 }], { submissionId: id, fingerprint: fp }),
    { action: 'reuse', task: { id: 't1', status: 'completed', submissionId: id, requestFingerprint: fp, attempt: 1 } },
  );
  assert.deepEqual(
    submission.resolveSubmission([{ id: 't1', status: 'failed', submissionId: id, requestFingerprint: fp, attempt: 1 }], { submissionId: id, fingerprint: fp }),
    { action: 'retry', task: { id: 't1', status: 'failed', submissionId: id, requestFingerprint: fp, attempt: 1 }, attempt: 2 },
  );
  assert.deepEqual(
    submission.resolveSubmission([{ id: 't1', status: 'failed', submissionId: id, requestFingerprint: 'fnv1a64:0000000000000000' }], { submissionId: id, fingerprint: fp }),
    { action: 'conflict', task: { id: 't1', status: 'failed', submissionId: id, requestFingerprint: 'fnv1a64:0000000000000000' } },
  );
});

// ── 真实 store ────────────────────────────────────────────────────────────

test('进行中的同编号提交直接复用原任务，不再新建', () => {
  const running = {
    id: 'task-running',
    nodeId: 'node-1',
    status: 'running',
    submissionId: 'sub-existing-1',
    requestFingerprint: 'fnv1a64:1111111111111111',
    requestPayload: {},
  };
  seedProject([running]);

  const replay = taskStore.runNode(textNode(), { submissionId: 'sub-existing-1' });

  assert.equal(replay?.id, 'task-running');
  assert.equal(store.project.tasks.length, 1);
});

test('同编号换了参数时拒绝提交，不新增任务', () => {
  seedProject([{
    id: 'task-old',
    nodeId: 'node-1',
    status: 'failed',
    submissionId: 'sub-existing-2',
    requestFingerprint: 'fnv1a64:0000000000000000',
    attempt: 1,
    requestPayload: {},
  }]);

  const task = taskStore.runNode(textNode(), { submissionId: 'sub-existing-2' });

  assert.equal(task, null);
  assert.equal(store.project.tasks.length, 1);
  assert.match(String(textNode().error), /提交编号/);
});

test('失败重试复用原提交编号，attempt 递增', async () => {
  seedProject([]);
  const first = taskStore.runNode(textNode());
  assert.ok(first, '首次提交应创建任务');
  assert.ok(submission.SUBMISSION_ID_PATTERN.test(String(first.submissionId)));
  assert.match(String(first.requestFingerprint), /^fnv1a64:/);
  assert.equal(first.attempt, 1);

  await new Promise((resolve) => setTimeout(resolve, 0));
  first.status = 'error';
  textNode().status = 'error';

  const retried = taskStore.retryTask(first.id);
  assert.ok(retried, '失败任务应允许重试');
  assert.equal(retried.submissionId, first.submissionId);
  assert.equal(retried.attempt, 2);
  const roundTripped = JSON.parse(JSON.stringify(retried));
  assert.equal(roundTripped.submissionId, first.submissionId);
  assert.equal(roundTripped.requestFingerprint, first.requestFingerprint);
  assert.equal(store.project.tasks.filter((task) => task.submissionId === first.submissionId).length, 2);
});

test('不同提交编号即使内容相同也允许重新生成', () => {
  seedProject([]);
  const first = taskStore.runNode(textNode());
  const second = taskStore.runNode({ ...textNode(), status: 'idle' });
  assert.ok(first && second);
  assert.notEqual(first.submissionId, second.submissionId);
  assert.equal(store.project.tasks.length, 2);
});
