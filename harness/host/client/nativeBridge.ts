import { createContext } from 'react';
export interface NativeMessage { requestId: string; kind: string; payload?: unknown }
export interface NativeEvent { requestId: string; kind: string; value?: any; error?: string }
export interface ProductHost {
  sessionId: string; agentId: string; locale: string; tools: string[]; toolTitles: Record<string, string>;
  readReference(nodeId?: string, withImage?: boolean): Promise<any>;
  preview(nodeId: string): void;
  navigate(kind: 'nodes' | 'tasks', ids: string[]): void;
  status(phase: 'loading' | 'ready' | 'error', error?: string): void;
  onTurnStart?(): void;
  subscribeMention(listener: (nodeId: string) => void): () => void;
}
export interface NativeHost {
  send(message: NativeMessage, receive: (event: NativeEvent) => void): Promise<void>;
}
export const ProductContext = createContext<ProductHost>(null!);
let native: NativeHost;
export function setNativeHost(host: NativeHost) { native = host; }
export function request(kind: string, payload: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    void native.send({ requestId, kind, payload }, event => {
      if (event.kind === 'error') reject(new Error(event.error));
      if (event.kind === 'result') resolve(event.value);
    }).catch(reject);
  });
}
export async function nativeFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const path = String(input).replace(/^\/?api\//, '/api/');
  const bytes = init.body == null ? undefined : new Uint8Array(await new Response(init.body).arrayBuffer());
  let body = '';
  if (bytes) for (let start = 0; start < bytes.length; start += 32768) body += String.fromCharCode(...bytes.subarray(start, start + 32768));
  const result = await request('fetch', { path, method: init.method ?? 'GET', headers: Object.fromEntries(new Headers(init.headers)), ...(bytes ? { body: btoa(body) } : {}) });
  return new Response(Uint8Array.from(atob(result.body), c => c.charCodeAt(0)), { status: result.status, headers: result.headers });
}
export async function* nativeStream(endpoint: string, payload: unknown, signal: AbortSignal, uplink?: AsyncIterable<unknown>): AsyncIterable<unknown> {
  const requestId = crypto.randomUUID();
  const queue: NativeEvent[] = [];
  let wake = () => {};
  const receive = (event: NativeEvent) => { queue.push(event); wake(); };
  const cancel = () => { void native.send({ requestId, kind: 'cancel' }, () => {}).catch(() => {}); wake(); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    if (signal.aborted) return;
    await native.send({ requestId, kind: 'stream', payload: { endpoint, payload } }, receive);
    if (uplink) void (async () => {
      for await (const value of uplink) {
        if (signal.aborted) break;
        await native.send({ requestId, kind: 'uplink', payload: value }, () => {});
      }
    })().catch(error => receive({ requestId, kind: 'error', error: String(error) }));
    while (!signal.aborted) {
      if (!queue.length) await new Promise<void>(resolve => { wake = resolve; });
      while (queue.length) {
        const event = queue.shift()!;
        if (event.kind === 'error') throw new Error(event.error);
        if (event.kind === 'end') return;
        yield event.value;
      }
    }
  } finally { signal.removeEventListener('abort', cancel); cancel(); }
}
