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

export function runDirectorDeskCommand(operation: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const target = frame?.contentWindow;
  if (!target) return Promise.reject(new Error('请先打开 3D 导演台画布'));
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(requestId);
      reject(new Error('导演台未响应，请检查画布是否已加载'));
    }, 20_000);
    pending.set(requestId, { resolve, reject, timer });
    target.postMessage({ type: requestType, payload: { requestId, operation, args } }, window.location.origin);
  });
}

if (typeof window !== 'undefined') window.addEventListener('message', event => {
  if (event.origin !== window.location.origin || event.source !== frame?.contentWindow) return;
  const message = event.data as { type?: string; payload?: { requestId?: string; success?: boolean; result?: unknown; error?: string } };
  if (message?.type !== resultType || !message.payload?.requestId) return;
  const request = pending.get(message.payload.requestId);
  if (!request) return;
  window.clearTimeout(request.timer);
  pending.delete(message.payload.requestId);
  if (message.payload.success) request.resolve(message.payload.result);
  else request.reject(new Error(message.payload.error || '导演台操作失败'));
});
