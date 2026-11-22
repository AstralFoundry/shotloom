import { t } from '@/i18n';
import { CANVAS_AGENT_ID, EDITOR_AGENT_ID, TEXT_AGENT_ID, DIRECTOR_AGENT_ID, type AgentId } from '../agent/agents/definitions';
const SCOPE_AGENT_IDS = { canvas: CANVAS_AGENT_ID, editor: EDITOR_AGENT_ID, text: TEXT_AGENT_ID, director: DIRECTOR_AGENT_ID };
export type ConversationScope = keyof typeof SCOPE_AGENT_IDS;
const nodeFields = { editor: 'editorNodeId', text: 'textNodeId', director: 'directorNodeId' } as const;
export function harnessSessionScope(agentId: AgentId): ConversationScope {
  if (agentId === DIRECTOR_AGENT_ID) return 'director';
  if (agentId === EDITOR_AGENT_ID) return 'editor';
  if (agentId === TEXT_AGENT_ID) return 'text';
  return 'canvas';
}
export function harnessSessionOptions(scope: ConversationScope, nodeId?: string): CreateConversationOptions {
  return { agentId: SCOPE_AGENT_IDS[scope], ...(scope !== 'canvas' && nodeId && { [nodeFields[scope]]: nodeId }) };
}
/** Product association metadata only. SQLite session persistence owns conversation content. */
export interface HarnessSession {
  id?: string; title?: string; agentId?: string; editorNodeId?: string; textNodeId?: string; directorNodeId?: string;
  harnessSessionId?: string; updatedAt?: string; [key: string]: unknown;
}
export interface HarnessProject {
  id?: string; harnessSessions?: HarnessSession[]; trashedHarnessSessions?: HarnessSession[]; activeHarnessSessionId?: string | undefined;
  pendingDirectorSessionDeletes?: Array<{ nodeId: string; conversationId: string }>;
  [key: string]: unknown;
}
export interface CreateConversationOptions { title?: string; agentId?: string; editorNodeId?: string; textNodeId?: string; directorNodeId?: string }
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
      conversation.agentId = conversation.directorNodeId ? SCOPE_AGENT_IDS.director : conversation.textNodeId
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

export function boundHarnessNodeId(session: HarnessSession): string {
  return String(session.directorNodeId || session.textNodeId || session.editorNodeId || '');
}

export function removeDirectorHarnessSessions(project: HarnessProject, nodeId: string) {
  const matches = (session: HarnessSession) => session.agentId === DIRECTOR_AGENT_ID && session.directorNodeId === nodeId;
  const removed = [...(project.harnessSessions || []), ...(project.trashedHarnessSessions || [])].filter(matches);
  if (!removed.length) return;
  project.harnessSessions = (project.harnessSessions || []).filter(session => !matches(session));
  project.trashedHarnessSessions = (project.trashedHarnessSessions || []).filter(session => !matches(session));
  if (removed.some(session => session.id === project.activeHarnessSessionId)) project.activeHarnessSessionId = project.harnessSessions[0]?.id;
  const pending = project.pendingDirectorSessionDeletes || [];
  project.pendingDirectorSessionDeletes = [...pending, ...removed.flatMap(session =>
    session.id && !pending.some(item => item.conversationId === session.id) ? [{ nodeId, conversationId: session.id }] : [])];
}

/** Move node-owned conversations out of the active index while retaining their Host history for undo. */
export function trashBoundHarnessSessions(project: HarnessProject, nodeId: string): void {
  const active = ensureHarnessSessions(project);
  const removed = active.filter(session => boundHarnessNodeId(session) === nodeId);
  if (!removed.length) return;
  project.harnessSessions = active.filter(session => boundHarnessNodeId(session) !== nodeId);
  project.trashedHarnessSessions = [...(project.trashedHarnessSessions || []), ...removed];
  if (removed.some(session => session.id === project.activeHarnessSessionId)) {
    project.activeHarnessSessionId = project.harnessSessions[0]?.id;
  }
}

/** Canvas undo/redo restores or trashes only conversations whose node presence changed. */
export function reconcileBoundHarnessSessions(project: HarnessProject & { nodes?: Array<{ id: string }> }): void {
  const nodeIds = new Set((project.nodes || []).map(node => node.id));
  for (const session of [...(project.harnessSessions || []), ...(project.trashedHarnessSessions || [])]) {
    if (session.directorNodeId && !nodeIds.has(session.directorNodeId)) removeDirectorHarnessSessions(project, session.directorNodeId);
  }
  const active = ensureHarnessSessions(project);
  const trashed = project.trashedHarnessSessions || [];
  const isMissing = (session: HarnessSession) => {
    const id = boundHarnessNodeId(session);
    return id && id !== 'workspace-video-editor' && !nodeIds.has(id);
  };
  const restored = trashed.filter(session => !isMissing(session));
  const removed = active.filter(isMissing);
  if (!restored.length && !removed.length) return;
  project.harnessSessions = [...active.filter(session => !isMissing(session)), ...restored];
  project.trashedHarnessSessions = [...trashed.filter(isMissing), ...removed];
  if (removed.some(session => session.id === project.activeHarnessSessionId)) {
    project.activeHarnessSessionId = project.harnessSessions[0]?.id;
  }
}

// 画布、每个剪辑工作区和每个文本编辑器各自拥有独立会话，互不可见。project.activeHarnessSessionId
// 只是项目级的“最近所在会话”指针，不能用来判断某个面板该显示哪个会话，否则剪辑会话会
// 抢走画布面板的消息归属。作用域解析必须由这里统一决定。
export function scopedHarnessSessions(
  project: HarnessProject,
  scope: ConversationScope = 'canvas',
  boundNodeId = '',
): HarnessSession[] {
  const conversations = scope !== 'canvas' && !project.harnessSessions?.length ? [] : ensureHarnessSessions(project);
  const nodeId = String(boundNodeId || '');
  if (scope !== 'canvas') return nodeId ? conversations.filter(item =>
    item.agentId === SCOPE_AGENT_IDS[scope] && item[nodeFields[scope]] === nodeId) : [];
  return conversations
    .filter(item => item.agentId === SCOPE_AGENT_IDS.canvas && !boundHarnessNodeId(item))
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
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

export function directorHarnessSession(project: HarnessProject, nodeId: string): HarnessSession {
  if (!nodeId) throw new Error('A world engine session requires a node');
  return scopedHarnessSessions(project, 'director', nodeId)[0] ?? createHarnessSession(project, {
    ...harnessSessionOptions('director', nodeId), title: t('agent.role.director'),
  });
}

export function createHarnessSession(project: HarnessProject, options: CreateConversationOptions = {}): HarnessSession {
  // Creating the first scoped conversation must not also bootstrap an unrelated canvas conversation.
  const canonical = Array.isArray(project.harnessSessions) && project.harnessSessions.length
    ? ensureHarnessSessions(project) : (project.harnessSessions = []);
  const now = new Date().toISOString();
  const conversation: HarnessSession = {
    id: uid(),
    title: String(options.title || t("ui.HarnessSessionToolbar.text.1b7abf96")).slice(0, 80),
    agentId: String(options.agentId || SCOPE_AGENT_IDS.canvas),
    // 工作区会话在建立时就绑定所属节点，避免先落成画布会话再改作用域。
    ...(options.editorNodeId ? { editorNodeId: String(options.editorNodeId) } : {}),
    ...(options.textNodeId ? { textNodeId: String(options.textNodeId) } : {}),
    ...(options.directorNodeId ? { directorNodeId: String(options.directorNodeId) } : {}),
    createdAt: now,
    updatedAt: now,
  };
  canonical.unshift(conversation);
  project.activeHarnessSessionId = conversation.id;
  return conversation;
}

/** Remove one explicit conversation; node undo only restores node-owned trash, never a manually deleted chat. */
export function deleteHarnessSession(project: HarnessProject, id: string): HarnessSession | null {
  const sessions = ensureHarnessSessions(project);
  const deleted = sessions.find(session => session.id === id);
  if (!deleted) return null;
  project.harnessSessions = sessions.filter(session => session.id !== id);
  if (project.activeHarnessSessionId === id) project.activeHarnessSessionId = project.harnessSessions[0]?.id;
  return deleted;
}

