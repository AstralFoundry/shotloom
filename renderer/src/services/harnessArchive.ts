import { desktopApi } from './desktopApi';
import { cloudEnabled, cloudRequest } from './cloudRequest';

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
  if (!cloudEnabled && desktopApi.platform === 'browser') return Promise.resolve();
  const previous = archiveQueues.get(projectKey) || Promise.resolve();
  const task = previous.catch(() => {}).then(async () => {
    if (cloudEnabled) {
      await cloudRequest('/agent/sessions/archive', 'POST', { projectKey, sessionIds, archived });
      return;
    }
    await ensureHarnessReady();
    await desktopApi.harness.archiveSessions(projectKey, sessionIds, archived);
  });
  archiveQueues.set(projectKey, task);
  void task.finally(() => { if (archiveQueues.get(projectKey) === task) archiveQueues.delete(projectKey); }).catch(() => {});
  return task;
}
