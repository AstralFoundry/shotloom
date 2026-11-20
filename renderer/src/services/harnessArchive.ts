const archiveQueues = new Map<string, Promise<void>>();

/** Serialize archive changes so a quick undo cannot be overtaken by an older delete. */
export function setHarnessSessionsArchived(projectKey: string, sessionIds: string[] | undefined, archived: boolean): Promise<void> {
  const previous = archiveQueues.get(projectKey) || Promise.resolve();
  const task = previous.catch(() => {}).then(async () => {
    // projectStore 自身会调用归档，延后加载 Worker 桥，避免初始化阶段形成 store 循环。
    const { archiveBrowserHarness } = await import('./browserHarnessTransport');
    await archiveBrowserHarness(projectKey, sessionIds, archived);
  });
  archiveQueues.set(projectKey, task);
  void task.finally(() => { if (archiveQueues.get(projectKey) === task) archiveQueues.delete(projectKey); }).catch(() => {});
  return task;
}
