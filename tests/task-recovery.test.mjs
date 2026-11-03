import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { createRendererEnv } from './helpers/rendererSsr.mjs';

let env;
let taskStore;
let projectStore;
let normalization;

before(async () => {
  env = await createRendererEnv({ storage: new Map(), realTimers: true });
  taskStore = await env.load('store/taskStore');
  projectStore = await env.load('store/projectStore');
  normalization = await env.load('store/projectNormalization');
});

after(async () => {
  await env?.dispose();
});

function useTask(overrides = {}) {
  projectStore.store.project = {
    nodes: [{ id: 'node-1', type: 'videoGeneration', model: 'model-a' }],
    tasks: [{
      id: 'task-1',
      nodeId: 'node-1',
      type: 'videoGeneration',
      model: 'model-a',
      status: 'error',
      error: '模型网络请求失败：error sending request for url (https://provider.example/tasks)',
      remoteTaskId: '',
      retryCount: 0,
      maxRetries: 2,
      ...overrides,
    }],
  };
  return projectStore.store.project.tasks[0];
}

test('只有提交阶段失败的远程任务可以按厂商 ID 找回', () => {
  assert.equal(taskStore.canAdoptRemoteTask(useTask()), true);
  assert.equal(taskStore.canAdoptRemoteTask(useTask({ status: 'running' })), false);
  assert.equal(taskStore.canAdoptRemoteTask(useTask({ remoteTaskId: 'cgt-1' })), false);
  assert.equal(taskStore.canAdoptRemoteTask(useTask({ model: 'model-b' })), false);
  assert.equal(taskStore.canAdoptRemoteTask(useTask({ error: 'InputImageSensitiveContentDetected.PrivacyInformation' })), false);
});

test('重载以真实远端任务 ID 决定恢复，不依赖重复的 runner 标记', () => {
  const project = normalization.createProject('恢复测试');
  project.nodes = ['sync-node', 'async-node'].map((id) => ({ id, type: 'videoGeneration', status: 'running' }));
  const task = { id: 'sync', nodeId: 'sync-node', status: 'running', requestPayload: {} };
  project.tasks = [task, { ...task, id: 'async', nodeId: 'async-node', remoteTaskId: 'remote-1' }];
  const restored = normalization.normalizeProject(project);
  assert.equal(restored.tasks[0].status, 'error');
  assert.match(restored.tasks[0].error, /无法恢复/);
  assert.equal(restored.tasks[1].status, 'running');
  assert.equal(restored.tasks[1].remoteTaskId, 'remote-1');
  assert.equal(restored.nodes[0].status, 'error');
  assert.equal(restored.nodes[1].status, 'running');
});

test('找回入口先校验远程任务 ID，不会触发新生成', async () => {
  useTask();
  const invalid = await taskStore.adoptRemoteTask('task-1', 'bad id');
  assert.equal(invalid.success, false);
  assert.match(invalid.error, /格式无效/);

  const missingContract = await taskStore.adoptRemoteTask('task-1', 'cgt-2026');
  assert.equal(missingContract.success, false);
  assert.match(missingContract.error, /缺少远程轮询契约/);
});

test('英文提交失败与超时仍可找回，取消和参数错误不误报为可找回', () => {
  assert.equal(taskStore.canAdoptRemoteTask(useTask({ error: 'The model network request failed: socket closed' })), true);
  assert.equal(taskStore.canAdoptRemoteTask(useTask({ error: 'Remote model submission failed' })), true);
  assert.equal(taskStore.canAdoptRemoteTask(useTask({ error: 'Generation timed out (15000ms)' })), true);
  assert.equal(taskStore.canAdoptRemoteTask(useTask({ error: 'Task canceled' })), false);
  assert.equal(taskStore.canAdoptRemoteTask(useTask({ error: 'Failed to prepare generation request: invalid input' })), false);
});
