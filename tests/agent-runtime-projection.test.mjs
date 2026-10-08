import test from 'node:test';
import assert from 'node:assert/strict';
import { CopilotRuntimePresenter } from '../renderer/src/app/copilot/CopilotRuntimePresenter.ts';
import { artifactsForMessage } from '../renderer/src/app/copilot/copilotArtifacts.ts';

test('Copilot presenter owns runtime-to-message projection', () => {
  const presenter = new CopilotRuntimePresenter();
  assert.equal(presenter.consume({ type: 'text_delta', delta: '已完成' }).textChanged, true);
  const turn = presenter.consume({ type: 'turn_start', turn: 1, summary: '检查画布' });
  const tool = presenter.consume({
    type: 'tool_start', requestId: 'run-1', toolCallId: 'tool-1',
    toolName: 'canvas_create_node', inputSummary: '创建节点',
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

test('对话产物只记录成功写入，并在异步生成完成后关联真实资源节点', () => {
  const presenter = new CopilotRuntimePresenter();
  presenter.consume({ type: 'tool_end', toolCallId: 'read', receipt: {
    effect: 'read', success: true, applied: false, nodeIds: ['unrelated'], taskIds: [],
  } });
  presenter.consume({ type: 'tool_end', toolCallId: 'failed', receipt: {
    effect: 'canvas_write', success: false, applied: false, nodeIds: ['failed'], taskIds: [],
  } });
  presenter.consume({ type: 'tool_end', toolCallId: 'create', receipt: {
    effect: 'canvas_write', success: true, applied: true, nodeIds: ['source'], taskIds: [],
  } });
  presenter.consume({ type: 'tool_end', toolCallId: 'generate', receipt: {
    effect: 'media_generation', success: true, applied: true, nodeIds: [], taskIds: ['task-1'],
  } });
  const refs = presenter.snapshot().artifactRefs;
  assert.deepEqual(refs, { nodeIds: ['source'], taskIds: ['task-1'] });
  const nodes = [
    { id: 'source', type: 'imageGeneration', title: '商品主图' },
    { id: 'unrelated', type: 'resource', title: '旧图片', resourceType: 'image' },
    { id: 'output', type: 'resource', title: '商品主图.png', resourceType: 'image',
      filePath: '/project/assets/main.png', generatedFrom: { nodeId: 'source', taskId: 'task-1' } },
  ];
  assert.deepEqual(artifactsForMessage(refs, nodes).map((item) => item.nodeId), ['output']);
  assert.equal(artifactsForMessage(refs, nodes)[0].focusNodeId, 'source');
  assert.deepEqual(artifactsForMessage({ nodeIds: [], taskIds: ['task-1'] }, nodes)
    .map((item) => item.path), ['/project/assets/main.png']);
  const embedded = [{ id: 'source', type: 'imageGeneration', title: '商品主图',
    generatedOutputs: [{ id: 'embedded-output', title: '商品主图 2.png',
      resourceType: 'image', filePath: '/project/assets/second.png', taskId: 'task-2' }] }];
  assert.deepEqual(artifactsForMessage({ nodeIds: [], taskIds: ['task-2'] }, embedded)
    .map((item) => [item.nodeId, item.focusNodeId]), [['embedded-output', 'source']]);
});
