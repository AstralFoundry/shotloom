import { store } from '@/store/projectStore';

const ephemeralProjectKeys = new WeakMap<object, string>();
let ephemeralProjectSequence = 0;

/** Return the stable identity of the project currently mounted in the renderer. */
export function getAgentProjectKey(): string {
  if (!store.project || typeof store.project !== 'object') return 'no-project';
  const cached = ephemeralProjectKeys.get(store.project);
  if (cached) return cached;
  const persisted = store.filePath || store.projectDir || store.project?.id;
  ephemeralProjectKeys.set(store.project, persisted ? String(persisted) : `untitled:${++ephemeralProjectSequence}`);
  return ephemeralProjectKeys.get(store.project) || 'no-project';
}

export function assertAgentProject(expectedProjectKey?: string): string {
  const currentProjectKey = getAgentProjectKey();
  if (expectedProjectKey && expectedProjectKey !== currentProjectKey) {
    const error = new Error('Agent 操作所属项目已经切换，已停止运行以避免写入错误画布');
    error.name = 'AgentProjectChangedError';
    throw error;
  }
  return currentProjectKey;
}
