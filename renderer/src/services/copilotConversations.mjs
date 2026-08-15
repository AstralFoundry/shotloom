function uid() {
  return globalThis.crypto?.randomUUID?.() || `conversation-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function ensureCopilotConversations(project) {
  if (!project || typeof project !== 'object') return [];
  const original = Array.isArray(project.copilotConversations) ? project.copilotConversations : [];
  let conversations = original.filter((item) => item && typeof item === 'object');
  if (!conversations.length) {
    const now = new Date().toISOString();
    conversations = [{
      id: uid(),
      title: '新对话',
      messages: [],
      contextUsage: null,
      createdAt: now,
      updatedAt: now,
    }];
    project.copilotConversations = conversations;
  } else if (conversations.length !== original.length) {
    project.copilotConversations = conversations;
  }
  for (const conversation of conversations) {
    if (!conversation.id) conversation.id = uid();
    else if (typeof conversation.id !== 'string') conversation.id = String(conversation.id);
    const title = String(conversation.title || '新对话').slice(0, 80);
    if (conversation.title !== title) conversation.title = title;
    delete conversation.mode;
    // transient 消息属于当前 WebView 的运行中状态。这里只规范结构，不能在每次
    // getActiveCopilotConversation() 时删除，否则流式回复框会在首个 delta 前消失。
    // 落盘快照会在 projectStore.projectPersistenceSnapshot() 中单独过滤 transient。
    if (!Array.isArray(conversation.messages)) conversation.messages = [];
    delete conversation.agentMessages;
  }
  if (!conversations.some((item) => item.id === project.activeCopilotConversationId)) {
    project.activeCopilotConversationId = conversations[0].id;
  }
  return conversations;
}

export function getActiveCopilotConversation(project) {
  const conversations = ensureCopilotConversations(project);
  return conversations.find((item) => item.id === project.activeCopilotConversationId) || conversations[0];
}

export function createCopilotConversation(project, options = {}) {
  ensureCopilotConversations(project);
  const now = new Date().toISOString();
  const conversation = {
    id: uid(),
    title: String(options.title || '新对话').slice(0, 80),
    messages: [],
    contextUsage: null,
    createdAt: now,
    updatedAt: now,
  };
  project.copilotConversations.unshift(conversation);
  project.activeCopilotConversationId = conversation.id;
  return conversation;
}

export function switchCopilotConversation(project, conversationId) {
  ensureCopilotConversations(project);
  if (!project.copilotConversations.some((item) => item.id === conversationId)) return null;
  project.activeCopilotConversationId = conversationId;
  return getActiveCopilotConversation(project);
}

export function deleteCopilotConversation(project, conversationId) {
  ensureCopilotConversations(project);
  const id = String(conversationId || '');
  const index = project.copilotConversations.findIndex((item) => item.id === id);
  if (index < 0) return null;

  const deletingActive = project.activeCopilotConversationId === id;
  project.copilotConversations.splice(index, 1);
  if (Array.isArray(project.agentSteps)) {
    project.agentSteps = project.agentSteps.filter((step) => String(step?.conversationId || '') !== id);
  }

  if (!project.copilotConversations.length) {
    project.activeCopilotConversationId = '';
    return getActiveCopilotConversation(project);
  }
  if (deletingActive) {
    const nextIndex = Math.min(index, project.copilotConversations.length - 1);
    project.activeCopilotConversationId = project.copilotConversations[nextIndex].id;
  }
  return getActiveCopilotConversation(project);
}

export function clearActiveCopilotConversation(project) {
  const active = getActiveCopilotConversation(project);
  active.messages = [];
  delete active.agentMessages;
  delete active.openCodeSessionId;
  active.contextUsage = null;
  active.updatedAt = new Date().toISOString();
  return active;
}

export function titleConversationFromMessage(conversation, message) {
  if (!conversation || conversation.title !== '新对话') return;
  const title = String(message || '').replace(/\s+/g, ' ').trim();
  if (title) conversation.title = title.slice(0, 28);
}
