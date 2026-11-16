import { assertAgentProject, getAgentProjectFenceKey } from './agentProjectIdentity';
import type { AgentToolContext } from '../agent/core/types';

type Frame = { frame: HTMLIFrameElement; request: string; result: string; ready: boolean; background: boolean; fenceKey: string };
const frames = new Map<string, Set<Frame>>();
const listeners = new Set<() => void>();
let revision = 0;
let launcher: ((nodeId?: string) => void) | undefined;
const pending = new Map<string, { source: Window; resultType: string; resolve(value: unknown): void; reject(error: Error): void; timer: number }>();
const changed = () => { revision++; listeners.forEach(listener => listener()); };
export const subscribeDirectorFrames = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const directorFramesRevision = () => revision;
function sceneFrame(nodeId?: string) {
  const entries = [...(frames.get(nodeId || '') || [])].filter(entry => entry.fenceKey === getAgentProjectFenceKey());
  return entries.find(entry => !entry.background) ?? entries[0];
}
export function directorDeskHasVisibleFrame(nodeId?: string) { return [...(frames.get(nodeId || '') || [])].some(entry => !entry.background && entry.fenceKey === getAgentProjectFenceKey()); }
export function registerDirectorDeskFrame(next: HTMLIFrameElement | null, protocol: { request: string; result: string }, nodeId?: string, options: { background?: boolean; ready?: boolean } = {}) {
  if (!next) return () => {};
  const key = nodeId || '';
  const source = next.contentWindow;
  const entry = { frame: next, fenceKey: getAgentProjectFenceKey(), ...protocol, background: options.background === true, ready: options.ready !== false };
  const entries = frames.get(key) ?? new Set<Frame>();
  entries.add(entry); frames.set(key, entries); changed();
  return () => {
    entries.delete(entry); if (!entries.size) frames.delete(key);
    for (const [id, request] of pending) if (request.source === source) {
      window.clearTimeout(request.timer); pending.delete(id);
      request.reject(new DirectorDeskError('导演台运行会话已关闭，请重新读取快照后继续'));
    }
    changed();
  };
}
export function markDirectorDeskReady(frame: HTMLIFrameElement | null) {
  for (const entries of frames.values()) for (const entry of entries) if (entry.frame === frame && !entry.ready) { entry.ready = true; changed(); }
}
export function directorDeskAvailable(nodeId?: string) { const entry = sceneFrame(nodeId); return Boolean(entry?.ready && entry.frame.contentWindow); }
export function registerDirectorDeskLauncher(next: (nodeId?: string) => void) { launcher = next; return () => { if (launcher === next) launcher = undefined; }; }
/** Preparing an exact bound scene never changes the user's route or selection. */
export async function prepareDirectorDesk(nodeId: string | undefined, context: AgentToolContext): Promise<void> {
  assertAgentProject(context.projectKey, context.projectInstanceId, context.projectGeneration);
  if (directorDeskAvailable(nodeId)) return;
  if (!launcher) throw new Error('导演台后台运行时尚未挂载，请稍后重试');
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return; settled = true;
      clearTimeout(timer); listeners.delete(check); context.signal.removeEventListener('abort', abort);
      if (error) reject(error); else resolve();
    };
    const check = () => {
      try { assertAgentProject(context.projectKey, context.projectInstanceId, context.projectGeneration); if (directorDeskAvailable(nodeId)) finish(); }
      catch (error) { finish(error as Error); }
    };
    const abort = () => finish(new Error('导演台准备已取消'));
    const timer = setTimeout(() => finish(new Error('导演台后台场景未能就绪，请重试')), 45000);
    listeners.add(check); context.signal.addEventListener('abort', abort, { once: true });
    if (context.signal.aborted) { abort(); return; }
    try { launcher!(nodeId); check(); } catch (error) { finish(error as Error); }
  });
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

export function runDirectorDeskCommand(operation: string, args: Record<string, unknown> = {}, nodeId?: string): Promise<unknown> {
  const entry = sceneFrame(nodeId);
  const target = entry?.ready ? entry.frame.contentWindow : null;
  if (!target || !entry) return Promise.reject(new DirectorDeskError('绑定的导演台场景尚未就绪', {
    hint: '通过 delegate_director 委派导演子 Agent，后台运行时会准备对应场景。',
  }));
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => { pending.delete(requestId); reject(new DirectorDeskError('导演台未响应，请检查场景是否已加载')); }, 20_000);
    pending.set(requestId, { source: target, resultType: entry.result, resolve, reject, timer });
    target.postMessage({ type: entry.request, payload: { requestId, operation, args } }, window.location.origin);
  });
}

if (typeof window !== 'undefined') window.addEventListener('message', event => {
  if (event.origin !== window.location.origin) return;
  const message = event.data as { type?: string; payload?: { requestId?: string; success?: boolean; result?: unknown; code?: string; error?: string; hint?: string; facts?: Record<string, unknown> } };
  if (!message?.payload?.requestId) return;
  const request = pending.get(message.payload.requestId);
  if (!request || event.source !== request.source || message.type !== request.resultType) return;
  window.clearTimeout(request.timer); pending.delete(message.payload.requestId);
  if (message.payload.success) request.resolve(message.payload.result);
  else request.reject(new DirectorDeskError(message.payload.error || '导演台操作失败', {
    ...(message.payload.code ? { code: message.payload.code } : {}),
    ...(message.payload.hint ? { hint: message.payload.hint } : {}),
    ...(message.payload.facts ? { facts: message.payload.facts } : {}),
  }));
});
