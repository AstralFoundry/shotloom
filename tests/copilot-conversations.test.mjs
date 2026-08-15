import test from "node:test";
import assert from "node:assert/strict";
import {
  createCopilotConversation,
  clearActiveCopilotConversation,
  deleteCopilotConversation,
  ensureCopilotConversations,
  getActiveCopilotConversation,
  switchCopilotConversation,
} from "../renderer/src/services/copilotConversations.mjs";

test("empty project gets one canonical conversation", () => {
  const project = {};
  ensureCopilotConversations(project);
  const active = getActiveCopilotConversation(project);
  assert.deepEqual(active.messages, []);
  assert.equal(active.agentMessages, undefined);
  assert.equal(project.activeCopilotConversationId, active.id);
});

test("reading an already normalized conversation is idempotent", () => {
  const project = {};
  ensureCopilotConversations(project);
  const conversations = project.copilotConversations;
  const active = getActiveCopilotConversation(project);
  assert.equal(project.copilotConversations, conversations);
  assert.equal(getActiveCopilotConversation(project), active);
  assert.equal(project.copilotConversations, conversations);
});

test("reading active conversation preserves the in-memory streaming reply", () => {
  const project = {};
  const active = getActiveCopilotConversation(project);
  const streaming = {
    id: "streaming",
    role: "assistant",
    content: "正在",
    transient: true,
  };
  active.messages.push(streaming);

  const reread = getActiveCopilotConversation(project);

  assert.equal(reread.messages.length, 1);
  assert.equal(reread.messages[0], streaming);
  assert.equal(reread.messages[0].content, "正在");
});

test("clearing a conversation also starts a fresh Runtime session", () => {
  const project = {};
  const active = getActiveCopilotConversation(project);
  active.messages.push({ id: "old-message" });
  active.openCodeSessionId = "ses_old";

  clearActiveCopilotConversation(project);

  assert.deepEqual(active.messages, []);
  assert.equal(active.openCodeSessionId, undefined);
});

test("switching conversations changes the canonical active conversation", () => {
  const project = {};
  const first = getActiveCopilotConversation(project);
  first.messages.push({ id: "first" });
  const second = createCopilotConversation(project, { title: "second" });
  second.messages.push({ id: "second" });
  switchCopilotConversation(project, first.id);
  assert.deepEqual(getActiveCopilotConversation(project).messages, [
    { id: "first" },
  ]);
  assert.notEqual(
    getActiveCopilotConversation(project).messages,
    second.messages,
  );
});

test("deleting the active conversation selects a remaining conversation and clears its pending steps", () => {
  const project = {};
  const first = getActiveCopilotConversation(project);
  const second = createCopilotConversation(project, { title: "second" });
  project.agentSteps = [
    { id: "keep", conversationId: first.id },
    { id: "remove", conversationId: second.id },
  ];

  deleteCopilotConversation(project, second.id);

  assert.equal(project.activeCopilotConversationId, first.id);
  assert.deepEqual(project.copilotConversations, [first]);
  assert.deepEqual(project.agentSteps, [
    { id: "keep", conversationId: first.id },
  ]);
});

test("deleting the last conversation creates a fresh canonical conversation", () => {
  const project = {};
  const only = getActiveCopilotConversation(project);

  const replacement = deleteCopilotConversation(project, only.id);

  assert.equal(project.copilotConversations.length, 1);
  assert.equal(project.activeCopilotConversationId, replacement.id);
  assert.notEqual(replacement.id, only.id);
  assert.deepEqual(replacement.messages, []);
});
