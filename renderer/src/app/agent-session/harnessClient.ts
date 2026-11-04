import { Channel, invoke } from '@tauri-apps/api/core';

export interface HarnessProductHost {
  sessionId: string; agentId: string; locale: string; tools: string[]; toolTitles: Record<string, string>;
  readReference(nodeId?: string, withImage?: boolean): Promise<unknown>;
  preview(nodeId: string): void;
  navigate(kind: 'nodes' | 'tasks', ids: string[]): void;
  status(phase: 'loading' | 'ready' | 'error', error?: string): void;
  subscribeMention(listener: (nodeId: string) => void): () => void;
}
interface NativeEvent { requestId: string; kind: string; value?: unknown; error?: string }
interface HarnessModule {
  initialize(transport: typeof native): Promise<void>;
  mount(container: HTMLElement, native: { send(message: { requestId: string; kind: string; payload?: unknown }, receive: (event: NativeEvent) => void): Promise<void> }, host: HarnessProductHost): Promise<{ dispose(): void }>;
}
let client: Promise<HarnessModule> | undefined;
const native = { async send(message: { requestId: string; kind: string; payload?: unknown }, receive: (event: NativeEvent) => void) {
  const channel = new Channel<NativeEvent>(); channel.onmessage = receive;
  await invoke('harness_transport', { message, channel });
} };
function loadClient() {
  client ??= import(/* @vite-ignore */ new URL('harness/client.js', document.baseURI).href) as Promise<HarnessModule>;
  return client;
}
export async function initializeHarnessClient() { await (await loadClient()).initialize(native); }
export async function mountHarnessClient(container: HTMLElement, host: HarnessProductHost) {
  return (await loadClient()).mount(container, native, host);
}
