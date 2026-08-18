const archives = new Map();
const DEFAULT_KEEP_COUNT = 80;
const DEFAULT_MIN_COUNT = 160;
const MAX_ARCHIVED_SESSIONS = 100;

const keyFor = (projectId, conversationId) => `${projectId}:${conversationId}`;

function parseArchive(key) {
  const serialized = archives.get(key);
  if (!serialized) return [];
  try {
    const value = JSON.parse(serialized);
    return Array.isArray(value) ? value : [];
  } catch {
    archives.delete(key);
    return [];
  }
}

function mergeMessages(archived, current) {
  const merged = [];
  const seen = new Set();
  for (const message of [...archived, ...current]) {
    const id = String(message?.id || '');
    const identity = id || JSON.stringify([message?.createdAt, message?.role, message?.content]);
    if (seen.has(identity)) continue;
    seen.add(identity);
    merged.push(message);
  }
  return merged;
}

export function compactInactiveCopilotSessions(
  project,
  { keepCount = DEFAULT_KEEP_COUNT, minCount = DEFAULT_MIN_COUNT } = {},
) {
  if (!project?.id || !Array.isArray(project.copilotConversations)) {
    return { compacted: 0, removedObjects: 0 };
  }
  let compacted = 0;
  let removedObjects = 0;
  for (const conversation of project.copilotConversations) {
    if (conversation.id === project.activeCopilotConversationId) continue;
    if (!Array.isArray(conversation.messages) || conversation.messages.length < minCount) continue;
    const splitAt = Math.max(0, conversation.messages.length - keepCount);
    const oldMessages = conversation.messages.slice(0, splitAt);
    const recentMessages = conversation.messages.slice(splitAt);
    const key = keyFor(project.id, conversation.id);
    const archived = mergeMessages(parseArchive(key), oldMessages);
    archives.set(key, JSON.stringify(archived));
    while (archives.size > MAX_ARCHIVED_SESSIONS) {
      archives.delete(archives.keys().next().value);
    }
    conversation.messages = recentMessages;
    conversation.archivedMessageCount = archived.length;
    compacted += 1;
    removedObjects += oldMessages.length;
  }
  return { compacted, removedObjects };
}

export function restoreCopilotSession(project, conversationId) {
  if (!project?.id || !Array.isArray(project.copilotConversations)) return 0;
  const conversation = project.copilotConversations.find((item) => item.id === conversationId);
  if (!conversation) return 0;
  const key = keyFor(project.id, conversationId);
  const archived = parseArchive(key);
  if (!archived.length) return 0;
  conversation.messages = mergeMessages(
    archived,
    Array.isArray(conversation.messages) ? conversation.messages : [],
  );
  delete conversation.archivedMessageCount;
  archives.delete(key);
  return archived.length;
}

export function expandCopilotArchivesForPersistence(projectSnapshot) {
  if (!projectSnapshot?.id || !Array.isArray(projectSnapshot.copilotConversations)) {
    return projectSnapshot;
  }
  for (const conversation of projectSnapshot.copilotConversations) {
    const archived = parseArchive(keyFor(projectSnapshot.id, conversation.id));
    if (!archived.length) continue;
    conversation.messages = mergeMessages(
      archived,
      Array.isArray(conversation.messages) ? conversation.messages : [],
    );
    delete conversation.archivedMessageCount;
  }
  return projectSnapshot;
}

export function copilotSessionLifecycleDiagnostics() {
  let archivedMessages = 0;
  for (const key of archives.keys()) archivedMessages += parseArchive(key).length;
  return { archivedSessions: archives.size, archivedMessages };
}

export function dropCopilotSessionArchive(projectId, conversationId) {
  return archives.delete(keyFor(projectId, conversationId));
}
