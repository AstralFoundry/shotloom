import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileOrphanedNodeTaskState } from '../renderer/src/utils/taskStateReconciliation.mjs';

test('没有活跃任务时用当前模型最近的终态任务清理节点假运行状态', () => {
  const node = {
    id: 'node-1',
    model: 'video-model',
    status: 'running',
    progress: 0,
    error: '',
  };
  const tasks = [
    {
      id: 'latest-failure',
      nodeId: 'node-1',
      model: 'video-model',
      status: 'error',
      progress: 0,
      error: '供应商拒绝输入图片',
      startedAt: '2026-08-28T09:48:43.027Z',
    },
    {
      id: 'older-failure',
      nodeId: 'node-1',
      model: 'video-model',
      status: 'failed',
      progress: 30,
      error: '旧错误',
      startedAt: '2026-08-28T09:40:00.000Z',
    },
  ];

  assert.equal(reconcileOrphanedNodeTaskState(node, tasks), true);
  assert.deepEqual(
    { status: node.status, progress: node.progress, error: node.error },
    { status: 'error', progress: 0, error: '供应商拒绝输入图片' },
  );
});

test('存在活跃任务时不覆盖节点运行状态', () => {
  const node = { id: 'node-1', model: 'video-model', status: 'running', progress: 12, error: '' };
  const tasks = [{
    id: 'active-task',
    nodeId: 'node-1',
    model: 'video-model',
    status: 'queued',
    progress: 12,
    startedAt: '2026-08-28T09:50:00.000Z',
  }];

  assert.equal(reconcileOrphanedNodeTaskState(node, tasks), false);
  assert.equal(node.status, 'running');
  assert.equal(node.progress, 12);
});

test('旧模型任务不能污染当前模型节点状态', () => {
  const node = { id: 'node-1', model: 'new-model', status: 'running', progress: 50, error: '' };
  const tasks = [{
    id: 'old-model-task',
    nodeId: 'node-1',
    model: 'old-model',
    status: 'failed',
    progress: 25,
    error: '旧模型错误',
    startedAt: '2026-08-28T09:50:00.000Z',
  }];

  assert.equal(reconcileOrphanedNodeTaskState(node, tasks), true);
  assert.deepEqual(
    { status: node.status, progress: node.progress, error: node.error },
    { status: 'idle', progress: 0, error: '' },
  );
});
