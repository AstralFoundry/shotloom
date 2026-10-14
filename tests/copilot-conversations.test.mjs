import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCopilotConversation,
  clearCopilotConversation,
  deleteCopilotConversation,
  ensureCopilotConversations,
  getActiveCopilotConversation,
  switchCopilotConversation,
  canvasCopilotConversation,
  editorCopilotConversation,
  scopedCopilotConversations,
} from '../renderer/src/services/copilotConversations.mjs';

test('清空会话同时丢弃模型可见历史', () => {
  const project = {};
  const active = getActiveCopilotConversation(project);
  active.messages.push({ id: 'old-message' });
  active.runtimeTranscript = [{ role: 'user', content: '上一轮' }];

  clearCopilotConversation(project, active.id);

  assert.deepEqual(active.messages, []);
  assert.equal(active.runtimeTranscript, undefined, '界面清空后模型也必须不再记得上一轮');
});

test('empty project gets one canonical conversation', () => {
  const project = {};
  ensureCopilotConversations(project);
  const active = getActiveCopilotConversation(project);
  assert.deepEqual(active.messages, []);
  assert.equal(active.agentMessages, undefined);
  assert.equal(project.activeCopilotConversationId, active.id);
});

test('reading an already normalized conversation is idempotent', () => {
  const project = {};
  ensureCopilotConversations(project);
  const conversations = project.copilotConversations;
  const active = getActiveCopilotConversation(project);
  assert.equal(project.copilotConversations, conversations);
  assert.equal(getActiveCopilotConversation(project), active);
  assert.equal(project.copilotConversations, conversations);
});

test('reading active conversation preserves the in-memory streaming reply', () => {
  const project = {};
  const active = getActiveCopilotConversation(project);
  const streaming = { id: 'streaming', role: 'assistant', content: '正在', transient: true };
  active.messages.push(streaming);

  const reread = getActiveCopilotConversation(project);

  assert.equal(reread.messages.length, 1);
  assert.equal(reread.messages[0], streaming);
  assert.equal(reread.messages[0].content, '正在');
});

test('switching conversations changes the canonical active conversation', () => {
  const project = {};
  const first = getActiveCopilotConversation(project);
  first.messages.push({ id: 'first' });
  const second = createCopilotConversation(project, { title: 'second' });
  second.messages.push({ id: 'second' });
  switchCopilotConversation(project, first.id);
  assert.deepEqual(getActiveCopilotConversation(project).messages, [{ id: 'first' }]);
  assert.notEqual(getActiveCopilotConversation(project).messages, second.messages);
});

test('deleting the active conversation selects a remaining conversation and clears its pending steps', () => {
  const project = {};
  const first = getActiveCopilotConversation(project);
  const second = createCopilotConversation(project, { title: 'second' });
  project.agentSteps = [
    { id: 'keep', conversationId: first.id },
    { id: 'remove', conversationId: second.id },
  ];

  deleteCopilotConversation(project, second.id);

  assert.equal(project.activeCopilotConversationId, first.id);
  assert.deepEqual(project.copilotConversations, [first]);
  assert.deepEqual(project.agentSteps, [{ id: 'keep', conversationId: first.id }]);
});

test('deleting the last conversation creates a fresh canonical conversation', () => {
  const project = {};
  const only = getActiveCopilotConversation(project);

  const replacement = deleteCopilotConversation(project, only.id);

  assert.equal(project.copilotConversations.length, 1);
  assert.equal(project.activeCopilotConversationId, replacement.id);
  assert.notEqual(replacement.id, only.id);
  assert.deepEqual(replacement.messages, []);
});

test('canvas scope hides editor conversations and lists newest first', () => {
  const project = {};
  const oldest = getActiveCopilotConversation(project);
  oldest.updatedAt = '2026-01-01T00:00:00.000Z';
  const newest = createCopilotConversation(project);
  newest.updatedAt = '2026-01-02T00:00:00.000Z';
  const editor = createCopilotConversation(project, { title: '剪辑 Agent' });
  editor.editorNodeId = 'node-editor';

  assert.deepEqual(
    scopedCopilotConversations(project, 'canvas').map((item) => item.id),
    [newest.id, oldest.id],
  );
  assert.deepEqual(
    scopedCopilotConversations(project, 'editor', 'node-editor').map((item) => item.id),
    [editor.id],
  );
  assert.deepEqual(scopedCopilotConversations(project, 'editor', 'node-other'), []);
  assert.deepEqual(scopedCopilotConversations(project, 'editor', ''), []);
});

test('canvas panel resolves its own conversation while the project pointer sits on an editor conversation', () => {
  const project = {};
  const canvas = getActiveCopilotConversation(project);
  const editor = createCopilotConversation(project, { title: '剪辑 Agent' });
  editor.editorNodeId = 'node-editor';
  assert.equal(project.activeCopilotConversationId, editor.id);

  const resolved = canvasCopilotConversation(project);

  assert.equal(resolved.id, canvas.id);
  assert.notEqual(resolved.id, editor.id);
});

test('canvas scope creates a canonical conversation when only editor conversations remain', () => {
  const project = {};
  const canvas = getActiveCopilotConversation(project);
  const editor = createCopilotConversation(project, { title: '剪辑 Agent' });
  editor.editorNodeId = 'node-editor';
  project.copilotConversations = project.copilotConversations.filter(
    (item) => item.id !== canvas.id,
  );

  const resolved = canvasCopilotConversation(project);

  assert.equal(resolved.editorNodeId, undefined);
  assert.equal(project.activeCopilotConversationId, resolved.id);
  assert.equal(scopedCopilotConversations(project, 'canvas').length, 1);
});

test('editor scope creates one conversation per editor node and reuses it', () => {
  const project = {};
  getActiveCopilotConversation(project);

  const created = editorCopilotConversation(project, 'node-a');

  assert.equal(created.editorNodeId, 'node-a');
  assert.equal(created.title, '剪辑 Agent');
  assert.equal(editorCopilotConversation(project, 'node-a'), created);
  assert.notEqual(editorCopilotConversation(project, 'node-b').id, created.id);
});

test('会话记录显式携带所属 Agent，运行时的权限集合据此解析', () => {
  const project = {};
  const canvas = getActiveCopilotConversation(project);
  const editor = editorCopilotConversation(project, 'node-a');

  assert.equal(canvas.agentId, 'canvas-primary');
  assert.equal(editor.agentId, 'editor-primary');
  assert.equal(createCopilotConversation(project, { title: '新对话' }).agentId, 'canvas-primary');
});

test('历史会话缺少 agentId 时按作用域补齐', () => {
  const project = {
    copilotConversations: [
      { id: 'legacy-canvas', title: '旧对话', messages: [], updatedAt: '2026-01-01' },
      { id: 'legacy-editor', title: '剪辑 Agent', messages: [], editorNodeId: 'node-1', updatedAt: '2026-01-02' },
    ],
  };

  ensureCopilotConversations(project);

  assert.equal(project.copilotConversations[0].agentId, 'canvas-primary');
  assert.equal(project.copilotConversations[1].agentId, 'editor-primary');
});

test('clearing targets one conversation without touching the other scope', () => {
  const project = {};
  const canvas = getActiveCopilotConversation(project);
  const editor = editorCopilotConversation(project, 'node-editor');
  canvas.messages.push({ id: 'canvas-message' });
  editor.messages.push({ id: 'editor-message' });
  editor.runtimeTranscript = [{ role: 'user', content: '编辑器会话历史' }];
  assert.equal(project.activeCopilotConversationId, editor.id);

  clearCopilotConversation(project, canvas.id);

  assert.deepEqual(canvas.messages, []);
  assert.deepEqual(editor.messages, [{ id: 'editor-message' }]);
  assert.deepEqual(editor.runtimeTranscript, [{ role: 'user', content: '编辑器会话历史' }]);
});
