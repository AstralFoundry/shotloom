let frame: HTMLIFrameElement | null = null;
let navigate: ((view: 'director' | 'canvas') => boolean) | null = null;
let requestType = '';
let resultType = '';
const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void; timer: number }>();

export function registerDirectorDeskFrame(next: HTMLIFrameElement | null, protocol: { request: string; result: string }) {
  frame = next;
  requestType = protocol.request;
  resultType = protocol.result;
  return () => {
    if (frame === next) frame = null;
  };
}

export function directorDeskAvailable() { return Boolean(frame?.contentWindow); }

export function registerDirectorDeskNavigator(next: (view: 'director' | 'canvas') => boolean) {
  navigate = next;
  return () => { if (navigate === next) navigate = null; };
}

export function showDirectorDeskView(view: 'director' | 'canvas') {
  if (!navigate) return false;
  return navigate(view);
}

/**
 * 导演台命令的副作用分级，来自 iframe 命令表（vendor 侧 commandSpecs 的 kind）。
 * 每次 snapshot 后刷新；尚未读取时为空，调用方按写操作处理。
 */
const commandKinds = new Map<string, string>();

export function rememberDirectorCommandKinds(commands: unknown) {
  if (!Array.isArray(commands)) return;
  for (const entry of commands) {
    if (!entry || typeof entry !== 'object') continue;
    const { name, kind } = entry as { name?: unknown; kind?: unknown };
    if (typeof name === 'string' && typeof kind === 'string') commandKinds.set(name, kind);
  }
}

export function directorCommandKind(operation: string): string {
  return commandKinds.get(operation) || '';
}

export function directorCommandNames(): string[] {
  return [...commandKinds.keys()];
}

/** 首次 snapshot 前不知道有哪些命令，此时不做白名单校验，交给 iframe 判错。 */
export function directorCommandsKnown(): boolean {
  return commandKinds.size > 0;
}

/**
 * 导演台失败回执。`hint` 与 `facts` 是 iframe 给出的可执行线索：
 * 例如 revision 冲突时回执自带 `currentRevision`；调用方需重读快照核对内容，不能直接替换版本重放。
 */
export class DirectorDeskError extends Error {
  /** Stable machine-readable reason (`INVALID_PARAMS`, `BUSY`, `REVISION_MISMATCH`, …). */
  readonly code: string | undefined;
  readonly hint: string | undefined;
  readonly facts: Record<string, unknown> | undefined;

  constructor(message: string, options: { code?: string; hint?: string; facts?: Record<string, unknown> } = {}) {
    super(message);
    this.name = 'DirectorDeskError';
    this.code = options.code;
    this.hint = options.hint;
    this.facts = options.facts;
  }
}

export function runDirectorDeskCommand(operation: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const target = frame?.contentWindow;
  if (!target) return Promise.reject(new DirectorDeskError('请先打开 3D 导演台画布', {
    hint: '调用 director_workspace_view 的 view=director 打开导演台画布，再重试本操作。',
  }));
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(requestId);
      reject(new DirectorDeskError('导演台未响应，请检查画布是否已加载'));
    }, 20_000);
    pending.set(requestId, { resolve, reject, timer });
    target.postMessage({ type: requestType, payload: { requestId, operation, args } }, window.location.origin);
  });
}

if (typeof window !== 'undefined') window.addEventListener('message', event => {
  if (event.origin !== window.location.origin || event.source !== frame?.contentWindow) return;
  const message = event.data as {
    type?: string;
    payload?: { requestId?: string; success?: boolean; result?: unknown; code?: string; error?: string; hint?: string; facts?: Record<string, unknown> };
  };
  if (message?.type !== resultType || !message.payload?.requestId) return;
  const request = pending.get(message.payload.requestId);
  if (!request) return;
  window.clearTimeout(request.timer);
  pending.delete(message.payload.requestId);
  if (message.payload.success) request.resolve(message.payload.result);
  else request.reject(new DirectorDeskError(message.payload.error || '导演台操作失败', {
    ...(message.payload.code ? { code: message.payload.code } : {}),
    ...(message.payload.hint ? { hint: message.payload.hint } : {}),
    ...(message.payload.facts ? { facts: message.payload.facts } : {}),
  }));
});
