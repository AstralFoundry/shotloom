import { store } from '@/store/projectStore';

export interface AgentProjectIdentity {
  projectKey: string;
  instanceId: string;
  generation: number;
  fenceKey: string;
}

const ephemeralProjectIdentities = new WeakMap<object, AgentProjectIdentity>();
let ephemeralProjectSequence = 0;
let projectGeneration = 0;

function newInstanceId() {
  return globalThis.crypto?.randomUUID?.()
    || `instance-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function getAgentProjectIdentity(): AgentProjectIdentity {
  if (!store.project || typeof store.project !== 'object') {
    return { projectKey: 'no-project', instanceId: 'none', generation: 0, fenceKey: 'no-project:none:0' };
  }
  const cached = ephemeralProjectIdentities.get(store.project);
  if (cached) return cached;
  const persisted = store.filePath || store.projectDir || store.project?.id;
  const projectKey = persisted ? String(persisted) : `untitled:${++ephemeralProjectSequence}`;
  const identity = {
    projectKey,
    instanceId: newInstanceId(),
    generation: ++projectGeneration,
    fenceKey: '',
  };
  identity.fenceKey = `${identity.projectKey}:${identity.instanceId}:${identity.generation}`;
  ephemeralProjectIdentities.set(store.project, identity);
  return identity;
}

/** Return the stable identity of the project currently mounted in the renderer. */
export function getAgentProjectKey(): string {
  return getAgentProjectIdentity().projectKey;
}

export function getAgentProjectFenceKey(): string {
  return getAgentProjectIdentity().fenceKey;
}

export function assertAgentProject(
  expectedProjectKey?: string,
  expectedInstanceId?: string,
  expectedGeneration?: number,
): string {
  const current = getAgentProjectIdentity();
  if ((expectedProjectKey && expectedProjectKey !== current.projectKey)
    || (expectedInstanceId && expectedInstanceId !== current.instanceId)
    || (expectedGeneration != null && expectedGeneration !== current.generation)) {
    const error = new Error('Agent 操作所属项目已经切换，已停止运行以避免写入错误画布');
    error.name = 'AgentProjectChangedError';
    throw error;
  }
  return current.projectKey;
}
