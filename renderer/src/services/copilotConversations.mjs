function uid() {
  return globalThis.crypto?.randomUUID?.() || `conversation-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// 会话归属的 Agent id。权威定义在 renderer/src/agent/agents/definitions.ts，
// 这里只保留作用域到 id 的映射，本模块是纯 JS 数据层，不反向依赖 Agent 运行时。
const SCOPE_AGENT_IDS = { canvas: 'canvas-primary', editor: 'editor-primary' };

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
    // agentId 决定这个会话能使用哪个 Agent 的工具与 Skill 集合，必须显式存在于记录上。
    if (!conversation.agentId) {
      conversation.agentId = conversation.editorNodeId ? SCOPE_AGENT_IDS.editor : SCOPE_AGENT_IDS.canvas;
    }
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

// 画布与每个剪辑工作区各自拥有独立会话，互不可见。project.activeCopilotConversationId
// 只是项目级的“最近所在会话”指针，不能用来判断某个面板该显示哪个会话，否则剪辑会话会
// 抢走画布面板的消息归属。作用域解析必须由这里统一决定。
export function scopedCopilotConversations(project, scope = 'canvas', editorNodeId = '') {
  const conversations = ensureCopilotConversations(project);
  const nodeId = String(editorNodeId || '');
  if (scope === 'text') {
    return conversations.filter((item) => String(item.textNodeId || '') === nodeId && item.agentId === 'text-primary');
  }
  if (scope === 'editor') {
    if (!nodeId) return [];
    return conversations.filter((item) => String(item.editorNodeId || '') === nodeId);
  }
  return conversations
    .filter((item) => !item.editorNodeId && !item.textNodeId)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

export function textCopilotConversation(project, textNodeId, preferredId = '') {
  const nodeId = String(textNodeId || '');
  if (!nodeId) return null;
  const conversations = ensureCopilotConversations(project);
  const existing = conversations.find((item) => item.id === preferredId && item.textNodeId === nodeId && item.agentId === 'text-primary')
    || conversations.find((item) => item.textNodeId === nodeId && item.agentId === 'text-primary');
  if (existing) return existing;
  const conversation = createCopilotConversation(project, { title: '文本 Agent', agentId: 'text-primary' });
  conversation.textNodeId = nodeId;
  return conversation;
}

// 画布作用域的活动会话。画布面板必须始终落在画布会话上：即使项目级指针指向剪辑会话，
// 也不能让画布面板读写剪辑会话。
export function canvasCopilotConversation(project) {
  const conversations = scopedCopilotConversations(project, 'canvas');
  const active = conversations.find((item) => item.id === project.activeCopilotConversationId);
  if (active) return active;
  if (conversations.length) return conversations[0];
  return createCopilotConversation(project);
}

// 剪辑作用域的活动会话。一个剪辑工作区同时只保留一个会话，首次读取即建立，
// 使面板读取与发送指向同一个会话。
export function editorCopilotConversation(project, editorNodeId) {
  const nodeId = String(editorNodeId || '');
  const conversations = scopedCopilotConversations(project, 'editor', nodeId);
  if (!nodeId) return conversations[0] || getActiveCopilotConversation(project);
  if (conversations.length) return conversations[0];
  const conversation = createCopilotConversation(project, { title: '剪辑 Agent', agentId: SCOPE_AGENT_IDS.editor });
  conversation.editorNodeId = nodeId;
  return conversation;
}

export function createCopilotConversation(project, options = {}) {
  ensureCopilotConversations(project);
  const now = new Date().toISOString();
  const conversation = {
    id: uid(),
    title: String(options.title || '新对话').slice(0, 80),
    agentId: String(options.agentId || SCOPE_AGENT_IDS.canvas),
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

// 清空必须按目标会话执行：画布面板与剪辑面板的“清空当前会话”各自只影响自己的作用域。
// 目标 id 缺失或失效时退回项目级活动会话，避免清错另一个作用域的会话。
export function clearCopilotConversation(project, conversationId) {
  const conversations = ensureCopilotConversations(project);
  const requested = String(conversationId || '');
  const conversation = conversations.find((item) => item.id === requested)
    || getActiveCopilotConversation(project);
  conversation.messages = [];
  delete conversation.agentMessages;
  // runtimeTranscript 是自研 Agent loop 写给模型的可见历史；界面清空时它必须一起消失，
  // 否则对话框空了而模型仍记得上一轮。ensure 不会删除它，只有清空才删。
  delete conversation.runtimeTranscript;
  conversation.contextUsage = null;
  conversation.updatedAt = new Date().toISOString();
  return conversation;
}

export function titleConversationFromMessage(conversation, message) {
  if (!conversation || conversation.title !== '新对话') return;
  const title = String(message || '').replace(/\s+/g, ' ').trim();
  if (title) conversation.title = title.slice(0, 28);
}
