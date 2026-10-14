import test from 'node:test';
import assert from 'node:assert/strict';
import { CopilotRuntimePresenter } from '../renderer/src/app/copilot/CopilotRuntimePresenter.ts';
import { artifactsForMessage } from '../renderer/src/app/agent-chat/artifactHelpers.ts';
import { traceGroups } from '../renderer/src/app/agent-chat/traceTimeline.ts';
import { agentTitle } from '../renderer/src/agent/agents/definitions.ts';

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

// 子 Agent 的派发、步骤与结论按执行者归属，父级后续步骤不会被并回派发前
test('子 Agent 的派发、步骤与结论按执行者归属，父级后续步骤不会被并回派发前', () => {
  const presenter = new CopilotRuntimePresenter();
  const root = 'run-1';
  const child = `${root}:sub:production-planner:abc`;
  presenter.consume({ type: 'tool_start', requestId: root, toolCallId: 'p1',
    toolName: 'canvas_list_nodes', agentId: 'canvas-primary', agentSessionId: root });
  presenter.consume({ type: 'subagent_started', requestId: root, parentRunId: root,
    childAgentId: 'production-planner', childSessionId: child,
    title: '制作规划：规划三个镜头', task: '规划三个镜头',
    agentId: 'canvas-primary', agentSessionId: root });
  presenter.consume({ type: 'tool_start', requestId: root, toolCallId: 'c1',
    toolName: 'canvas_get_node', agentId: 'production-planner', agentSessionId: child });
  presenter.consume({ type: 'tool_end', requestId: root, toolCallId: 'c1',
    toolName: 'canvas_get_node', agentId: 'production-planner', agentSessionId: child,
    receipt: { effect: 'read', success: true, display: { summary: '画布有 2 个节点' } } });
  presenter.consume({ type: 'subagent_completed', requestId: root, parentRunId: root,
    childAgentId: 'production-planner', childSessionId: child, summary: '已写入三镜头计划',
    agentId: 'canvas-primary', agentSessionId: root });
  presenter.consume({ type: 'tool_start', requestId: root, toolCallId: 'p2',
    toolName: 'canvas_create_node', agentId: 'canvas-primary', agentSessionId: root });

  const view = presenter.snapshot();
  const [branch] = view.subagents;
  assert.equal(branch.agentId, 'production-planner');
  assert.equal(branch.status, 'success');
  assert.equal(branch.task, '规划三个镜头');
  assert.equal(branch.summary, '已写入三镜头计划');

  const groups = traceGroups(view.toolCalls, view.subagents);
  assert.deepEqual(groups.map((group) => [
    group.subagent ? group.subagent.agentId : 'main',
    group.tools.map((tool) => tool.id),
  ]), [['main', ['p1']], ['production-planner', ['c1']], ['main', ['p2']]]);
});

test('并行时的上下文压缩按会话分开，子 Agent 的压缩不会盖掉父级那一条', () => {
  const presenter = new CopilotRuntimePresenter();
  presenter.consume({ type: 'context_compaction', status: 'completed',
    agentId: 'canvas-primary', agentSessionId: 'run-3' });
  presenter.consume({ type: 'context_compaction', status: 'running',
    agentId: 'stage-executor', agentSessionId: 'run-3:sub:stage-executor:x' });

  const rows = presenter.snapshot().toolCalls;
  assert.equal(rows.length, 2);
  assert.equal(rows[1].agentId, 'stage-executor');
  assert.equal(rows[1].status, 'running');
  assert.equal(rows[0].status, 'success');
});

// 事件没有上报 childAgentId 时身份确实未知：投影保留空串，由界面回落通用文案，
// 而不是挑一个 Agent 的名字冒充。
test('子任务的身份未知时不冒充，中断时未结束的工具与子任务一起结算', () => {
  const presenter = new CopilotRuntimePresenter();
  presenter.consume({ type: 'subagent_started', requestId: 'run-2', parentRunId: 'run-2',
    childSessionId: 'child-2', title: '并行任务' });
  presenter.consume({ type: 'tool_start', requestId: 'run-2', toolCallId: 't2',
    toolName: 'canvas_list_nodes', agentId: 'canvas-primary', agentSessionId: 'run-2' });

  const running = presenter.snapshot();
  assert.equal(running.subagents[0].agentId, '', '事件缺少子 Agent 身份时保持未知');
  assert.equal(agentTitle(''), '', '未知身份不能回落到某个具体 Agent 的名字');

  const settled = presenter.failRunning();
  assert.equal(settled.subagents[0].status, 'error');
  assert.equal(settled.toolCalls[0].status, 'error');
});
