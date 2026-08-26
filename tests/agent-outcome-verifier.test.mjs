import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyAgentOutcome } from '../renderer/src/agent/runtime/runtimeVerification.ts';

const receipt = (patch = {}) => ({
  callId: 'call-write',
  toolName: 'canvas_create_node',
  effect: 'canvas_write',
  success: true,
  applied: true,
  partial: false,
  skippedCount: 0,
  nodeIds: ['node-1'],
  taskIds: [],
  error: '',
  ...patch,
});

function verify(outcome, patch = {}) {
  return verifyAgentOutcome({
    project: {
      nodes: [{ id: 'node-1' }],
      tasks: [
        { id: 'task-done', status: 'completed' },
        { id: 'task-running', status: 'running' },
        { id: 'task-timeout', status: 'timeout' },
        { id: 'task-empty' },
      ],
    },
    outcome,
    hasAppliedActions: false,
    toolReceipts: new Map([['call-write', receipt()]]),
    ...patch,
  });
}

test('完成结果必须引用存在且成功的证据', () => {
  assert.deepEqual(verify({
    status: 'completed',
    summary: '已创建分镜节点',
    evidence: { nodeIds: ['node-1'], taskIds: ['task-done'], toolCallIds: ['call-write'] },
  }), { success: true, issues: [] });

  const invalid = verify({
    status: 'completed',
    summary: '已完成',
    evidence: { nodeIds: ['missing-node'], taskIds: ['task-running'], toolCallIds: ['missing-call'] },
  });
  assert.equal(invalid.success, false);
  assert.ok(invalid.issues.some((issue) => issue.includes('证据节点不存在')));
  assert.ok(invalid.issues.some((issue) => issue.includes('没有明确成功终态')));
  assert.ok(invalid.issues.some((issue) => issue.includes('工具调用未成功')));
});

test('只读调用和部分成功写入都不能证明项目完整完成', () => {
  const readOnly = receipt({
    callId: 'call-read', effect: 'read', applied: false, nodeIds: [], toolName: 'canvas_list_nodes',
  });
  const readResult = verify({
    status: 'completed', summary: '已完成', evidence: { toolCallIds: ['call-read'] },
  }, {
    hasAppliedActions: true,
    toolReceipts: new Map([['call-read', readOnly]]),
  });
  assert.equal(readResult.success, false);
  assert.ok(readResult.issues.some((issue) => issue.includes('完整成功的写入工具回执')));

  const partial = receipt({ partial: true, skippedCount: 1 });
  const partialResult = verify({
    status: 'completed', summary: '已完成', evidence: { toolCallIds: ['call-write'] },
  }, { hasAppliedActions: true, toolReceipts: new Map([['call-write', partial]]) });
  assert.equal(partialResult.success, false);
  assert.ok(partialResult.issues.some((issue) => issue.includes('仅部分成功')));
});

test('任务只有 completed 才能证明完成', () => {
  for (const taskId of ['task-running', 'task-timeout', 'task-empty']) {
    const result = verify({
      status: 'completed', summary: '任务已完成', evidence: { taskIds: [taskId] },
    });
    assert.equal(result.success, false);
    assert.ok(result.issues.some((issue) => issue.includes('没有明确成功终态')));
  }
});

test('修改过项目不能无证据声称完成', () => {
  const result = verify({ status: 'completed', summary: '已完成' }, { hasAppliedActions: true });
  assert.equal(result.success, false);
  assert.ok(result.issues.some((issue) => issue.includes('没有提供')));
});

test('部分完成和阻塞必须说明剩余事项', () => {
  assert.equal(verify({ status: 'blocked', summary: '缺少用户输入' }).success, false);
  assert.equal(verify({
    status: 'partial', summary: '已完成前两场', remaining: ['补全第三场角色设定'],
  }).success, true);
});

test('制作计划未完成时不能把整轮标记为完成', () => {
  const result = verify({ status: 'completed', summary: '已完成身份设计板' }, {
    productionPlan: {
      stages: [
        { id: 'identity', status: 'done' },
        { id: 'storyboard', status: 'doing' },
        { id: 'video', status: 'todo' },
      ],
    },
  });
  assert.equal(result.success, false);
  assert.ok(result.issues.some((issue) => issue.includes('2 个阶段未完成')));
});
