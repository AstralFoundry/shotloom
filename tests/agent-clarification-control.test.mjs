import assert from 'node:assert/strict';
import test from 'node:test';
import {
  submitAgentApproval,
  submitAgentClarification,
  waitForAgentApproval,
  waitForAgentClarification,
} from '../renderer/src/agent/runtime/runtimeInteractions.ts';

test('结构化澄清答案通过 interactionId 恢复同一次 Agent 运行', async () => {
  const controller = new AbortController();
  const waiting = waitForAgentClarification('interaction-answer', controller.signal);
  const answers = [{ questionId: 'scope', values: ['生成全片关键帧分镜'] }];
  assert.equal(submitAgentClarification('interaction-answer', answers, false), true);
  assert.deepEqual(await waiting, { answers, skipped: false });
  assert.equal(submitAgentClarification('interaction-answer', answers, false), false);
});

test('澄清支持跳过，并在 Agent 取消时停止等待', async () => {
  const skipController = new AbortController();
  const skipped = waitForAgentClarification('run-skip', skipController.signal);
  assert.equal(submitAgentClarification('run-skip', [], true), true);
  assert.deepEqual(await skipped, { answers: [], skipped: true });

  const abortController = new AbortController();
  const aborted = waitForAgentClarification('run-abort', abortController.signal);
  abortController.abort();
  await assert.rejects(aborted, { name: 'AbortError' });
});

test('工具确认用 runId 和 stepId 恢复原 Agent 运行', async () => {
  const controller = new AbortController();
  const waiting = waitForAgentApproval('run-approval', 'step-1', controller.signal);
  const result = { success: true, appliedCount: 2, createdNodeIds: ['node-a', 'node-b'] };

  assert.equal(submitAgentApproval('run-approval', 'step-1', { approved: true, result }), true);
  assert.deepEqual(await waiting, { approved: true, result });
  assert.equal(submitAgentApproval('run-approval', 'step-1', { approved: true, result }), false);
});

test('工具确认不会串到其他步骤，取消时终止等待', async () => {
  const controller = new AbortController();
  const waiting = waitForAgentApproval('run-approval', 'step-2', controller.signal);
  assert.equal(submitAgentApproval('run-approval', 'step-other', { approved: false }), false);
  controller.abort();
  await assert.rejects(waiting, { name: 'AbortError' });
});
