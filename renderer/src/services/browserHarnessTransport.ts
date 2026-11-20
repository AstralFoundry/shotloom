import { t } from '../i18n/index.ts';
import { cloudEnabled, cloudOrigin, cloudUserHeaders, readCloudSession, verifyCloudSession } from './cloudRequest';
import { getAgentProjectIdentity } from './agentProjectIdentity';
import { subscribeDomain } from '../store/domainReactivity';
import type { executeProductRequest } from './harnessProductTools';

interface TransportEvent { requestId: string; kind: string; value?: unknown; error?: string }
type ToolRequest = Parameters<typeof executeProductRequest>[0];
type Reply = { resolve(value: unknown): void; reject(error: Error): void };
let active: { worker: Worker; project: string; user: string; pending: Map<string, Reply>; listeners: Map<string, (event: TransportEvent) => void>; controllers: Map<string, AbortController>; dispose(): void } | undefined;
let connecting: Promise<void> | undefined;
let toolHandler: ((request: ToolRequest) => Promise<void>) | undefined;
const toolReplies = new Map<string, (response: { result?: unknown; error?: string }) => void>();
// Store 可能返回 Proxy；沿用原 HTTP/IPC 边界的 JSON 语义后再交给 Worker。
const jsonValue = (value: unknown) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

export function registerBrowserToolHandler(handler: (request: ToolRequest) => Promise<void>) { toolHandler = handler; }
export async function respondBrowserTool(response: { requestId: string; result?: unknown; error?: string }) {
  const reply = toolReplies.get(response.requestId);
  if (!reply) throw new Error(t('agent.worker.toolInterrupted'));
  toolReplies.delete(response.requestId); reply(response);
}
function request<T>(type: string, payload?: unknown): Promise<T> {
  const owner = active;
  if (!owner) return Promise.reject(new Error(t('agent.worker.notConnected')));
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    owner.pending.set(id, { resolve: value => resolve(value as T), reject });
    owner.worker.postMessage({ type, id, payload: jsonValue(payload) });
  });
}
export async function connectBrowserHarness(): Promise<void> {
  if (active?.project === getAgentProjectIdentity().fenceKey) return;
  if (connecting) { await connecting; return connectBrowserHarness(); }
  connecting = (async () => {
    const identity = getAgentProjectIdentity();
    const user = cloudEnabled ? (await readCloudSession()).id : 'local';
    if (identity.fenceKey !== getAgentProjectIdentity().fenceKey) throw new Error(t('agent.worker.projectChanged'));
    active?.dispose();
    if (!globalThis.isSecureContext || !globalThis.Worker || !globalThis.indexedDB || !navigator.locks || !globalThis.OffscreenCanvas) {
      throw new Error(t('agent.worker.unsupported'));
    }
    const worker = new Worker(new URL('harness/worker/worker.mjs', document.baseURI), { type: 'module', name: 'shotloom-agent' });
    let disposed = false;
    const owner = active = { worker, project: identity.fenceKey, user, pending: new Map<string, Reply>(), listeners: new Map<string, (event: TransportEvent) => void>(), controllers: new Map<string, AbortController>(), dispose };
    const fail = (message: string) => {
      for (const reply of owner.pending.values()) reply.reject(new Error(message));
      for (const [requestId, receive] of owner.listeners) receive({ requestId, kind: 'error', error: message });
      owner.pending.clear(); owner.listeners.clear();
    };
    const unsubscribe = subscribeDomain(() => { if (getAgentProjectIdentity().fenceKey !== identity.fenceKey) dispose(); });
    const heartbeat = cloudEnabled ? setInterval(() => { void verifyCloudSession(); }, 20_000) : undefined;
    function dispose() {
      if (disposed) return;
      disposed = true;
      if (active === owner) active = undefined;
      worker.terminate(); unsubscribe(); clearInterval(heartbeat);
      window.removeEventListener('pagehide', dispose); window.removeEventListener('shotloom-session-expired', dispose);
      for (const control of owner.controllers.values()) control.abort();
      fail(t('agent.worker.stopped'));
      for (const reply of toolReplies.values()) reply({ error: t('agent.worker.stopped') });
      toolReplies.clear();
    }
    window.addEventListener('pagehide', dispose, { once: true });
    window.addEventListener('shotloom-session-expired', dispose, { once: true });
    worker.onerror = event => { fail(event.message || t('agent.worker.startFailed')); dispose(); };
    worker.onmessage = event => {
      if (active !== owner) return;
      const message = event.data;
      if (message.type === 'fatal') { fail(message.error); dispose(); return; }
      if (message.type === 'result') {
        const reply = owner.pending.get(message.id); owner.pending.delete(message.id);
        if (message.error) reply?.reject(new Error(message.error)); else reply?.resolve(message.value);
      } else if (message.type === 'event') {
        const value = message.value as TransportEvent;
        owner.listeners.get(value.requestId)?.(value);
        if (['result', 'end', 'error'].includes(value.kind)) owner.listeners.delete(value.requestId);
      } else if (message.type === 'host-abort') { owner.controllers.get(message.id)?.abort(); owner.controllers.delete(message.id); }
      else if (message.type === 'host-release') owner.controllers.delete(message.id);
      else if (message.type === 'host-request') {
        const control = new AbortController(); owner.controllers.set(message.id, control);
        void (async () => {
          if (active !== owner || identity.fenceKey !== getAgentProjectIdentity().fenceKey) throw new Error(t('agent.worker.projectChanged'));
          if (message.method === 'tool') {
            if (!toolHandler) throw new Error(t('agent.worker.toolsNotReady'));
            const value = await new Promise<unknown>((resolve, reject) => {
              const id = message.payload.requestId as string;
              const abort = () => { toolReplies.delete(id); reject(control.signal.reason); };
              control.signal.addEventListener('abort', abort, { once: true });
              toolReplies.set(id, response => { control.signal.removeEventListener('abort', abort); response.error ? reject(new Error(response.error)) : resolve(response.result); });
              void toolHandler!(message.payload).catch(error => { toolReplies.delete(id); control.signal.removeEventListener('abort', abort); reject(error); });
            });
            worker.postMessage({ type: 'host-result', id: message.id, value: jsonValue(value) });
          } else if (message.method === 'model') {
            const response = await fetch(`${cloudOrigin}/api/agent/model`, { method: 'POST', credentials: 'include',
              headers: { ...cloudUserHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(message.payload), signal: control.signal });
            if (!response.ok || !response.body) {
              if (response.status === 401 || response.status === 409) await verifyCloudSession();
              const error = await response.json().catch(() => ({}));
              throw new Error(error.message || t('agent.worker.modelFailed', { status: response.status }));
            }
            worker.postMessage({ type: 'host-result', id: message.id, value: { body: response.body, controlId: message.id } }, [response.body as unknown as Transferable]);
          } else throw new Error('Unknown Agent Worker host request');
        })().catch(error => { owner.controllers.delete(message.id); worker.postMessage({ type: 'host-result', id: message.id, error: error instanceof Error ? error.message : String(error) }); })
          .finally(() => { if (message.method !== 'model') owner.controllers.delete(message.id); });
      }
    };
    try { await request('boot', { userId: user, projectKey: identity.projectKey }); }
    catch (error) { dispose(); throw error; }
  })().finally(() => { connecting = undefined; });
  return connecting;
}
export const browserHarnessTransport = {
  async send(message: { requestId: string; kind: string; payload?: unknown }, receive: (event: TransportEvent) => void) {
    await connectBrowserHarness();
    if (message.kind === 'fetch' || message.kind === 'stream') active!.listeners.set(message.requestId, receive);
    active!.worker.postMessage({ type: 'send', payload: message });
    if (message.kind === 'cancel') active!.listeners.delete(message.requestId);
  },
};
export async function bindBrowserHarness<T>(config: unknown): Promise<T> { await connectBrowserHarness(); return request<T>('bind', config); }
export async function archiveBrowserHarness(projectKey: string, sessionIds: string[] | undefined, archived: boolean) {
  const payload = { projectKey, sessionIds, archived };
  if (active && active.project === getAgentProjectIdentity().fenceKey && projectKey === getAgentProjectIdentity().projectKey) return request('archive', payload);
  // 未打开的工程也有本地历史；临时 Worker 使用同一存储和锁，归档完成即释放。
  const userId = cloudEnabled ? (await readCloudSession()).id : 'local';
  const worker = new Worker(new URL('harness/worker/worker.mjs', document.baseURI), { type: 'module' });
  try {
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(t('agent.connectionTimeout'))), 30_000);
      const finish = (error?: string, value?: unknown) => { clearTimeout(timeout); error ? reject(new Error(error)) : resolve(value); };
      worker.onerror = event => finish(event.message || t('agent.worker.startFailed'));
      worker.onmessage = ({ data }) => {
        if (data.type === 'fatal') finish(data.error);
        else if (data.type === 'result') {
          if (data.error) finish(data.error);
          else if (data.id === 'boot') worker.postMessage({ type: 'archive', id: 'archive', payload });
          else if (data.id === 'archive') finish(undefined, data.value);
        }
      };
      worker.postMessage({ type: 'boot', id: 'boot', payload: { userId, projectKey } });
    });
  } finally { worker.terminate(); }
}
