import { cloudOrigin, cloudRequest, cloudUserHeaders, verifyCloudSession } from '../../services/cloudRequest';
import type { executeProductRequest } from '../../services/harnessProductTools';

type ToolRequest = Parameters<typeof executeProductRequest>[0];
interface Event { requestId: string; kind: string; value?: unknown; error?: string }
const listeners = new Map<string, (event: Event) => void>();
const toolRequests = new Map<string, { connection: string; id: string }>();
let connection: string | undefined;
let connecting: Promise<string> | undefined;
let toolHandler: ((request: ToolRequest) => Promise<void>) | undefined;

export function registerCloudToolHandler(handler: (request: ToolRequest) => Promise<void>) { toolHandler = handler; }

export async function connectCloudHarness(): Promise<string> {
  if (connection) return connection;
  if (connecting) return connecting;
  connecting = (async () => {
    const { id } = await cloudRequest<{ id: string }>('/agent/connect', 'POST', {});
    const control = new AbortController();
    const response = await fetch(`${cloudOrigin}/api/agent/${id}/events`, {
      credentials: 'include', headers: cloudUserHeaders(), signal: control.signal,
    });
    if (!response.ok || !response.body) {
      if (response.status === 401 || response.status === 409) await verifyCloudSession();
      throw new Error(`Agent connection failed: ${response.status}`);
    }
    connection = id;
    const close = () => control.abort();
    window.addEventListener('pagehide', close, { once: true });
    const reader = response.body.getReader();
    void (async () => {
      let buffer = '';
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let end: number;
        while ((end = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
          const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
          if (!data) continue;
          const event = JSON.parse(data) as Event;
          if (event.kind === 'tool') {
            const request = event.value as ToolRequest;
            toolRequests.set(request.requestId, { connection: id, id: event.requestId });
            if (toolHandler) void toolHandler(request).catch(() => {});
            else void cloudRequest(`/agent/${id}/tool`, 'POST', { requestId: event.requestId, error: '客户端工具尚未就绪' }).catch(() => {});
          } else {
            listeners.get(event.requestId)?.(event);
            if (['result', 'end', 'error'].includes(event.kind)) listeners.delete(event.requestId);
          }
        }
        if (buffer.length > 32 * 1024 * 1024) throw new Error('Agent event exceeds transport limit');
      }
    })().catch(() => {}).finally(() => {
      reader.releaseLock(); control.abort(); window.removeEventListener('pagehide', close);
      if (connection === id) connection = undefined;
      for (const [requestId, receive] of listeners) receive({ requestId, kind: 'error', error: 'Agent 连接已断开，请重试连接' });
      listeners.clear();
      for (const [requestId, pending] of toolRequests) if (pending.connection === id) toolRequests.delete(requestId);
    });
    return id;
  })().finally(() => { connecting = undefined; });
  return connecting;
}

export const cloudHarnessTransport = {
  async send(message: { requestId: string; kind: string; payload?: unknown }, receive: (event: Event) => void) {
    const id = await connectCloudHarness();
    if (message.kind === 'fetch' || message.kind === 'stream') listeners.set(message.requestId, receive);
    try { await cloudRequest(`/agent/${id}/message`, 'POST', message); }
    catch (error) { listeners.delete(message.requestId); throw error; }
    if (message.kind === 'cancel') listeners.delete(message.requestId);
  },
};
export async function bindCloudHarness<T>(config: unknown): Promise<T> {
  const id = await connectCloudHarness();
  return cloudRequest(`/agent/${id}/bind`, 'POST', config);
}
export async function respondCloudTool(response: { requestId: string; result?: unknown; error?: string }): Promise<void> {
  const pending = toolRequests.get(response.requestId);
  if (!pending || pending.connection !== connection) throw new Error('Agent tool connection is closed');
  try { await cloudRequest(`/agent/${pending.connection}/tool`, 'POST', { ...response, requestId: pending.id }); }
  finally { toolRequests.delete(response.requestId); }
}
