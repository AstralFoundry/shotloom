export interface AgentQueueMeta {
  sequence: number;
  waitedMs: number;
  depthAtStart: number;
  projectKey: string;
}

interface ProjectQueue {
  tail: Promise<unknown>;
  depth: number;
}

export class AgentProjectChangedError extends Error {
  readonly projectKey: string;

  constructor(projectKey: string) {
    super('Agent 操作所属项目已经切换，已拒绝执行以避免写入错误画布');
    this.name = 'AgentProjectChangedError';
    this.projectKey = projectKey;
  }
}

export function createAgentProjectQueue(getCurrentProjectKey: () => string) {
  const queues = new Map<string, ProjectQueue>();
  let sequence = 0;

  return {
    enqueue<T>(task: (meta: AgentQueueMeta) => Promise<T> | T): Promise<T> {
      const queuedAt = Date.now();
      const projectKey = getCurrentProjectKey();
      const queue = queues.get(projectKey) || { tail: Promise.resolve(), depth: 0 };
      const currentSequence = ++sequence;
      queue.depth += 1;
      const run = queue.tail.then(async () => {
        const meta = {
          sequence: currentSequence,
          waitedMs: Math.max(0, Date.now() - queuedAt),
          depthAtStart: queue.depth,
          projectKey,
        };
        if (getCurrentProjectKey() !== projectKey) throw new AgentProjectChangedError(projectKey);
        return task(meta);
      }).finally(() => {
        queue.depth = Math.max(0, queue.depth - 1);
        if (queue.depth === 0 && queues.get(projectKey) === queue) queues.delete(projectKey);
      });
      queue.tail = run.catch(() => undefined);
      queues.set(projectKey, queue);
      return run;
    },
    depth(projectKey = getCurrentProjectKey()): number {
      return queues.get(projectKey)?.depth || 0;
    },
  };
}
