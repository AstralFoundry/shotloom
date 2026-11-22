import { desktopApi } from './desktopApi';

const archiveQueues = new Map<string, Promise<void>>();

async function ensureHarnessReady(): Promise<void> {
  let status = await desktopApi.harness.start();
  const deadline = Date.now() + 30_000;
  while (!status.ready) {
    if (!status.running || Date.now() >= deadline) throw new Error(status.error || 'Agent Host is not ready');
    await new Promise(resolve => setTimeout(resolve, 100));
    status = await desktopApi.harness.status();
  }
}

/** Serialize archive changes so a quick undo cannot be overtaken by an older delete. */
export function setHarnessSessionsArchived(projectKey: string, sessionIds: string[] | undefined, archived: boolean): Promise<void> {
  if (desktopApi.platform === 'browser') return Promise.resolve();
  const previous = archiveQueues.get(projectKey) || Promise.resolve();
  const task = previous.catch(() => {}).then(async () => {
    await ensureHarnessReady();
    await desktopApi.harness.archiveSessions(projectKey, sessionIds, archived);
  });
  archiveQueues.set(projectKey, task);
  void task.finally(() => { if (archiveQueues.get(projectKey) === task) archiveQueues.delete(projectKey); }).catch(() => {});
  return task;
}

type DirectorDeleteProject = Pick<import('./harnessSessionStore').HarnessProject, 'pendingDirectorSessionDeletes'>;
const directorDeleteQueues = new WeakMap<DirectorDeleteProject, Promise<void>>();

/** Retry durable deletion receipts on reopen. An undone node gets a different conversation ID. */
export function flushDirectorSessionDeletes(project: DirectorDeleteProject, projectKey: string, onChange: () => void): Promise<void> {
  const queued = directorDeleteQueues.get(project);
  if (queued) return queued;
  if (!project.pendingDirectorSessionDeletes?.length || desktopApi.platform === 'browser') return Promise.resolve();
  const task = (async () => {
    await ensureHarnessReady();
    while (project.pendingDirectorSessionDeletes?.length) {
      const first = project.pendingDirectorSessionDeletes[0]!;
      const ids = project.pendingDirectorSessionDeletes.filter(item => item.nodeId === first.nodeId).map(item => item.conversationId);
      await desktopApi.harness.deleteDirectorSessions(projectKey, first.nodeId, ids);
      project.pendingDirectorSessionDeletes = project.pendingDirectorSessionDeletes.filter(item => !ids.includes(item.conversationId));
      onChange();
    }
  })();
  directorDeleteQueues.set(project, task);
  void task.finally(() => directorDeleteQueues.delete(project)).catch(() => {});
  return task;
}
