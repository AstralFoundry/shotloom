import test from 'node:test';
import assert from 'node:assert/strict';
import { CopilotRuntimePresenter } from '../renderer/src/app/copilot/CopilotRuntimePresenter.ts';

test('Copilot presenter owns runtime-to-message projection', () => {
  const presenter = new CopilotRuntimePresenter();
  assert.equal(presenter.consume({ type: 'text_delta', delta: '已完成' }).textChanged, true);
  const turn = presenter.consume({ type: 'turn_start', turn: 1, summary: '检查画布' });
  const tool = presenter.consume({
    type: 'tool_start', requestId: 'run-1', toolCallId: 'tool-1',
    toolName: 'mutate_canvas', inputSummary: '创建两个节点',
  });
  const pending = presenter.consume({
    type: 'interaction_requested', kind: 'tool_confirmation', requestId: 'run-1',
    interactionId: 'interaction-1', toolCallId: 'tool-1', stepId: 'step-1', title: '创建节点', actionCount: 2,
  });
  const question = presenter.consume({
    type: 'clarification_required', requestId: 'run-1', interactionId: 'question-1',
    questions: [{ id: 'ratio', question: '选择画幅', options: ['横屏', '竖屏'], multiple: false }],
  });

  assert.equal(presenter.streamed, '已完成');
  assert.equal(turn.messagePatch.agentTurnCount, 1);
  assert.equal(tool.messagePatch.toolCalls[0].status, 'running');
  assert.equal(pending.messagePatch.toolCalls[0].status, 'pending');
  assert.equal(pending.messagePatch.toolCalls[0].interactionId, 'interaction-1');
  assert.equal(question.messagePatch.clarifications[0].questions[0].id, 'ratio');
  assert.equal(pending.persist, true);
});
