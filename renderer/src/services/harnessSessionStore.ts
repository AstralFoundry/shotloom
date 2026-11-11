import { t } from '@/i18n';
import { CANVAS_AGENT_ID, DIRECTOR_AGENT_ID, EDITOR_AGENT_ID, TEXT_AGENT_ID } from '../agent/agents/definitions';
const SCOPE_AGENT_IDS = { canvas: CANVAS_AGENT_ID, editor: EDITOR_AGENT_ID, text: TEXT_AGENT_ID, director: DIRECTOR_AGENT_ID };
export type ConversationScope = 'canvas' | 'editor' | 'text' | 'director';
/** Product association metadata only. SQLite session persistence owns conversation content. */
export interface HarnessSession {
  id?: string; title?: string; agentId?: string; editorNodeId?: string; textNodeId?: string;
  harnessSessionId?: string; updatedAt?: string; [key: string]: unknown;
}
export interface HarnessProject {
  id?: string; harnessSessions?: HarnessSession[]; activeHarnessSessionId?: string | undefined;
  [key: string]: unknown;
}
export interface CreateConversationOptions { title?: string; agentId?: string; editorNodeId?: string; textNodeId?: string }
function uid() { return crypto.randomUUID(); }
export function ensureHarnessSessions(project: HarnessProject | null | undefined): HarnessSession[] {
  if (!project || typeof project !== 'object') return [];
  const original = Array.isArray(project.harnessSessions) ? project.harnessSessions : [];
  let conversations = original.filter((item) => item && typeof item === 'object');
  if (!conversations.length) {
    const now = new Date().toISOString();
    conversations = [{
      id: uid(),
      title: t("ui.HarnessSessionToolbar.text.1b7abf96"),
      createdAt: now,
      updatedAt: now,
    }];
    project.harnessSessions = conversations;
  } else if (conversations.length !== original.length) {
    project.harnessSessions = conversations;
  }
  for (const conversation of conversations) {
    if (!conversation.id) conversation.id = uid();
    else if (typeof conversation.id !== 'string') conversation.id = String(conversation.id);
    // agentId 决定这个会话能使用哪个 Agent 的工具与 Skill 集合，必须显式存在于记录上。
    if (!conversation.agentId) {
      conversation.agentId = conversation.textNodeId
        ? SCOPE_AGENT_IDS.text
        : conversation.editorNodeId ? SCOPE_AGENT_IDS.editor : SCOPE_AGENT_IDS.canvas;
    }
    const title = String(conversation.title || t("ui.HarnessSessionToolbar.text.1b7abf96")).slice(0, 80);
    if (conversation.title !== title) conversation.title = title;
    delete conversation.mode;

  }
  const first = conversations[0];
  if (first && !conversations.some((item) => item.id === project.activeHarnessSessionId)) {
    project.activeHarnessSessionId = first.id;
  }
  // 调用方（create/switch/delete/clear）必须改动 project 上的规范数组本身，
  // 而不是 ensure 过滤后的副本，否则新会话不会出现在项目数据里。
  return Array.isArray(project.harnessSessions) ? project.harnessSessions : conversations;
}

export function getActiveHarnessSession(project: HarnessProject): HarnessSession | null {
  const conversations = ensureHarnessSessions(project);
  return conversations.find((item) => item.id === project.activeHarnessSessionId) || conversations[0] || null;
}

// 画布、每个剪辑工作区和每个文本编辑器各自拥有独立会话，互不可见。project.activeHarnessSessionId
// 只是项目级的“最近所在会话”指针，不能用来判断某个面板该显示哪个会话，否则剪辑会话会
// 抢走画布面板的消息归属。作用域解析必须由这里统一决定。
export function scopedHarnessSessions(
  project: HarnessProject,
  scope: ConversationScope = 'canvas',
  boundNodeId = '',
): HarnessSession[] {
  const conversations = ensureHarnessSessions(project);
  const nodeId = String(boundNodeId || '');
  if (scope === 'editor') {
    if (!nodeId) return [];
    return conversations.filter((item) => String(item.editorNodeId || '') === nodeId);
  }
  if (scope === 'text') {
    if (!nodeId) return [];
    return conversations.filter((item) => String(item.textNodeId || '') === nodeId);
  }
  if (scope === 'director') return conversations.filter(item => item.agentId === DIRECTOR_AGENT_ID);
  // 工作区会话（剪辑、文本）不属于画布列表，否则会在画布历史抽屉里互相污染。
  return conversations
    .filter((item) => !item.editorNodeId && !item.textNodeId && item.agentId !== DIRECTOR_AGENT_ID)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

export function directorHarnessSession(project: HarnessProject): HarnessSession {
  return scopedHarnessSessions(project, 'director')[0] || createHarnessSession(project, { agentId: DIRECTOR_AGENT_ID, title: '3D 导演台 Agent' });
}

// 画布作用域的活动会话。画布面板必须始终落在画布会话上：即使项目级指针指向剪辑会话，
// 也不能让画布面板读写剪辑会话。
export function canvasHarnessSession(project: HarnessProject): HarnessSession {
  const conversations = scopedHarnessSessions(project, 'canvas');
  const active = conversations.find((item) => item.id === project.activeHarnessSessionId);
  if (active) return active;
  const first = conversations[0];
  if (first) return first;
  return createHarnessSession(project);
}

// 剪辑作用域的活动会话。一个剪辑工作区可创建多个独立会话，缺省读取第一个，
// 使面板读取与发送指向同一个会话。
export function editorHarnessSession(project: HarnessProject, editorNodeId: string): HarnessSession {
  const nodeId = String(editorNodeId || '');
  const conversations = scopedHarnessSessions(project, 'editor', nodeId);
  const first = conversations[0];
  if (!nodeId) return first || getActiveHarnessSession(project) || createHarnessSession(project);
  if (first) return first;
  return createHarnessSession(project, {
    title: t("ui.harnessSessionStore.title.b180b335"), agentId: SCOPE_AGENT_IDS.editor, editorNodeId: nodeId,
  });
}

// 文本编辑器作用域。一个文本节点可创建多个独立会话，缺省读取第一个，
// 使面板读取与发送指向同一个会话。
export function textHarnessSession(project: HarnessProject, textNodeId: string): HarnessSession {
  const nodeId = String(textNodeId || '');
  const conversations = scopedHarnessSessions(project, 'text', nodeId);
  const first = conversations[0];
  if (!nodeId) return first || getActiveHarnessSession(project) || createHarnessSession(project);
  if (first) return first;
  return createHarnessSession(project, {
    title: t("ui.harnessSessionStore.title.5f3a1ff2"), agentId: SCOPE_AGENT_IDS.text, textNodeId: nodeId,
  });
}

export function createHarnessSession(project: HarnessProject, options: CreateConversationOptions = {}): HarnessSession {
  const canonical = ensureHarnessSessions(project);
  const now = new Date().toISOString();
  const conversation: HarnessSession = {
    id: uid(),
    title: String(options.title || t("ui.HarnessSessionToolbar.text.1b7abf96")).slice(0, 80),
    agentId: String(options.agentId || SCOPE_AGENT_IDS.canvas),
    // 工作区会话在建立时就绑定所属节点，避免先落成画布会话再改作用域。
    ...(options.editorNodeId ? { editorNodeId: String(options.editorNodeId) } : {}),
    ...(options.textNodeId ? { textNodeId: String(options.textNodeId) } : {}),
    createdAt: now,
    updatedAt: now,
  };
  canonical.unshift(conversation);
  project.activeHarnessSessionId = conversation.id;
  return conversation;
}

