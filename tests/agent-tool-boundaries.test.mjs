import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAgentToolPolicy } from '../renderer/src/agent/core/policyEngine.ts';
import {
  buildToolReceipt,
  receiptChangesProject,
  receiptProvesCompletion,
} from '../renderer/src/agent/runtime/toolReceipts.ts';

test('统一 Policy 在节点执行关闭时拒绝媒体生成但允许画布配置', () => {
  const context = { capabilities: { nodeExecution: false } };
  assert.equal(resolveAgentToolPolicy('read', context), 'allow');
  assert.equal(resolveAgentToolPolicy('canvas_write', context), 'allow');
  assert.equal(resolveAgentToolPolicy('media_generation', context), 'deny');
  assert.equal(resolveAgentToolPolicy('media_generation', {
    capabilities: { nodeExecution: true },
  }), 'allow');
});

test('结构化回执区分只读、完整写入和部分写入', () => {
  const read = buildToolReceipt('read-1', 'canvas_list_nodes', 'read', { success: true });
  assert.equal(receiptChangesProject(read), false);
  assert.equal(receiptProvesCompletion(read), false);

  const write = buildToolReceipt('write-1', 'canvas_create_node', 'canvas_write', {
    success: true,
    complete: true,
    appliedCount: 2,
    createdNodeIds: ['node-1', 'node-2'],
  });
  assert.equal(receiptChangesProject(write), true);
  assert.equal(receiptProvesCompletion(write), true);
  assert.deepEqual(write.nodeIds, ['node-1', 'node-2']);
  assert.deepEqual(write.edgeIds, []);

  const partial = buildToolReceipt('write-2', 'canvas_update_node', 'canvas_write', {
    success: true,
    partial: true,
    appliedCount: 1,
    skippedCount: 1,
  });
  assert.equal(receiptChangesProject(partial), true);
  assert.equal(receiptProvesCompletion(partial), false);
});

test('计划和 Skill 写入也属于必须提交终态的项目修改', () => {
  for (const toolName of ['plan_write', 'plan_patch_stage', 'plan_update_stage_state', 'save_skill_bundle']) {
    const receipt = buildToolReceipt(toolName, toolName, 'project_write', { success: true });
    assert.equal(receipt.applied, true);
    assert.equal(receiptProvesCompletion(receipt), true);
  }
});
