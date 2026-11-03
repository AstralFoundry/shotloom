import assert from 'node:assert/strict';
import test from 'node:test';
import { isRecord } from '../renderer/src/utils/typeGuards.ts';
import { isGenerationNodeType } from '../renderer/src/domain/graph/NodeType.ts';
import {
  isActiveTaskStatus, isFailedTaskStatus, isTerminalTaskStatus,
  RETRYABLE_TASK_STATUSES, statusLabel, statusTone,
} from '../renderer/src/domain/tasks/TaskStatus.ts';
import { assertNativeSnapshot } from '../renderer/src/domain/editor/NativeSnapshot.ts';

test('未知边界值区分记录、数组和空值，节点类型不隐式调用对象的字符串转换', () => {
  for (const value of [null, undefined, [], 'object', 0, () => {}]) assert.equal(isRecord(value), false);
  assert.equal(isRecord(Object.create(null)), true);
  assert.equal(isRecord({ id: 'node' }), true);
  assert.equal(isGenerationNodeType('videoGeneration'), true);
  assert.equal(isGenerationNodeType('clipStudio'), false);
  assert.equal(isGenerationNodeType({ toString: () => 'videoGeneration' }), false);
});

test('取消任务可重试但不计为失败，未知供应商状态不当作产品终态', () => {
  assert.equal(isTerminalTaskStatus('cancelled'), true);
  assert.equal(isFailedTaskStatus('cancelled'), false);
  assert.equal(RETRYABLE_TASK_STATUSES.has('cancelled'), true);
  assert.equal(RETRYABLE_TASK_STATUSES.has('completed'), false);
  for (const value of ['queued', 'running']) {
    assert.equal(isActiveTaskStatus(value), true);
    assert.equal(isTerminalTaskStatus(value), false);
  }
  assert.equal(isFailedTaskStatus('timeout'), true);
  assert.equal(isActiveTaskStatus('pending'), false);
  assert.equal(isTerminalTaskStatus('pending'), false);
  assert.equal(statusLabel('pending'), 'pending');
  assert.equal(statusTone('pending'), '');
  assert.equal(statusLabel('constructor'), 'constructor');
});

test('快照允许空时间线和厂商扩展，损坏的结构不能持久化', () => {
  const snapshot = {
    id: 'native', settings: { width: 1920, height: 1080 },
    timeline: { tracks: [] }, mediaLibrary: { items: [] }, vendorExtension: true,
  };
  assert.doesNotThrow(() => assertNativeSnapshot(snapshot));
  for (const invalid of [
    null, [], { ...snapshot, settings: { width: 0, height: 1080 } },
    { ...snapshot, timeline: { tracks: [null] } },
    { ...snapshot, timeline: { tracks: [{ id: 'track', clips: {} }] } },
    { ...snapshot, mediaLibrary: { items: {} } },
  ]) assert.throws(() => assertNativeSnapshot(invalid), /结构无效/);
});
