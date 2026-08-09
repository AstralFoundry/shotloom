import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compactInactiveCopilotSessions,
  copilotSessionLifecycleDiagnostics,
  expandCopilotArchivesForPersistence,
  restoreCopilotSession,
} from '../renderer/src/services/copilotSessionLifecycle.mjs';

test('inactive copilot sessions compact in memory and persist with complete history', () => {
  const messages = Array.from({ length: 170 }, (_, index) => ({
    id: `m-${index}`,
    content: String(index),
  }));
  const project = {
    id: `project-session-lifecycle-${Date.now()}`,
    activeCopilotConversationId: 'active',
    copilotConversations: [
      { id: 'active', messages: [] },
      { id: 'inactive', messages },
    ],
  };
  assert.deepEqual(compactInactiveCopilotSessions(project), {
    compacted: 1,
    removedObjects: 90,
  });
  assert.equal(project.copilotConversations[1].messages.length, 80);
  assert.equal(copilotSessionLifecycleDiagnostics().archivedMessages >= 90, true);

  const persisted = expandCopilotArchivesForPersistence(structuredClone(project));
  assert.equal(persisted.copilotConversations[1].messages.length, 170);
  assert.equal(restoreCopilotSession(project, 'inactive'), 90);
  assert.equal(project.copilotConversations[1].messages.length, 170);
});
